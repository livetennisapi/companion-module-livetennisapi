import { COLORS } from './feedbacks.js'

/**
 * Presets reference variables by the connection label, so they are rebuilt
 * whenever the label may have changed (init and configUpdated).
 */
export function updatePresets(self) {
	const v = (id) => `$(${self.label}:${id})`
	const base = { size: 'auto', color: COLORS.white, bgcolor: COLORS.black }
	const fb = (feedbackId, style, options = {}) => ({ feedbackId, options, style })
	const statusFeedbacks = () => [
		fb('match_live', { bgcolor: COLORS.green, color: COLORS.white }),
		fb('match_finished', { bgcolor: COLORS.grey, color: COLORS.white }),
		fb('api_error', { bgcolor: COLORS.red, color: COLORS.white }),
	]
	const noAction = [{ down: [], up: [] }]

	const presets = {
		scorebug: {
			type: 'simple',
			name: 'Scorebug (names, sets, current set)',
			style: {
				...base,
				text: `${v('player1_name')}\n${v('sets')}  ${v('current_set_games')}\n${v('player2_name')}`,
				size: '14',
			},
			steps: noAction,
			feedbacks: statusFeedbacks(),
		},
		score_line: {
			type: 'simple',
			name: 'Full score line',
			style: { ...base, text: `${v('score_line')}`, size: '14' },
			steps: noAction,
			feedbacks: statusFeedbacks(),
		},
		player1: {
			type: 'simple',
			name: 'Player 1 (highlights when serving / facing a break point)',
			style: { ...base, text: `${v('player1_name')}\n${v('set_scores')}`, size: '14' },
			steps: noAction,
			feedbacks: [
				fb('player_serving', { bgcolor: COLORS.yellow, color: COLORS.black }, { player: 1 }),
				fb('break_point', { bgcolor: COLORS.orange, color: COLORS.black }, { player: 2 }),
			],
		},
		player2: {
			type: 'simple',
			name: 'Player 2 (highlights when serving / facing a break point)',
			style: { ...base, text: `${v('player2_name')}\n${v('set_scores')}`, size: '14' },
			steps: noAction,
			feedbacks: [
				fb('player_serving', { bgcolor: COLORS.yellow, color: COLORS.black }, { player: 2 }),
				fb('break_point', { bgcolor: COLORS.orange, color: COLORS.black }, { player: 1 }),
			],
		},
		points: {
			type: 'simple',
			name: 'Points (tiebreak blue, break point orange)',
			style: { ...base, text: `${v('points')}`, size: '30' },
			steps: noAction,
			feedbacks: [
				fb('tiebreak_in_progress', { bgcolor: COLORS.blue, color: COLORS.white }),
				fb('break_point', { bgcolor: COLORS.orange, color: COLORS.black }, { player: 0 }),
			],
		},
		sets_games: {
			type: 'simple',
			name: 'Sets and games',
			style: { ...base, text: `Sets ${v('sets')}\n${v('games')}`, size: '14' },
			steps: noAction,
			feedbacks: statusFeedbacks(),
		},
		match_status: {
			type: 'simple',
			name: 'Match status',
			style: { ...base, text: `${v('match_status')}\n${v('tournament')}\n${v('round')}`, size: '14' },
			steps: noAction,
			feedbacks: statusFeedbacks(),
		},
		api_status: {
			type: 'simple',
			name: 'API status (red on error)',
			style: { ...base, text: `API\n${v('api_error')}\n${v('requests_today')} req today`, size: '7' },
			steps: noAction,
			feedbacks: [fb('api_error', { bgcolor: COLORS.red, color: COLORS.white })],
		},
		next_live: {
			type: 'simple',
			name: 'Next live match',
			style: { ...base, text: `Next live\n${v('live_index')}/${v('live_count')}`, size: '14' },
			steps: [{ down: [{ actionId: 'next_live_match', options: {} }], up: [] }],
			feedbacks: [],
		},
		previous_live: {
			type: 'simple',
			name: 'Previous live match',
			style: { ...base, text: `Prev live\n${v('live_index')}/${v('live_count')}`, size: '14' },
			steps: [{ down: [{ actionId: 'previous_live_match', options: {} }], up: [] }],
			feedbacks: [],
		},
		refresh: {
			type: 'simple',
			name: 'Refresh now',
			style: { ...base, text: `Refresh\n${v('last_updated_time')}`, size: '14' },
			steps: [{ down: [{ actionId: 'refresh_now', options: {} }], up: [] }],
			feedbacks: [fb('api_error', { bgcolor: COLORS.red, color: COLORS.white })],
		},
	}

	const structure = [
		{
			id: 'scorebug',
			name: 'Scorebug',
			definitions: ['scorebug', 'score_line', 'player1', 'player2', 'points', 'sets_games', 'match_status'],
		},
		{
			id: 'control',
			name: 'Control',
			definitions: ['next_live', 'previous_live', 'refresh', 'api_status'],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
