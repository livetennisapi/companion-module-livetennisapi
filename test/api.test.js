import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LiveTennisClient, ApiError, errorFromResponse, DEFAULT_BASE_URL } from '../src/api.js'

function fakeResponse(status, body, headers = {}) {
	const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	}
}

test('base URL and paths follow the OpenAPI spec', async () => {
	assert.equal(DEFAULT_BASE_URL, 'https://api.livetennisapi.com/api/public/v1')
	const calls = []
	const client = new LiveTennisClient({
		apiKey: 'sk_test_SECRET',
		fetchImpl: async (url, init) => {
			calls.push({ url: String(url), init })
			return fakeResponse(200, { data: [{ id: 1 }], meta: { count: 1 } })
		},
	})
	const list = await client.listLiveMatches({ tour: 'atp' })
	assert.deepEqual(list, [{ id: 1 }])
	assert.equal(calls[0].url, 'https://api.livetennisapi.com/api/public/v1/matches?status=live&tour=atp&limit=200')
	assert.equal(calls[0].init.headers['X-API-Key'], 'sk_test_SECRET')
	assert.equal(calls[0].init.headers.Accept, 'application/json')
	assert.ok(calls[0].init.signal, 'request has a timeout signal')
	assert.ok(!calls[0].url.includes('SECRET'), 'key never in the URL')

	await client.getMatch(187701)
	assert.equal(calls[1].url, 'https://api.livetennisapi.com/api/public/v1/matches/187701')
	assert.ok(
		!Object.keys(client).some((k) => String(client[k]).includes('SECRET')),
		'key not stored as a plain property',
	)
})

test('list without a data array returns []', async () => {
	const client = new LiveTennisClient({ apiKey: 'k', fetchImpl: async () => fakeResponse(200, {}) })
	assert.deepEqual(await client.listLiveMatches(), [])
})

test('invalid match id is rejected before any request', async () => {
	let called = false
	const client = new LiveTennisClient({
		apiKey: 'k',
		fetchImpl: async () => {
			called = true
			return fakeResponse(200, {})
		},
	})
	await assert.rejects(client.getMatch('abc'), (e) => e instanceof ApiError && e.status === 400)
	await assert.rejects(client.getMatch(''), ApiError)
	assert.equal(called, false)
})

test('missing key or fetch is refused', () => {
	assert.throws(() => new LiveTennisClient({ apiKey: '' }))
	assert.throws(() => new LiveTennisClient({ apiKey: 'k', fetchImpl: 42 }))
})

test('HTTP errors map to typed ApiErrors', async () => {
	const mk = (status, body, headers) =>
		new LiveTennisClient({ apiKey: 'k', fetchImpl: async () => fakeResponse(status, body, headers) })
	await assert.rejects(mk(401, { error: 'unauthorized' }).getMatch(1), (e) => e.isAuth && e.status === 401)
	await assert.rejects(
		mk(403, { error: 'upgrade_required' }).getMatch(1),
		(e) => e.isForbidden && e.code === 'upgrade_required',
	)
	await assert.rejects(mk(404, { error: 'not_found' }).getMatch(1), (e) => e.isNotFound)
	await assert.rejects(mk(410, { forwarded_to: 2 }).getMatch(1), (e) => e.isNotFound && e.status === 410)
	await assert.rejects(mk(500, '<html>oops</html>').getMatch(1), (e) => e.status === 500 && e.message === 'HTTP 500')
	await assert.rejects(
		mk(429, { error: 'rate_limited', detail: 'slow down' }, { 'Retry-After': '30' }).getMatch(1),
		(e) => e.isRateLimited && e.retryAfter === 30 && e.message.includes('slow down'),
	)
})

test('network failures and timeouts become status 0', async () => {
	const boom = new LiveTennisClient({
		apiKey: 'k',
		fetchImpl: async () => {
			throw new TypeError('fetch failed')
		},
	})
	await assert.rejects(
		boom.getMatch(1),
		(e) => e instanceof ApiError && e.isNetwork && e.message.includes('fetch failed'),
	)
	const slow = new LiveTennisClient({
		apiKey: 'k',
		fetchImpl: async () => {
			const err = new Error('The operation was aborted due to timeout')
			err.name = 'TimeoutError'
			throw err
		},
	})
	await assert.rejects(slow.getMatch(1), (e) => e.isNetwork && e.message.includes('timed out'))
})

test('429 body shapes: per-minute, per-day (resets_at), abuse (retry_at_epoch)', () => {
	const now = Date.parse('2026-09-12T12:00:00Z')
	const minute = errorFromResponse(429, { 'retry-after': '20' }, { error: 'rate_limited', tier: 'FREE' }, now)
	assert.equal(minute.retryAfter, 20)
	assert.equal(minute.scope, null)
	assert.match(minute.message, /Per-minute/)

	const day = errorFromResponse(
		429,
		{ 'retry-after': '20' },
		{ error: 'rate_limited', scope: 'day', limit_per_day: 100, resets_at: '2026-09-13T00:00:00Z' },
		now,
	)
	assert.equal(day.scope, 'day')
	assert.equal(day.retryAfter, 12 * 3600)
	assert.equal(day.resetsAt, '2026-09-13T00:00:00Z')
	assert.match(day.message, /Daily request quota/)

	const abuse = errorFromResponse(429, null, { error: 'abuse_throttled', retry_at_epoch: now / 1000 + 86400 }, now)
	assert.equal(abuse.scope, 'abuse')
	assert.equal(abuse.retryAfter, 86400)
	assert.match(abuse.message, /Abuse throttle/)

	const bare = errorFromResponse(429, null, null, now)
	assert.equal(bare.retryAfter, null)
	assert.equal(bare.isRateLimited, true)
})
