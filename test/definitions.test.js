import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VARIABLE_DEFINITIONS } from '../src/variables.js'
import { deriveVariables } from '../lib/tennis.js'
import { normaliseConfig, getConfigFields } from '../src/config.js'

test('every published variable is defined, and every definition is published', () => {
	const published = Object.keys(deriveVariables(null))
	const defined = Object.keys(VARIABLE_DEFINITIONS)
	assert.deepEqual(
		published.filter((k) => !defined.includes(k)),
		[],
		'published but undefined',
	)
	assert.deepEqual(
		defined.filter((k) => !published.includes(k)),
		[],
		'defined but never published',
	)
	for (const id of defined) assert.match(id, /^[a-zA-Z0-9_-]+$/, `variable id "${id}" has illegal characters`)
})

test('normaliseConfig fills defaults and clamps the poll interval', () => {
	assert.deepEqual(normaliseConfig(undefined), {
		selectMode: 'live_first',
		playerName: '',
		matchId: '',
		tour: '',
		pollInterval: 900,
	})
	const c = normaliseConfig({
		selectMode: 'player',
		playerName: '  Sinner ',
		matchId: 187701,
		tour: 'wta',
		pollInterval: 1,
	})
	assert.equal(c.selectMode, 'player')
	assert.equal(c.playerName, 'Sinner')
	assert.equal(c.matchId, '187701')
	assert.equal(c.tour, 'wta')
	assert.equal(c.pollInterval, 15)
	assert.equal(normaliseConfig({ selectMode: 'bogus', tour: 'nfl', pollInterval: 'x' }).selectMode, 'live_first')
	assert.equal(normaliseConfig({ tour: 'nfl' }).tour, '')
	assert.equal(normaliseConfig({ pollInterval: 99999 }).pollInterval, 3600)
})

test('config UI states the free tier limits and uses a secret field for the key', () => {
	const fields = getConfigFields()
	const info = fields.find((f) => f.id === 'info')
	assert.match(info.value, /30 requests\/min/)
	assert.match(info.value, /100 requests\/day/)
	assert.match(info.value, /900 s/)
	const key = fields.find((f) => f.id === 'apiKey')
	assert.equal(key.type, 'secret-text')
	const poll = fields.find((f) => f.id === 'pollInterval')
	assert.equal(poll.min, 15)
	assert.equal(poll.max, 3600)
	assert.equal(poll.default, 900)
	for (const f of fields) assert.ok(Number.isInteger(f.width) && f.width >= 1 && f.width <= 12, `${f.id} width`)
})
