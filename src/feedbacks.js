import { combineRgb } from '@companion-module/base'
import { breakPointFor, isSetFinished, isLive, isFinished } from '../lib/tennis.js'

const PLAYER_CHOICES = [
	{ id: 1, label: 'Player 1' },
	{ id: 2, label: 'Player 2' },
]

const SET_CHOICES = [
	{ id: 'latest', label: 'Most recent set' },
	{ id: 1, label: 'Set 1' },
	{ id: 2, label: 'Set 2' },
	{ id: 3, label: 'Set 3' },
	{ id: 4, label: 'Set 4' },
	{ id: 5, label: 'Set 5' },
]

export const COLORS = {
	white: combineRgb(255, 255, 255),
	black: combineRgb(0, 0, 0),
	green: combineRgb(0, 140, 0),
	grey: combineRgb(80, 80, 80),
	yellow: combineRgb(255, 200, 0),
	orange: combineRgb(255, 110, 0),
	blue: combineRgb(0, 90, 200),
	red: combineRgb(200, 0, 0),
}

export function updateFeedbacks(self) {
	const match = () => self.state.match
	const score = () => self.state.match?.score ?? null

	self.setFeedbackDefinitions({
		match_live: {
			type: 'boolean',
			name: 'Match is live',
			description: 'True while the selected match is in play',
			defaultStyle: { bgcolor: COLORS.green, color: COLORS.white },
			options: [],
			callback: () => isLive(match()),
		},
		match_finished: {
			type: 'boolean',
			name: 'Match is finished',
			description: 'True once the selected match is completed or cancelled',
			defaultStyle: { bgcolor: COLORS.grey, color: COLORS.white },
			options: [],
			callback: () => isFinished(match()),
		},
		match_selected: {
			type: 'boolean',
			name: 'A match is selected',
			description: 'True when the module currently holds a match (live list non-empty, id found, or player found)',
			defaultStyle: { bgcolor: COLORS.blue, color: COLORS.white },
			options: [],
			callback: () => match() !== null && match() !== undefined,
		},
		set_finished: {
			type: 'boolean',
			name: 'Set finished',
			description: 'True when the chosen set is over (uses the API sets tally; falls back to the 6/7-game rules)',
			defaultStyle: { bgcolor: COLORS.grey, color: COLORS.white },
			options: [
				{
					type: 'dropdown',
					id: 'set',
					label: 'Set',
					default: 'latest',
					choices: SET_CHOICES,
				},
			],
			callback: (feedback) => isSetFinished(score(), feedback.options.set),
		},
		tiebreak_in_progress: {
			type: 'boolean',
			name: 'Tiebreak in progress',
			description: 'True while the live match is in a tiebreak',
			defaultStyle: { bgcolor: COLORS.blue, color: COLORS.white },
			options: [],
			callback: () => isLive(match()) && score()?.is_tiebreak === true,
		},
		break_point: {
			type: 'boolean',
			name: 'Break point',
			description: 'Receiver at AD, or receiver at 40 with the server at 0/15/30. Never during a tiebreak.',
			defaultStyle: { bgcolor: COLORS.orange, color: COLORS.black },
			options: [
				{
					type: 'dropdown',
					id: 'player',
					label: 'Break point for',
					default: 0,
					choices: [{ id: 0, label: 'Either player' }, ...PLAYER_CHOICES],
				},
			],
			callback: (feedback) => {
				if (!isLive(match())) return false
				const holder = breakPointFor(score())
				if (holder === 0) return false
				const want = Number(feedback.options.player) || 0
				return want === 0 || want === holder
			},
		},
		player_serving: {
			type: 'boolean',
			name: 'Player is serving',
			description: 'True while the chosen player is serving in the live match',
			defaultStyle: { bgcolor: COLORS.yellow, color: COLORS.black },
			options: [
				{
					type: 'dropdown',
					id: 'player',
					label: 'Player',
					default: 1,
					choices: PLAYER_CHOICES,
				},
			],
			callback: (feedback) => isLive(match()) && score()?.server === Number(feedback.options.player),
		},
		api_error: {
			type: 'boolean',
			name: 'API problem',
			description:
				'True while the last poll failed (bad key, rate limit/backoff, network, plan limit). See the api_error variable.',
			defaultStyle: { bgcolor: COLORS.red, color: COLORS.white },
			options: [],
			callback: () => self.state.apiError !== '',
		},
	})
}
