/**
 * Rate-limit backoff state. Pure; unit tested offline.
 *
 * On a 429 the poll delay doubles from the configured interval each time,
 * capped at MAX_BACKOFF_SECONDS (1 h). A Retry-After (or the API's
 * `resets_at` / `retry_at_epoch` hint) can lengthen the delay but never
 * shorten it below the doubled value, and never past the cap.
 */

export const MAX_BACKOFF_SECONDS = 3600

export class Backoff {
	/**
	 * @param {number} baseSeconds  the normal poll interval
	 * @param {number} [maxSeconds]
	 */
	constructor(baseSeconds, maxSeconds = MAX_BACKOFF_SECONDS) {
		this.base = Math.max(1, Number(baseSeconds) || 1)
		this.max = Math.max(this.base, Number(maxSeconds) || MAX_BACKOFF_SECONDS)
		this.current = null
		this.failures = 0
	}

	get active() {
		return this.current !== null
	}

	/** Delay to use for the next poll, in seconds. */
	get delay() {
		return this.current ?? this.base
	}

	/**
	 * Register a failure. Returns the delay (seconds) to wait before retrying.
	 * @param {number|null} [retryAfterSeconds] server hint, if any
	 */
	fail(retryAfterSeconds = null) {
		this.failures += 1
		const doubled = (this.current ?? this.base) * 2
		let delay = Math.min(this.max, doubled)
		if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
			delay = Math.min(this.max, Math.max(delay, Math.ceil(retryAfterSeconds)))
		}
		this.current = delay
		return delay
	}

	reset() {
		this.current = null
		this.failures = 0
	}

	setBase(baseSeconds) {
		this.base = Math.max(1, Number(baseSeconds) || 1)
		if (this.max < this.base) this.max = this.base
	}
}

/**
 * Parse an HTTP Retry-After header value (delta-seconds or HTTP-date).
 * Returns whole seconds >= 0, or null when absent/unparseable.
 */
export function parseRetryAfter(value, now = Date.now()) {
	if (value === null || value === undefined) return null
	const s = String(value).trim()
	if (s === '') return null
	if (/^\d+$/.test(s)) return Number(s)
	const t = Date.parse(s)
	if (Number.isNaN(t)) return null
	return Math.max(0, Math.ceil((t - now) / 1000))
}

/** Seconds from `now` until an ISO instant; null when unparseable. Never negative. */
export function secondsUntil(iso, now = Date.now()) {
	if (!iso) return null
	const t = typeof iso === 'number' ? iso * 1000 : Date.parse(String(iso))
	if (Number.isNaN(t)) return null
	return Math.max(0, Math.ceil((t - now) / 1000))
}
