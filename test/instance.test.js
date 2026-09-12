/**
 * Behaviour tests for the module instance against a fake Companion host
 * context and a scripted fetch. No network, no real timers left running.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InstanceStatus } from '@companion-module/base'
import LiveTennisInstance, { UpgradeScripts } from '../src/main.js'

function fakeContext() {
	const ctx = {
		id: 'test-instance',
		_isInstanceContext: true,
		label: 'livetennis',
		statuses: [],
		variables: {},
		feedbackChecks: 0,
		definitions: {},
		saveConfig() {},
		setActionDefinitions(d) {
			ctx.definitions.actions = d
		},
		setFeedbackDefinitions(d) {
			ctx.definitions.feedbacks = d
		},
		setVariableDefinitions(d) {
			ctx.definitions.variables = d
		},
		setPresetDefinitions(structure, presets) {
			ctx.definitions.presets = { structure, presets }
		},
		setVariableValues(values) {
			Object.assign(ctx.variables, values)
		},
		checkAllFeedbacks() {
			ctx.feedbackChecks += 1
		},
		checkFeedbacks() {},
		checkFeedbacksById() {},
		updateStatus(status, message) {
			ctx.statuses.push({ status, message })
		},
		log() {},
	}
	return ctx
}

const match = (id, p1, p2, over = {}) => ({
	id,
	status: 'live',
	tournament: 'Test Open',
	round: 'QF',
	players: { p1: { name: p1 }, p2: { name: p2 } },
	score: {
		sets: [1, 0],
		games: [
			[6, 2],
			[4, 3],
		],
		points: ['30', '40'],
		server: 1,
		is_tiebreak: false,
	},
	...over,
})

function jsonResponse(status, body, headers = {}) {
	const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
		text: async () => JSON.stringify(body),
	}
}

/** Install a scripted fetch; `script` is a function (url) => response|Error. */
function withFetch(script) {
	const calls = []
	const original = globalThis.fetch
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init })
		const out = await script(String(url), calls.length)
		if (out instanceof Error) throw out
		return out
	}
	return { calls, restore: () => (globalThis.fetch = original) }
}

async function boot(config, secrets, script) {
	const ctx = fakeContext()
	const f = withFetch(script)
	const inst = new LiveTennisInstance(ctx)
	await inst.init({ pollInterval: 900, ...config }, true, secrets)
	return { ctx, inst, calls: f.calls, done: async () => (await inst.destroy(), f.restore()) }
}

const lastStatus = (ctx) => ctx.statuses[ctx.statuses.length - 1]

test('exports the API 2.x entrypoint contract', () => {
	assert.equal(typeof LiveTennisInstance, 'function')
	assert.ok(Array.isArray(UpgradeScripts))
})

test('no API key: BadConfig, no request, api_error set', async () => {
	const { ctx, calls, done } = await boot({}, undefined, () => jsonResponse(200, { data: [] }))
	assert.equal(lastStatus(ctx).status, InstanceStatus.BadConfig)
	assert.equal(calls.length, 0)
	assert.equal(ctx.variables.api_error, 'no API key configured')
	assert.equal(ctx.variables.match_status, 'no match')
	assert.ok(ctx.definitions.actions.next_live_match)
	assert.ok(ctx.definitions.feedbacks.break_point)
	assert.ok(ctx.definitions.variables.player1_name)
	assert.ok(ctx.definitions.presets.presets.scorebug.style.text.includes('$(livetennis:player1_name)'))
	await done()
})

test('first live match: one list request, variables, cycling without requests', async () => {
	const live = [match(101, 'Carlos Alcaraz', 'Jannik Sinner'), match(102, 'Iga Swiatek', 'Aryna Sabalenka')]
	const { ctx, inst, calls, done } = await boot({}, { apiKey: 'k' }, () => jsonResponse(200, { data: live }))
	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, 'https://api.livetennisapi.com/api/public/v1/matches?status=live&limit=200')
	assert.equal(calls[0].init.headers['X-API-Key'], 'k')
	assert.equal(lastStatus(ctx).status, InstanceStatus.Ok)
	assert.equal(ctx.variables.player1_name, 'Carlos Alcaraz')
	assert.equal(ctx.variables.player2_name, 'Jannik Sinner')
	assert.equal(ctx.variables.sets, '1-0')
	assert.equal(ctx.variables.games, '6-4 2-3')
	assert.equal(ctx.variables.points, '30-40')
	assert.equal(ctx.variables.server, 1)
	assert.equal(ctx.variables.break_point, true)
	assert.equal(ctx.variables.break_point_player, 2)
	assert.equal(ctx.variables.match_status, 'live')
	assert.equal(ctx.variables.live_count, 2)
	assert.equal(ctx.variables.live_index, 1)
	assert.equal(ctx.variables.requests_today, 1)
	assert.equal(ctx.variables.api_error, '')
	assert.equal(inst.nextPollSeconds, 900)
	assert.ok(ctx.feedbackChecks >= 1)

	await inst.cycleLive(1)
	assert.equal(ctx.variables.player1_name, 'Iga Swiatek')
	assert.equal(ctx.variables.live_index, 2)
	await inst.cycleLive(1)
	assert.equal(ctx.variables.live_index, 1)
	await inst.cycleLive(-1)
	assert.equal(ctx.variables.live_index, 2)
	assert.equal(calls.length, 1, 'cycling costs no request')

	// feedback callbacks read the live state
	const fb = ctx.definitions.feedbacks
	assert.equal(fb.match_live.callback({ options: {} }), true)
	assert.equal(fb.match_finished.callback({ options: {} }), false)
	assert.equal(fb.break_point.callback({ options: { player: 0 } }), true)
	assert.equal(fb.break_point.callback({ options: { player: 2 } }), true)
	assert.equal(fb.break_point.callback({ options: { player: 1 } }), false)
	assert.equal(fb.player_serving.callback({ options: { player: 1 } }), true)
	assert.equal(fb.player_serving.callback({ options: { player: 2 } }), false)
	assert.equal(fb.set_finished.callback({ options: { set: 1 } }), true)
	assert.equal(fb.set_finished.callback({ options: { set: 'latest' } }), false)
	assert.equal(fb.tiebreak_in_progress.callback({ options: {} }), false)
	assert.equal(fb.api_error.callback({ options: {} }), false)
	assert.equal(fb.match_selected.callback({ options: {} }), true)
	await done()
})

test('401: AuthenticationFailure, api_error, slow retry', async () => {
	const { ctx, inst, done } = await boot({}, { apiKey: 'bad' }, () => jsonResponse(401, { error: 'unauthorized' }))
	assert.equal(lastStatus(ctx).status, InstanceStatus.AuthenticationFailure)
	assert.equal(ctx.variables.api_error, 'invalid API key')
	assert.equal(inst.nextPollSeconds, 900)
	assert.equal(ctx.definitions.feedbacks.api_error.callback({ options: {} }), true)
	await done()
})

test('429: warning + doubling backoff to the 1 h cap, then reset on success', async () => {
	let mode = '429'
	const { ctx, inst, done } = await boot({}, { apiKey: 'k' }, () =>
		mode === '429'
			? jsonResponse(429, { error: 'rate_limited', tier: 'FREE' }, { 'Retry-After': '30' })
			: jsonResponse(200, { data: [match(7, 'A One', 'B Two')] }),
	)
	assert.equal(lastStatus(ctx).status, InstanceStatus.UnknownWarning)
	assert.match(ctx.variables.api_error, /rate limited; next poll in 1800s/)
	assert.equal(inst.nextPollSeconds, 1800)
	await inst.poll()
	assert.equal(inst.nextPollSeconds, 3600)
	await inst.poll()
	assert.equal(inst.nextPollSeconds, 3600, 'capped at one hour')
	mode = 'ok'
	await inst.poll()
	assert.equal(lastStatus(ctx).status, InstanceStatus.Ok)
	assert.equal(ctx.variables.api_error, '')
	assert.equal(inst.nextPollSeconds, 900, 'back to the configured interval')
	assert.equal(ctx.variables.player1_name, 'A One')
	await done()
})

test('429 daily quota: message names the reset instant', async () => {
	const { ctx, done } = await boot({}, { apiKey: 'k' }, () =>
		jsonResponse(429, { error: 'rate_limited', scope: 'day', limit_per_day: 100, resets_at: '2099-01-01T00:00:00Z' }),
	)
	assert.match(ctx.variables.api_error, /daily quota exhausted \(resets 2099-01-01T00:00:00Z\); next poll in 3600s/)
	assert.match(lastStatus(ctx).message, /Daily request quota exhausted/)
	await done()
})

test('network failure: ConnectionFailure with backoff', async () => {
	const { ctx, inst, done } = await boot({}, { apiKey: 'k' }, () => new TypeError('fetch failed'))
	assert.equal(lastStatus(ctx).status, InstanceStatus.ConnectionFailure)
	assert.match(ctx.variables.api_error, /fetch failed/)
	assert.equal(inst.nextPollSeconds, 1800)
	await done()
})

test('player mode: case-insensitive surname; clear status when nobody matches', async () => {
	const live = [match(101, 'Carlos Alcaraz', 'Jannik Sinner'), match(102, 'Iga Swiatek', 'Aryna Sabalenka')]
	const script = () => jsonResponse(200, { data: live })
	const a = await boot({ selectMode: 'player', playerName: 'SABALENKA' }, { apiKey: 'k' }, script)
	assert.equal(a.ctx.variables.match_id, '102')
	assert.equal(a.ctx.variables.live_index, 2)
	await a.inst.selectByPlayer('alcaraz')
	assert.equal(a.ctx.variables.match_id, '101')
	assert.equal(a.calls.length, 1, 'served from the cached list')
	await a.done()

	const b = await boot({ selectMode: 'player', playerName: 'Nobody' }, { apiKey: 'k' }, script)
	assert.equal(lastStatus(b.ctx).status, InstanceStatus.UnknownWarning)
	assert.match(lastStatus(b.ctx).message, /No live match found for "Nobody" \(2 live\)/)
	assert.equal(b.ctx.variables.match_status, 'no match')
	assert.equal(b.ctx.variables.api_error, '', 'not an API error')
	await b.done()

	const c = await boot({ selectMode: 'player', playerName: '' }, { apiKey: 'k' }, script)
	assert.equal(lastStatus(c.ctx).status, InstanceStatus.BadConfig)
	assert.equal(c.calls.length, 0)
	await c.done()
})

test('match id mode polls /matches/{id}; 404 clears the match', async () => {
	const a = await boot({ selectMode: 'match_id', matchId: '555' }, { apiKey: 'k' }, (url) =>
		url.endsWith('/matches/555')
			? jsonResponse(200, match(555, 'P One', 'P Two', { status: 'completed', winner: 2 }))
			: jsonResponse(500, {}),
	)
	assert.equal(a.calls[0].url, 'https://api.livetennisapi.com/api/public/v1/matches/555')
	assert.equal(a.ctx.variables.match_status, 'completed')
	assert.equal(a.ctx.variables.winner_name, 'P Two')
	assert.equal(a.ctx.definitions.feedbacks.match_finished.callback({ options: {} }), true)
	assert.equal(a.ctx.variables.server, '', 'no server once completed')
	await a.done()

	const b = await boot({ selectMode: 'match_id', matchId: '9' }, { apiKey: 'k' }, () =>
		jsonResponse(404, { error: 'not_found' }),
	)
	assert.equal(lastStatus(b.ctx).status, InstanceStatus.UnknownWarning)
	assert.equal(b.ctx.variables.api_error, 'match not found')
	assert.equal(b.ctx.variables.match_status, 'no match')
	await b.done()
})

test('selected match leaves the live list: final state fetched once, then advance', async () => {
	let phase = 1
	const { ctx, inst, calls, done } = await boot({}, { apiKey: 'k' }, (url) => {
		if (url.endsWith('/matches/101')) return jsonResponse(200, match(101, 'A', 'B', { status: 'completed', winner: 1 }))
		return phase === 1
			? jsonResponse(200, { data: [match(101, 'A', 'B'), match(102, 'C', 'D')] })
			: jsonResponse(200, { data: [match(102, 'C', 'D')] })
	})
	assert.equal(ctx.variables.match_id, '101')
	phase = 2
	await inst.poll()
	assert.equal(calls.length, 3, 'list + one final fetch')
	assert.equal(ctx.variables.match_id, '101')
	assert.equal(ctx.variables.match_status, 'completed')
	assert.equal(ctx.variables.winner_name, 'A')
	await inst.poll()
	assert.equal(calls.length, 4, 'no second final fetch')
	assert.equal(ctx.variables.match_id, '102')
	assert.equal(ctx.variables.match_status, 'live')
	await done()
})

test('refresh now is guarded against rapid repeats', async () => {
	const { inst, calls, done } = await boot({}, { apiKey: 'k' }, () => jsonResponse(200, { data: [] }))
	assert.equal(calls.length, 1)
	await inst.refreshNow()
	assert.equal(calls.length, 1, 'ignored within 5 s of the last request')
	inst.state.lastRequestAt = Date.now() - 10000
	await inst.refreshNow()
	assert.equal(calls.length, 2)
	await done()
})

test('configUpdated resets the selection and stops the old timer', async () => {
	const { ctx, inst, calls, done } = await boot({}, { apiKey: 'k' }, () =>
		jsonResponse(200, { data: [match(1, 'A', 'B')] }),
	)
	await inst.selectById('1')
	assert.equal(inst.state.selection.mode, 'match_id')
	await inst.configUpdated({ selectMode: 'live_first', pollInterval: 30 }, { apiKey: 'k' })
	assert.equal(inst.state.selection.mode, 'live_first')
	assert.equal(inst.config.pollInterval, 30)
	assert.equal(inst.nextPollSeconds, 30)
	assert.equal(ctx.variables.poll_interval, 30)
	assert.equal(calls.length, 2)
	await inst.configUpdated({ pollInterval: 1 }, {})
	assert.equal(lastStatus(ctx).status, InstanceStatus.BadConfig)
	assert.equal(inst.timer, null, 'no timer without a client')
	await done()
})
