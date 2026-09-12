import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { UpgradeScripts } from './upgrades.js'
import { getConfigFields, normaliseConfig } from './config.js'
import { updateActions } from './actions.js'
import { updateFeedbacks } from './feedbacks.js'
import { updateVariableDefinitions } from './variables.js'
import { updatePresets } from './presets.js'
import { LiveTennisClient, ApiError } from './api.js'
import { Backoff } from '../lib/backoff.js'
import { deriveVariables, findMatchesByPlayer, indexOfMatch, cycleIndex, matchTitle } from '../lib/tennis.js'

export { UpgradeScripts }

const MODULE_VERSION = '0.1.0'
/** Minimum gap between an on-demand "Refresh now" and the previous request. */
const MANUAL_REFRESH_MIN_GAP_MS = 5000

export default class LiveTennisInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.config = normaliseConfig({})
		this.client = null
		this.backoff = new Backoff(this.config.pollInterval)
		this.timer = null
		this.nextPollSeconds = null
		this.polling = false
		this.pendingPoll = false
		this.state = {
			match: null,
			live: [],
			liveIndex: -1,
			selection: { mode: 'live_first', matchId: '', playerName: '' },
			finalFetched: false,
			apiError: '',
			lastUpdated: '',
			requestsToday: 0,
			requestsDay: '',
			lastRequestAt: 0,
		}
	}

	async init(config, _isFirstInit, secrets) {
		updateActions(this)
		updateFeedbacks(this)
		updateVariableDefinitions(this)
		updatePresets(this)
		await this.applyConfig(config, secrets)
	}

	async configUpdated(config, secrets) {
		updatePresets(this) // the label may have changed
		await this.applyConfig(config, secrets)
	}

	async destroy() {
		this.stopPolling()
		this.client = null
		this.log('debug', 'destroy')
	}

	getConfigFields() {
		return getConfigFields()
	}

	// ---------------------------------------------------------------- config

	async applyConfig(config, secrets) {
		this.stopPolling()
		this.config = normaliseConfig(config)
		this.backoff = new Backoff(this.config.pollInterval)
		this.state.selection = {
			mode: this.config.selectMode,
			matchId: this.config.matchId,
			playerName: this.config.playerName,
		}
		this.state.match = null
		this.state.live = []
		this.state.liveIndex = -1
		this.state.finalFetched = false

		// The key lives in the secrets store (secret-text field). Older hosts that
		// do not split secrets out would deliver it inside config instead.
		const rawKey = secrets?.apiKey ?? config?.apiKey ?? ''
		const apiKey = typeof rawKey === 'string' ? rawKey.trim() : ''
		if (!apiKey) {
			this.client = null
			this.state.apiError = 'no API key configured'
			this.updateStatus(InstanceStatus.BadConfig, 'API key missing. Get a free key at https://livetennisapi.com')
			this.publish()
			return
		}

		this.client = new LiveTennisClient({
			apiKey,
			userAgent: `companion-module-livetennisapi/${MODULE_VERSION}`,
		})
		this.state.apiError = ''
		this.updateStatus(InstanceStatus.Connecting)
		this.publish()
		await this.pollNow()
	}

	// --------------------------------------------------------------- polling

	stopPolling() {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	schedule(seconds) {
		this.stopPolling()
		const ms = Math.max(1, Math.round(seconds * 1000))
		this.nextPollSeconds = seconds
		this.timer = setTimeout(() => {
			this.timer = null
			void this.poll()
		}, ms)
	}

	/** Poll immediately, or right after the poll that is already in flight. */
	async pollNow() {
		if (this.polling) {
			this.pendingPoll = true
			return
		}
		await this.poll()
	}

	async poll() {
		if (!this.client || this.polling) return
		this.polling = true
		this.stopPolling()
		let nextDelay = this.config.pollInterval
		try {
			const problem = await this.refresh()
			this.backoff.reset()
			this.state.apiError = ''
			this.state.lastUpdated = new Date().toISOString()
			if (problem) {
				this.updateStatus(problem.status, problem.message)
			} else {
				this.updateStatus(InstanceStatus.Ok)
			}
		} catch (err) {
			nextDelay = this.handleError(err)
		} finally {
			this.polling = false
			this.publish()
			if (this.pendingPoll) {
				this.pendingPoll = false
				nextDelay = 1
			}
			if (this.client) this.schedule(nextDelay)
		}
	}

	/**
	 * One poll cycle. Throws ApiError on transport/HTTP failure.
	 * @returns {null|{status: string, message: string}} a non-error status to show
	 */
	async refresh() {
		const sel = this.state.selection

		if (sel.mode === 'match_id') {
			if (!sel.matchId) {
				this.state.match = null
				return { status: InstanceStatus.BadConfig, message: 'Match id missing in the connection config' }
			}
			const match = await this.fetchMatch(sel.matchId)
			this.state.match = match
			this.state.liveIndex = indexOfMatch(this.state.live, match?.id)
			return null
		}

		if (sel.mode === 'player' && !sel.playerName) {
			this.state.match = null
			return { status: InstanceStatus.BadConfig, message: 'Player name missing in the connection config' }
		}

		const live = await this.fetchLive()
		this.state.live = live
		const currentId = this.state.match?.id
		const idx = indexOfMatch(live, currentId)
		if (idx >= 0) {
			this.select(live[idx], idx)
			return null
		}

		// The selected match has left the live list: fetch its final state once
		// so match_finished fires with the final score, then move on next cycle.
		if (currentId !== undefined && currentId !== null && !this.state.finalFetched) {
			try {
				this.state.match = await this.fetchMatch(currentId)
			} catch (err) {
				if (!(err instanceof ApiError && err.isNotFound)) throw err
			}
			this.state.finalFetched = true
			this.state.liveIndex = -1
			return null
		}

		if (sel.mode === 'player') {
			const found = findMatchesByPlayer(live, sel.playerName)
			if (found.length > 0) {
				this.select(found[0], indexOfMatch(live, found[0].id))
				return null
			}
			return {
				status: InstanceStatus.UnknownWarning,
				message: `No live match found for "${sel.playerName}" (${live.length} live)`,
			}
		}

		// live_first
		if (live.length > 0) {
			this.select(live[0], 0)
			return null
		}
		return { status: InstanceStatus.UnknownWarning, message: 'No live matches right now' }
	}

	/** Map a failure to a status, an api_error text and the delay before the next poll (seconds). */
	handleError(err) {
		const base = this.config.pollInterval
		if (!(err instanceof ApiError)) {
			const message = err && err.message ? err.message : String(err)
			this.log('error', `Unexpected error: ${message}`)
			this.state.apiError = message
			this.updateStatus(InstanceStatus.UnknownError, message)
			return base
		}

		if (err.isAuth) {
			this.state.apiError = 'invalid API key'
			this.updateStatus(
				InstanceStatus.AuthenticationFailure,
				'API key rejected (401). Check the key in the connection config.',
			)
			this.log('error', err.message)
			return Math.max(base, 300)
		}
		if (err.isForbidden) {
			this.state.apiError = err.code === 'upgrade_required' ? 'plan does not include this request' : 'forbidden'
			this.updateStatus(InstanceStatus.UnknownWarning, err.message)
			this.log('warn', err.message)
			return Math.max(base, 300)
		}
		if (err.isNotFound) {
			this.state.match = null
			this.state.apiError = 'match not found'
			this.updateStatus(InstanceStatus.UnknownWarning, err.message)
			this.log('warn', err.message)
			return base
		}
		if (err.isRateLimited) {
			const delay = this.backoff.fail(err.retryAfter)
			let text
			if (err.scope === 'day') {
				const until = err.resetsAt ? ` (resets ${err.resetsAt})` : ''
				text = `daily quota exhausted${until}; next poll in ${delay}s`
			} else if (err.scope === 'abuse') {
				text = `abuse throttle; next poll in ${delay}s`
			} else {
				text = `rate limited; next poll in ${delay}s`
			}
			this.state.apiError = text
			this.updateStatus(InstanceStatus.UnknownWarning, `${err.message}. Backing off: next poll in ${delay}s`)
			this.log('warn', `${err.message}; backing off ${delay}s (poll interval ${base}s)`)
			return delay
		}
		if (err.isNetwork) {
			const delay = this.backoff.fail()
			this.state.apiError = err.message
			this.updateStatus(InstanceStatus.ConnectionFailure, `${err.message}. Retrying in ${delay}s`)
			this.log('error', `${err.message}; retrying in ${delay}s`)
			return delay
		}
		const delay = this.backoff.fail()
		this.state.apiError = err.message
		this.updateStatus(InstanceStatus.UnknownError, `${err.message}. Retrying in ${delay}s`)
		this.log('error', `${err.message}; retrying in ${delay}s`)
		return delay
	}

	// -------------------------------------------------------------- requests

	countRequest() {
		const day = new Date().toISOString().slice(0, 10)
		if (this.state.requestsDay !== day) {
			this.state.requestsDay = day
			this.state.requestsToday = 0
		}
		this.state.requestsToday += 1
		this.state.lastRequestAt = Date.now()
	}

	async fetchLive() {
		this.countRequest()
		return this.client.listLiveMatches({ tour: this.config.tour })
	}

	async fetchMatch(id) {
		this.countRequest()
		return this.client.getMatch(id)
	}

	// ------------------------------------------------------------- selection

	select(match, index) {
		this.state.match = match
		this.state.liveIndex = Number.isInteger(index) ? index : indexOfMatch(this.state.live, match?.id)
		this.state.finalFetched = false
	}

	/** Action: select by id. Uses the cached live list when possible, otherwise polls now. */
	async selectById(id) {
		this.state.selection = { mode: 'match_id', matchId: String(id), playerName: '' }
		const idx = indexOfMatch(this.state.live, id)
		if (idx >= 0) {
			this.select(this.state.live[idx], idx)
			this.log('info', `Selected match ${id} (${matchTitle(this.state.match)}) from the cached live list`)
			this.publish()
			if (this.client && !this.polling) this.schedule(this.config.pollInterval)
			return
		}
		this.state.match = null
		this.state.finalFetched = false
		this.publish()
		await this.pollNow()
	}

	/** Action: select by player name. Uses the cached live list when possible, otherwise polls now. */
	async selectByPlayer(name) {
		this.state.selection = { mode: 'player', matchId: '', playerName: name }
		const found = findMatchesByPlayer(this.state.live, name)
		if (found.length > 0) {
			const idx = indexOfMatch(this.state.live, found[0].id)
			this.select(found[0], idx)
			this.log('info', `Selected ${matchTitle(found[0])} for "${name}" from the cached live list`)
			this.publish()
			if (this.client && !this.polling) this.schedule(this.config.pollInterval)
			return
		}
		this.state.match = null
		this.state.finalFetched = false
		this.publish()
		await this.pollNow()
	}

	/** Action: cycle through the cached live list. Costs no request unless the list is empty. */
	async cycleLive(step) {
		this.state.selection = { mode: 'live_first', matchId: '', playerName: '' }
		const live = this.state.live
		if (live.length === 0) {
			await this.pollNow()
			return
		}
		const current = indexOfMatch(live, this.state.match?.id)
		const idx = cycleIndex(live.length, current, step)
		this.select(live[idx], idx)
		this.log('info', `Live match ${idx + 1}/${live.length}: ${matchTitle(live[idx])}`)
		this.publish()
	}

	/** Action: refresh now, rate-guarded so a held button cannot burn the budget. */
	async refreshNow() {
		const since = Date.now() - this.state.lastRequestAt
		if (since < MANUAL_REFRESH_MIN_GAP_MS) {
			this.log('info', `Refresh ignored: last request ${Math.round(since / 1000)}s ago`)
			return
		}
		await this.pollNow()
	}

	// --------------------------------------------------------------- publish

	publish() {
		this.setVariableValues(
			deriveVariables(this.state.match, {
				apiError: this.state.apiError,
				lastUpdated: this.state.lastUpdated,
				liveCount: this.state.live.length,
				liveIndex: this.state.liveIndex,
				pollSeconds: this.config.pollInterval,
				requestsToday: this.state.requestsToday,
			}),
		)
		this.checkAllFeedbacks()
	}
}
