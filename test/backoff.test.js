import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Backoff, parseRetryAfter, secondsUntil, MAX_BACKOFF_SECONDS } from '../lib/backoff.js'

test('backoff doubles from the poll interval and caps at one hour', () => {
	const b = new Backoff(900)
	assert.equal(b.active, false)
	assert.equal(b.delay, 900)
	assert.equal(b.fail(), 1800)
	assert.equal(b.fail(), 3600)
	assert.equal(b.fail(), 3600)
	assert.equal(b.active, true)
	assert.equal(b.failures, 3)
	b.reset()
	assert.equal(b.delay, 900)
	assert.equal(b.active, false)
})

test('backoff from the 15 s floor climbs to the cap', () => {
	const b = new Backoff(15)
	const seen = []
	for (let i = 0; i < 10; i++) seen.push(b.fail())
	assert.deepEqual(seen, [30, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600])
	assert.equal(MAX_BACKOFF_SECONDS, 3600)
})

test('retry-after can lengthen but never shorten or exceed the cap', () => {
	const b = new Backoff(900)
	assert.equal(b.fail(60), 1800)
	assert.equal(b.fail(3000), 3600)
	const c = new Backoff(15)
	assert.equal(c.fail(45), 45)
	assert.equal(c.fail(999999), 3600)
	assert.equal(c.fail(null), 3600)
})

test('setBase keeps the cap sane', () => {
	const b = new Backoff(0)
	assert.equal(b.base, 1)
	b.setBase(30)
	assert.equal(b.delay, 30)
})

test('parseRetryAfter: seconds, HTTP-date, garbage', () => {
	const now = Date.parse('2026-09-12T12:00:00Z')
	assert.equal(parseRetryAfter('60'), 60)
	assert.equal(parseRetryAfter(' 5 '), 5)
	assert.equal(parseRetryAfter('Sat, 12 Sep 2026 12:01:30 GMT', now), 90)
	assert.equal(parseRetryAfter('Sat, 12 Sep 2026 11:00:00 GMT', now), 0)
	assert.equal(parseRetryAfter(null), null)
	assert.equal(parseRetryAfter(''), null)
	assert.equal(parseRetryAfter('soon'), null)
})

test('secondsUntil handles ISO strings, epoch seconds and junk', () => {
	const now = Date.parse('2026-09-12T12:00:00Z')
	assert.equal(secondsUntil('2026-09-12T12:10:00Z', now), 600)
	assert.equal(secondsUntil('2026-09-12T11:00:00Z', now), 0)
	assert.equal(secondsUntil(now / 1000 + 30, now), 30)
	assert.equal(secondsUntil('nope', now), null)
	assert.equal(secondsUntil(null, now), null)
})
