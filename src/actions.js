export function updateActions(self) {
	self.setActionDefinitions({
		select_match_by_id: {
			name: 'Select match by id',
			description: 'Poll a specific match (one request now, then on the normal cadence)',
			options: [
				{
					type: 'textinput',
					id: 'matchId',
					label: 'Match id',
					default: '',
					useVariables: true,
					tooltip: 'Numeric id from GET /matches',
				},
			],
			callback: async (event) => {
				const id = String(event.options.matchId ?? '').trim()
				if (!/^\d+$/.test(id)) {
					self.log('warn', `select_match_by_id: "${id}" is not a numeric match id`)
					return
				}
				await self.selectById(id)
			},
		},
		select_match_by_player: {
			name: 'Select live match by player name',
			description: 'Case-insensitive; a surname is enough. "A vs B" requires both players.',
			options: [
				{
					type: 'textinput',
					id: 'playerName',
					label: 'Player name',
					default: '',
					useVariables: true,
				},
			],
			callback: async (event) => {
				const name = String(event.options.playerName ?? '').trim()
				if (!name) {
					self.log('warn', 'select_match_by_player: empty player name')
					return
				}
				await self.selectByPlayer(name)
			},
		},
		next_live_match: {
			name: 'Next live match',
			description: 'Cycle forward through the last fetched live list (no extra request)',
			options: [],
			callback: async () => self.cycleLive(1),
		},
		previous_live_match: {
			name: 'Previous live match',
			description: 'Cycle backward through the last fetched live list (no extra request)',
			options: [],
			callback: async () => self.cycleLive(-1),
		},
		refresh_now: {
			name: 'Refresh now',
			description: 'Poll immediately (one request; ignored if the last request was under 5 s ago)',
			options: [],
			callback: async () => self.refreshNow(),
		},
	})
}
