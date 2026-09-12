/**
 * Pure helpers for the Live Tennis API Companion module.
 *
 * Nothing in this file touches Companion or the network, so it can be unit
 * tested offline. Every function is null-safe: the API documents that score
 * entries can be null while a match is being observed live.
 *
 * Score shape (player-major, from https://docs.livetennisapi.com/openapi.yaml):
 *   sets:   [setsWonP1, setsWonP2]
 *   games:  [[p1 set1, p1 set2, ...], [p2 set1, p2 set2, ...]]
 *   points: ["40", "30"]  -- tennis strings, or plain counts during a tiebreak
 *   server: 1 | 2 | null
 *   is_tiebreak: boolean
 */

export const MIN_POLL_SECONDS = 15
export const MAX_POLL_SECONDS = 3600
export const DEFAULT_POLL_SECONDS = 900

/** Free keyed tier as documented at docs.livetennisapi.com (retrieved 2026-09-12). */
export const FREE_TIER = Object.freeze({ perMinute: 30, perDay: 100 })

/**
 * Clamp a user supplied poll interval to the supported range.
 * Non-numeric input falls back to the default so a broken config can never
 * produce a tight loop.
 */
export function clampPollSeconds(value) {
	const n = Number(value)
	if (!Number.isFinite(n)) return DEFAULT_POLL_SECONDS
	return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(n)))
}

/** Requests per UTC day at a given poll cadence (one request per poll). */
export function requestsPerDay(pollSeconds) {
	return Math.ceil(86400 / clampPollSeconds(pollSeconds))
}

/** Normalise one points entry to a canonical string, or null. */
export function pointValue(value) {
	if (value === null || value === undefined) return null
	const s = String(value).trim().toUpperCase()
	if (s === '') return null
	if (s === 'A' || s === 'ADV' || s === 'ADVANTAGE') return 'AD'
	return s
}

function serverIndex(score) {
	const s = score?.server
	return s === 1 || s === 2 ? s : null
}

/**
 * Which player currently holds a break point: 1, 2 or 0 (none).
 * Rule: the receiver is at AD, or the receiver is at 40 while the server is
 * at 0/15/30. Never during a tiebreak. Null points mean "unknown" = no.
 */
export function breakPointFor(score) {
	if (!score || score.is_tiebreak === true) return 0
	const server = serverIndex(score)
	if (server === null) return 0
	const points = Array.isArray(score.points) ? score.points : []
	const receiver = server === 1 ? 2 : 1
	const sp = pointValue(points[server - 1])
	const rp = pointValue(points[receiver - 1])
	if (sp === null || rp === null) return 0
	if (rp === 'AD') return receiver
	if (rp === '40' && (sp === '0' || sp === '15' || sp === '30')) return receiver
	return 0
}

export function isBreakPoint(score) {
	return breakPointFor(score) !== 0
}

/** Per-set game pairs: [[p1, p2], ...]. Empty when the shape is unusable. */
export function setPairs(score) {
	const games = score?.games
	if (!Array.isArray(games) || games.length < 2) return []
	const g1 = Array.isArray(games[0]) ? games[0] : []
	const g2 = Array.isArray(games[1]) ? games[1] : []
	const n = Math.max(g1.length, g2.length)
	const pairs = []
	for (let i = 0; i < n; i++) {
		const a = Number.isFinite(g1[i]) ? g1[i] : null
		const b = Number.isFinite(g2[i]) ? g2[i] : null
		if (a === null && b === null) continue
		pairs.push([a, b])
	}
	return pairs
}

/** A set is complete at 6+ with a 2 game margin, or 7-6 (tiebreak). Covers 10-point match tiebreak sets too. */
export function isSetComplete(pair) {
	if (!Array.isArray(pair)) return false
	const [a, b] = pair
	if (!Number.isFinite(a) || !Number.isFinite(b)) return false
	const hi = Math.max(a, b)
	const lo = Math.min(a, b)
	if (hi >= 6 && hi - lo >= 2) return true
	if (hi === 7 && lo === 6) return true
	return false
}

/** Number of completed sets. Prefers the API's own `sets` tally, falls back to the games. */
export function completedSetCount(score) {
	const sets = score?.sets
	if (Array.isArray(sets) && Number.isFinite(sets[0]) && Number.isFinite(sets[1])) {
		return sets[0] + sets[1]
	}
	return setPairs(score).filter(isSetComplete).length
}

/**
 * Whether a set is finished.
 * @param {object} score
 * @param {'latest'|number|string} which 'latest' = the most recent set that has any games; or a 1-based set number.
 */
export function isSetFinished(score, which = 'latest') {
	const pairs = setPairs(score)
	const done = completedSetCount(score)
	if (which === 'latest' || which === undefined || which === null || which === '') {
		if (pairs.length === 0) return false
		return done >= pairs.length
	}
	const n = Number(which)
	if (!Number.isInteger(n) || n < 1) return false
	return done >= n
}

/** 1-based number of the set in progress (or the last one played). 0 when unknown. */
export function currentSetNumber(score) {
	const pairs = setPairs(score)
	if (pairs.length > 0) return pairs.length
	const done = completedSetCount(score)
	return done > 0 ? done : 0
}

function fmtPair(pair, sep = '-') {
	const [a, b] = pair
	return `${a ?? '-'}${sep}${b ?? '-'}`
}

/** "1-0" */
export function formatSets(score) {
	const sets = score?.sets
	if (!Array.isArray(sets) || sets.length < 2) return ''
	if (!Number.isFinite(sets[0]) && !Number.isFinite(sets[1])) return ''
	return fmtPair([Number.isFinite(sets[0]) ? sets[0] : null, Number.isFinite(sets[1]) ? sets[1] : null])
}

/** ["6-3", "4-4"] */
export function formatSetScores(score) {
	return setPairs(score).map((p) => fmtPair(p))
}

/** "6-3 4-4" */
export function formatGames(score) {
	return formatSetScores(score).join(' ')
}

/** Games of the set in progress, "4-4". */
export function formatCurrentSetGames(score) {
	const pairs = setPairs(score)
	return pairs.length ? fmtPair(pairs[pairs.length - 1]) : ''
}

/** "40-30", "AD-40", or "5-3" in a tiebreak. */
export function formatPoints(score) {
	const points = score?.points
	if (!Array.isArray(points)) return ''
	const a = pointValue(points[0])
	const b = pointValue(points[1])
	if (a === null && b === null) return ''
	return `${a ?? '-'}-${b ?? '-'}`
}

/** "6-3 4-4 40-30" */
export function formatScoreLine(score) {
	return [formatGames(score), formatPoints(score)].filter((s) => s !== '').join(' ')
}

export function playerName(match, n) {
	const name = match?.players?.[`p${n}`]?.name
	return typeof name === 'string' ? name : ''
}

export function playerField(match, n, field) {
	const v = match?.players?.[`p${n}`]?.[field]
	return v === undefined || v === null ? '' : v
}

export function matchTitle(match) {
	if (!match) return ''
	const a = playerName(match, 1) || '?'
	const b = playerName(match, 2) || '?'
	return `${a} vs ${b}`
}

/** "live", "live (Interrupted)", "completed", "completed (Retired)", ... */
export function matchStatusLabel(match) {
	if (!match) return 'no match'
	const status = typeof match.status === 'string' && match.status ? match.status : 'unknown'
	const es = match.event_status
	return typeof es === 'string' && es ? `${status} (${es})` : status
}

export function isLive(match) {
	return match?.status === 'live'
}

export function isFinished(match) {
	return match?.status === 'completed' || match?.status === 'cancelled'
}

/** Lower-case, diacritics stripped, whitespace collapsed. */
export function normaliseName(value) {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * How well a query matches one player's name.
 * 3 = surname (last token) equal, 2 = any token equal, 1 = substring, 0 = no.
 */
export function nameMatchScore(name, query) {
	const n = normaliseName(name)
	const q = normaliseName(query)
	if (!n || !q) return 0
	const tokens = n.split(' ')
	if (tokens[tokens.length - 1] === q) return 3
	if (tokens.includes(q)) return 2
	if (n.includes(q)) return 1
	return 0
}

/**
 * Find matches involving a player, best match first (stable).
 * A query of the form "A vs B" / "A v B" requires both players.
 * Case-insensitive; a surname alone is enough.
 */
export function findMatchesByPlayer(matches, query) {
	const list = Array.isArray(matches) ? matches : []
	const q = normaliseName(query)
	if (!q) return []
	const parts = q.split(/\s+(?:vs\.?|v)\s+/)
	const scored = []
	list.forEach((match, index) => {
		const p1 = playerName(match, 1)
		const p2 = playerName(match, 2)
		let score
		if (parts.length === 2) {
			const a = Math.min(nameMatchScore(p1, parts[0]), nameMatchScore(p2, parts[1]))
			const b = Math.min(nameMatchScore(p1, parts[1]), nameMatchScore(p2, parts[0]))
			score = Math.max(a, b)
		} else {
			score = Math.max(nameMatchScore(p1, q), nameMatchScore(p2, q))
		}
		if (score > 0) scored.push({ match, score, index })
	})
	scored.sort((x, y) => y.score - x.score || x.index - y.index)
	return scored.map((s) => s.match)
}

/** Index of a match id in a list, or -1. Ids compare as strings. */
export function indexOfMatch(matches, id) {
	if (id === null || id === undefined || id === '') return -1
	const list = Array.isArray(matches) ? matches : []
	const key = String(id)
	return list.findIndex((m) => m && String(m.id) === key)
}

/** Wrap-around step over a list. Returns the new index, or -1 for an empty list. */
export function cycleIndex(length, currentIndex, step) {
	if (!Number.isInteger(length) || length <= 0) return -1
	const dir = step < 0 ? -1 : 1
	if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= length) {
		return dir > 0 ? 0 : length - 1
	}
	return (currentIndex + dir + length) % length
}

function hhmmss(iso) {
	if (!iso) return ''
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return ''
	return d.toISOString().slice(11, 19)
}

/**
 * Compute the full variable set for the current state.
 * @param {object|null} match  the selected match (API shape) or null
 * @param {object} extra       { apiError, lastUpdated, liveCount, liveIndex, pollSeconds, requestsToday }
 */
export function deriveVariables(match, extra = {}) {
	const score = match?.score ?? null
	const setScores = formatSetScores(score)
	const bp = breakPointFor(score)
	const server = serverIndex(score)
	const live = isLive(match)
	const winner = match?.winner === 1 || match?.winner === 2 ? match.winner : 0
	const vars = {
		match_id: match?.id === undefined || match?.id === null ? '' : String(match.id),
		match_title: matchTitle(match),
		player1_name: playerName(match, 1),
		player2_name: playerName(match, 2),
		player1_country: playerField(match, 1, 'country'),
		player2_country: playerField(match, 2, 'country'),
		player1_ranking: playerField(match, 1, 'ranking'),
		player2_ranking: playerField(match, 2, 'ranking'),
		sets: formatSets(score),
		games: formatGames(score),
		points: formatPoints(score),
		score_line: formatScoreLine(score),
		current_set: currentSetNumber(score),
		current_set_games: formatCurrentSetGames(score),
		set_scores: setScores.join(' '),
		server: live && server !== null ? server : '',
		server_name: live && server !== null ? playerName(match, server) : '',
		break_point: live && bp !== 0,
		break_point_player: live && bp !== 0 ? bp : '',
		break_point_player_name: live && bp !== 0 ? playerName(match, bp) : '',
		tiebreak: live && score?.is_tiebreak === true,
		match_status: matchStatusLabel(match),
		event_status: typeof match?.event_status === 'string' ? match.event_status : '',
		outcome: typeof match?.outcome === 'string' ? match.outcome : '',
		winner: winner || '',
		winner_name: winner ? playerName(match, winner) : '',
		tournament: typeof match?.tournament === 'string' ? match.tournament : '',
		round: typeof match?.round === 'string' ? match.round : '',
		round_code: typeof match?.round_code === 'string' ? match.round_code : '',
		surface: typeof match?.surface === 'string' ? match.surface : '',
		tour: typeof match?.tour === 'string' ? match.tour : '',
		draw: typeof match?.draw === 'string' ? match.draw : '',
		format: typeof match?.format === 'string' ? match.format : '',
		score_timestamp: typeof score?.timestamp === 'string' ? score.timestamp : '',
		last_updated: extra.lastUpdated ?? '',
		last_updated_time: hhmmss(extra.lastUpdated),
		api_error: extra.apiError ?? '',
		live_count: Number.isInteger(extra.liveCount) ? extra.liveCount : 0,
		live_index: Number.isInteger(extra.liveIndex) && extra.liveIndex >= 0 ? extra.liveIndex + 1 : 0,
		poll_interval: Number.isFinite(extra.pollSeconds) ? extra.pollSeconds : DEFAULT_POLL_SECONDS,
		requests_today: Number.isInteger(extra.requestsToday) ? extra.requestsToday : 0,
	}
	for (let i = 1; i <= 5; i++) vars[`set${i}`] = setScores[i - 1] ?? ''
	return vars
}
