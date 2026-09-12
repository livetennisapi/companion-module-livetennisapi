import { Regex } from '@companion-module/base'
import {
	clampPollSeconds,
	requestsPerDay,
	MIN_POLL_SECONDS,
	MAX_POLL_SECONDS,
	DEFAULT_POLL_SECONDS,
	FREE_TIER,
} from '../lib/tennis.js'

export const SELECT_MODES = Object.freeze({
	live_first: 'First live match (cycle with the "Next live match" action)',
	player: 'Live match by player name',
	match_id: 'A specific match id',
})

export const TOUR_CHOICES = [
	{ id: '', label: 'All tours' },
	{ id: 'atp', label: 'ATP' },
	{ id: 'wta', label: 'WTA' },
	{ id: 'challenger', label: 'Challenger' },
	{ id: 'itf', label: 'ITF' },
]

/**
 * Config fields shown in the Companion connection UI.
 * The API key is a `secret-text` field, so Companion keeps it in the secrets
 * store rather than the exported config.
 */
export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'About',
			value:
				'Live scores from the Live Tennis API (livetennisapi.com). ' +
				'Create a FREE key at https://livetennisapi.com — no card needed. ' +
				`The free tier allows ${FREE_TIER.perMinute} requests/min and ${FREE_TIER.perDay} requests/day. ` +
				'This module makes ONE request per poll, so the default ' +
				`${DEFAULT_POLL_SECONDS} s (15 min) cadence uses about ${requestsPerDay(DEFAULT_POLL_SECONDS)} requests/day and fits the free tier. ` +
				`The minimum ${MIN_POLL_SECONDS} s cadence is ${requestsPerDay(MIN_POLL_SECONDS).toLocaleString('en-US')} requests/day and needs a paid plan ` +
				'(Basic 1,000/day, Pro 10,000/day, Ultra 500,000/day). ' +
				'"Refresh now" and match selection actions cost one extra request each. ' +
				'On a rate-limit answer the module backs off automatically (interval doubles, up to 1 hour) and reports it in the api_error variable/feedback.',
		},
		{
			type: 'secret-text',
			id: 'apiKey',
			label: 'API key',
			width: 12,
			tooltip: 'Sent as the X-API-Key header. Never logged.',
			minLength: 8,
		},
		{
			type: 'dropdown',
			id: 'selectMode',
			label: 'Match selection',
			width: 12,
			default: 'live_first',
			choices: Object.entries(SELECT_MODES).map(([id, label]) => ({ id, label })),
			disableAutoExpression: true,
		},
		{
			type: 'textinput',
			id: 'playerName',
			label: 'Player name (surname is enough, or "A vs B")',
			width: 6,
			default: '',
			tooltip: 'Case-insensitive. The first live match involving this player is selected.',
			isVisibleExpression: `$(options:selectMode) == 'player'`,
		},
		{
			type: 'textinput',
			id: 'matchId',
			label: 'Match id',
			width: 6,
			default: '',
			regex: Regex.NUMBER,
			tooltip: 'The numeric id from GET /matches (any status). Polled via GET /matches/{id}.',
			isVisibleExpression: `$(options:selectMode) == 'match_id'`,
		},
		{
			type: 'dropdown',
			id: 'tour',
			label: 'Tour filter for the live list',
			width: 6,
			default: '',
			choices: TOUR_CHOICES,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (seconds)',
			width: 6,
			default: DEFAULT_POLL_SECONDS,
			min: MIN_POLL_SECONDS,
			max: MAX_POLL_SECONDS,
			step: 15,
			clampValues: true,
			asInteger: true,
			tooltip: `${MIN_POLL_SECONDS}-${MAX_POLL_SECONDS} s. Free tier: keep it at ${DEFAULT_POLL_SECONDS} s or higher (${FREE_TIER.perDay} requests/day).`,
		},
	]
}

/** Fill defaults and clamp; never trust the raw config object. */
export function normaliseConfig(config) {
	const c = config && typeof config === 'object' ? config : {}
	const selectMode = Object.prototype.hasOwnProperty.call(SELECT_MODES, c.selectMode) ? c.selectMode : 'live_first'
	const tour = TOUR_CHOICES.some((t) => t.id === c.tour) ? c.tour : ''
	return {
		selectMode,
		playerName: typeof c.playerName === 'string' ? c.playerName.trim() : '',
		matchId: c.matchId === undefined || c.matchId === null ? '' : String(c.matchId).trim(),
		tour,
		pollInterval: clampPollSeconds(c.pollInterval),
	}
}
