import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	breakPointFor,
	isBreakPoint,
	isSetFinished,
	isSetComplete,
	completedSetCount,
	formatSets,
	formatGames,
	formatPoints,
	formatScoreLine,
	formatSetScores,
	clampPollSeconds,
	requestsPerDay,
	findMatchesByPlayer,
	nameMatchScore,
	cycleIndex,
	indexOfMatch,
	deriveVariables,
	matchStatusLabel,
	MIN_POLL_SECONDS,
	MAX_POLL_SECONDS,
	DEFAULT_POLL_SECONDS,
} from '../lib/tennis.js'

const score = (over = {}) => ({
	sets: [1, 0],
	games: [
		[6, 3],
		[4, 4],
	], // player-major: set 1 = 6-4, set 2 = 3-4
	points: ['40', '30'],
	server: 1,
	is_tiebreak: false,
	...over,
})

test('break point: receiver at 40, server at 0/15/30', () => {
	assert.equal(breakPointFor(score({ server: 1, points: ['30', '40'] })), 2)
	assert.equal(breakPointFor(score({ server: 1, points: ['0', '40'] })), 2)
	assert.equal(breakPointFor(score({ server: 2, points: ['40', '15'] })), 1)
	assert.equal(isBreakPoint(score({ server: 2, points: ['40', '15'] })), true)
})

test('break point: receiver at AD', () => {
	assert.equal(breakPointFor(score({ server: 1, points: ['40', 'AD'] })), 2)
	assert.equal(breakPointFor(score({ server: 2, points: ['AD', '40'] })), 1)
	assert.equal(breakPointFor(score({ server: 2, points: ['A', '40'] })), 1)
})

test('not a break point: deuce, server ahead, game point, server at AD', () => {
	assert.equal(breakPointFor(score({ server: 1, points: ['40', '40'] })), 0)
	assert.equal(breakPointFor(score({ server: 1, points: ['40', '30'] })), 0)
	assert.equal(breakPointFor(score({ server: 1, points: ['AD', '40'] })), 0)
	assert.equal(breakPointFor(score({ server: 1, points: ['15', '30'] })), 0)
})

test('never a break point in a tiebreak', () => {
	assert.equal(breakPointFor(score({ server: 1, is_tiebreak: true, points: ['0', '40'] })), 0)
	assert.equal(breakPointFor(score({ server: 1, is_tiebreak: true, points: ['5', '6'] })), 0)
})

test('break point is null-safe', () => {
	assert.equal(breakPointFor(null), 0)
	assert.equal(breakPointFor(undefined), 0)
	assert.equal(breakPointFor({}), 0)
	assert.equal(breakPointFor(score({ server: null })), 0)
	assert.equal(breakPointFor(score({ points: null })), 0)
	assert.equal(breakPointFor(score({ points: [null, '40'] })), 0)
	assert.equal(breakPointFor(score({ points: ['30', null] })), 0)
	assert.equal(breakPointFor(score({ points: [] })), 0)
	assert.equal(breakPointFor(score({ server: 3 })), 0)
})

test('set completion rules', () => {
	assert.equal(isSetComplete([6, 4]), true)
	assert.equal(isSetComplete([7, 5]), true)
	assert.equal(isSetComplete([7, 6]), true)
	assert.equal(isSetComplete([6, 5]), false)
	assert.equal(isSetComplete([5, 3]), false)
	assert.equal(isSetComplete([10, 8]), true)
	assert.equal(isSetComplete([6, null]), false)
	assert.equal(isSetComplete(null), false)
})

test('set_finished uses the sets tally first, games as fallback', () => {
	const s = score()
	assert.equal(completedSetCount(s), 1)
	assert.equal(isSetFinished(s, 1), true)
	assert.equal(isSetFinished(s, 2), false)
	assert.equal(isSetFinished(s, 'latest'), false)
	// only one set so far and it is over -> latest is finished
	assert.equal(isSetFinished(score({ sets: [1, 0], games: [[6], [4]] }), 'latest'), true)
	// no sets tally: derive from games
	assert.equal(
		isSetFinished(
			{
				games: [
					[7, 2],
					[6, 1],
				],
			},
			1,
		),
		true,
	)
	assert.equal(
		isSetFinished(
			{
				games: [
					[7, 2],
					[6, 1],
				],
			},
			'latest',
		),
		false,
	)
	assert.equal(isSetFinished(null, 1), false)
	assert.equal(isSetFinished({}, 'latest'), false)
	assert.equal(isSetFinished(s, 'bogus'), false)
	assert.equal(isSetFinished(s, 0), false)
})

test('score formatting', () => {
	const s = score()
	assert.equal(formatSets(s), '1-0')
	assert.equal(formatGames(s), '6-4 3-4')
	assert.deepEqual(formatSetScores(s), ['6-4', '3-4'])
	assert.equal(formatPoints(s), '40-30')
	assert.equal(formatScoreLine(s), '6-4 3-4 40-30')
	assert.equal(formatPoints(score({ is_tiebreak: true, points: ['5', '3'] })), '5-3')
	assert.equal(formatPoints(score({ points: [null, null] })), '')
	assert.equal(formatPoints(score({ points: ['40', null] })), '40--')
	assert.equal(
		formatGames(
			score({
				games: [
					[6, 3, 2],
					[4, 4],
				],
			}),
		),
		'6-4 3-4 2--',
	)
	assert.equal(formatSets(null), '')
	assert.equal(formatGames({}), '')
	assert.equal(formatScoreLine(null), '')
})

test('poll interval clamp: 15 s floor, 1 h ceiling, 900 s default', () => {
	assert.equal(MIN_POLL_SECONDS, 15)
	assert.equal(MAX_POLL_SECONDS, 3600)
	assert.equal(DEFAULT_POLL_SECONDS, 900)
	assert.equal(clampPollSeconds(1), 15)
	assert.equal(clampPollSeconds(0), 15)
	assert.equal(clampPollSeconds(-5), 15)
	assert.equal(clampPollSeconds(15), 15)
	assert.equal(clampPollSeconds(900), 900)
	assert.equal(clampPollSeconds(99999), 3600)
	assert.equal(clampPollSeconds('abc'), 900)
	assert.equal(clampPollSeconds(undefined), 900)
	assert.equal(clampPollSeconds('60'), 60)
	assert.equal(clampPollSeconds(29.6), 30)
})

test('default cadence fits the free tier day budget', () => {
	assert.ok(requestsPerDay(DEFAULT_POLL_SECONDS) <= 100, `${requestsPerDay(DEFAULT_POLL_SECONDS)} > 100`)
	assert.equal(requestsPerDay(DEFAULT_POLL_SECONDS), 96)
	assert.equal(requestsPerDay(15), 5760)
})

const live = [
	{ id: 101, players: { p1: { name: 'Carlos Alcaraz' }, p2: { name: 'Jannik Sinner' } } },
	{ id: 102, players: { p1: { name: 'Iga Świątek' }, p2: { name: 'Aryna Sabalenka' } } },
	{ id: 103, players: { p1: { name: 'Alexander Zverev' }, p2: { name: 'Félix Auger-Aliassime' } } },
	{ id: 104, players: { p1: { name: 'Alex de Minaur' }, p2: { name: 'Taylor Fritz' } } },
]

test('player name matching: case-insensitive, surname, substring, diacritics', () => {
	assert.equal(findMatchesByPlayer(live, 'SINNER')[0].id, 101)
	assert.equal(findMatchesByPlayer(live, 'swiatek')[0].id, 102)
	assert.equal(findMatchesByPlayer(live, 'Auger')[0].id, 103)
	assert.equal(findMatchesByPlayer(live, 'auger-aliassime')[0].id, 103)
	assert.equal(findMatchesByPlayer(live, 'minaur')[0].id, 104)
	assert.equal(findMatchesByPlayer(live, 'zver')[0].id, 103)
	assert.deepEqual(findMatchesByPlayer(live, 'nobody'), [])
	assert.deepEqual(findMatchesByPlayer(live, ''), [])
	assert.deepEqual(findMatchesByPlayer(null, 'sinner'), [])
})

test('player name matching: surname beats substring; "A vs B" needs both', () => {
	const list = [
		{ id: 1, players: { p1: { name: 'Alexander Zverev' }, p2: { name: 'X Y' } } },
		{ id: 2, players: { p1: { name: 'Alex de Minaur' }, p2: { name: 'Z Alex' } } },
	]
	assert.equal(findMatchesByPlayer(list, 'alex')[0].id, 2) // token/surname match outranks substring
	assert.equal(nameMatchScore('Alexander Zverev', 'zverev'), 3)
	assert.equal(nameMatchScore('Alex de Minaur', 'alex'), 2)
	assert.equal(nameMatchScore('Alexander Zverev', 'alex'), 1)
	assert.equal(findMatchesByPlayer(live, 'Sinner vs Alcaraz')[0].id, 101)
	assert.equal(findMatchesByPlayer(live, 'alcaraz v sinner')[0].id, 101)
	assert.deepEqual(findMatchesByPlayer(live, 'sinner vs fritz'), [])
})

test('cycle index wraps in both directions and handles empty lists', () => {
	assert.equal(cycleIndex(0, 0, 1), -1)
	assert.equal(cycleIndex(3, -1, 1), 0)
	assert.equal(cycleIndex(3, -1, -1), 2)
	assert.equal(cycleIndex(3, 0, 1), 1)
	assert.equal(cycleIndex(3, 2, 1), 0)
	assert.equal(cycleIndex(3, 0, -1), 2)
	assert.equal(indexOfMatch(live, 103), 2)
	assert.equal(indexOfMatch(live, '103'), 2)
	assert.equal(indexOfMatch(live, 999), -1)
	assert.equal(indexOfMatch(live, null), -1)
})

test('match status label and derived variables', () => {
	assert.equal(matchStatusLabel(null), 'no match')
	assert.equal(matchStatusLabel({ status: 'live' }), 'live')
	assert.equal(matchStatusLabel({ status: 'live', event_status: 'Interrupted' }), 'live (Interrupted)')
	assert.equal(matchStatusLabel({ status: 'completed', event_status: 'Retired' }), 'completed (Retired)')
	assert.equal(matchStatusLabel({}), 'unknown')

	const match = {
		id: 101,
		status: 'live',
		tournament: 'US Open',
		round: 'Final',
		surface: 'hard',
		players: {
			p1: { name: 'Carlos Alcaraz', country: 'ESP', ranking: 1 },
			p2: { name: 'Jannik Sinner', country: 'ITA', ranking: 2 },
		},
		score: score({ server: 2, points: ['40', '30'] }),
	}
	const v = deriveVariables(match, {
		apiError: '',
		lastUpdated: '2026-09-12T14:03:05.000Z',
		liveCount: 4,
		liveIndex: 0,
		pollSeconds: 900,
		requestsToday: 7,
	})
	assert.equal(v.match_id, '101')
	assert.equal(v.player1_name, 'Carlos Alcaraz')
	assert.equal(v.player2_name, 'Jannik Sinner')
	assert.equal(v.sets, '1-0')
	assert.equal(v.games, '6-4 3-4')
	assert.equal(v.points, '40-30')
	assert.equal(v.set1, '6-4')
	assert.equal(v.set2, '3-4')
	assert.equal(v.set3, '')
	assert.equal(v.current_set, 2)
	assert.equal(v.current_set_games, '3-4')
	assert.equal(v.server, 2)
	assert.equal(v.server_name, 'Jannik Sinner')
	assert.equal(v.break_point, true)
	assert.equal(v.break_point_player, 1)
	assert.equal(v.tiebreak, false)
	assert.equal(v.match_status, 'live')
	assert.equal(v.tournament, 'US Open')
	assert.equal(v.round, 'Final')
	assert.equal(v.last_updated_time, '14:03:05')
	assert.equal(v.live_index, 1)
	assert.equal(v.live_count, 4)
	assert.equal(v.requests_today, 7)
	assert.equal(v.api_error, '')

	const empty = deriveVariables(null, { apiError: 'rate limited' })
	assert.equal(empty.player1_name, '')
	assert.equal(empty.match_status, 'no match')
	assert.equal(empty.break_point, false)
	assert.equal(empty.server, '')
	assert.equal(empty.api_error, 'rate limited')
	assert.equal(empty.live_index, 0)
	// every value must be JSON-safe for Companion
	for (const [k, val] of Object.entries(v)) {
		assert.ok(['string', 'number', 'boolean'].includes(typeof val), `${k} is ${typeof val}`)
	}
})

test('server and break point are only reported for live matches', () => {
	const done = {
		status: 'completed',
		winner: 1,
		players: { p1: { name: 'A B' }, p2: { name: 'C D' } },
		score: score({ points: ['0', '40'] }),
	}
	const v = deriveVariables(done)
	assert.equal(v.server, '')
	assert.equal(v.break_point, false)
	assert.equal(v.winner_name, 'A B')
})
