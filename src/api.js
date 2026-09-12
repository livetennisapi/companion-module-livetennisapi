/**
 * Minimal HTTPS client for the Live Tennis API.
 *
 * Base URL and paths verified against https://docs.livetennisapi.com/openapi.yaml
 * (retrieved 2026-09-12): servers[0].url = https://api.livetennisapi.com/api/public/v1,
 * auth via the `X-API-Key` header, GET /matches?status=live and GET /matches/{matchId}.
 *
 * The API key is only ever placed in a request header. It is never logged and
 * never part of a URL or an error message.
 */

import { parseRetryAfter, secondsUntil } from '../lib/backoff.js'

export const DEFAULT_BASE_URL = 'https://api.livetennisapi.com/api/public/v1'
export const DEFAULT_TIMEOUT_MS = 15000

export class ApiError extends Error {
	/**
	 * @param {string} message
	 * @param {object} info { status, code, retryAfter, scope, resetsAt }
	 */
	constructor(message, info = {}) {
		super(message)
		this.name = 'ApiError'
		this.status = info.status ?? 0
		this.code = info.code ?? null
		this.retryAfter = info.retryAfter ?? null
		this.scope = info.scope ?? null
		this.resetsAt = info.resetsAt ?? null
	}

	get isNetwork() {
		return this.status === 0
	}
	get isAuth() {
		return this.status === 401
	}
	get isForbidden() {
		return this.status === 403
	}
	get isNotFound() {
		return this.status === 404 || this.status === 410
	}
	get isRateLimited() {
		return this.status === 429
	}
}

/**
 * Build an ApiError from a non-2xx response.
 * @param {number} status
 * @param {Headers|object|null} headers
 * @param {any} body parsed JSON body or raw text
 * @param {number} [now]
 */
export function errorFromResponse(status, headers, body, now = Date.now()) {
	const json = body && typeof body === 'object' ? body : null
	const code = json && typeof json.error === 'string' ? json.error : null
	const detail = json && typeof json.detail === 'string' ? json.detail : ''
	const header = (name) => {
		if (!headers) return null
		if (typeof headers.get === 'function') return headers.get(name)
		return headers[name] ?? headers[name.toLowerCase()] ?? null
	}

	let retryAfter = parseRetryAfter(header('retry-after'), now)
	let scope = json && typeof json.scope === 'string' ? json.scope : null
	let resetsAt = json && typeof json.resets_at === 'string' ? json.resets_at : null
	if (status === 429) {
		if (resetsAt) retryAfter = Math.max(retryAfter ?? 0, secondsUntil(resetsAt, now) ?? 0)
		if (json && Number.isFinite(json.retry_at_epoch)) {
			retryAfter = Math.max(retryAfter ?? 0, secondsUntil(json.retry_at_epoch, now) ?? 0)
			resetsAt = resetsAt ?? new Date(json.retry_at_epoch * 1000).toISOString()
		}
		if (code === 'abuse_throttled') scope = scope ?? 'abuse'
	}

	let message
	switch (status) {
		case 401:
			message = 'API key rejected (401)'
			break
		case 403:
			message = code === 'upgrade_required' ? 'Your plan does not include this request (403)' : 'Forbidden (403)'
			break
		case 404:
			message = 'Match not found (404)'
			break
		case 410:
			message = 'Match id was merged into another record (410)'
			break
		case 429:
			if (scope === 'day') message = 'Daily request quota exhausted (429)'
			else if (scope === 'abuse') message = 'Abuse throttle engaged (429)'
			else message = 'Per-minute rate limit hit (429)'
			break
		default:
			message = `HTTP ${status}`
	}
	if (detail) message += `: ${detail}`
	return new ApiError(message, { status, code, retryAfter, scope, resetsAt })
}

export class LiveTennisClient {
	/**
	 * @param {object} opts
	 * @param {string} opts.apiKey
	 * @param {string} [opts.baseUrl]
	 * @param {Function} [opts.fetchImpl] injectable for tests (defaults to global fetch)
	 * @param {number} [opts.timeoutMs]
	 * @param {string} [opts.userAgent]
	 */
	constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, userAgent }) {
		if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new Error('apiKey is required')
		this.baseUrl = String(baseUrl).replace(/\/+$/, '')
		this.timeoutMs = timeoutMs
		this.userAgent = userAgent ?? 'companion-module-livetennisapi'
		this.fetchImpl = fetchImpl ?? globalThis.fetch
		if (typeof this.fetchImpl !== 'function') throw new Error('fetch is not available (Node 18+ required)')
		// Kept in a closure so the key does not appear on the object for casual inspection/logging.
		const key = apiKey.trim()
		this.headers = () => ({
			'X-API-Key': key,
			Accept: 'application/json',
			'User-Agent': this.userAgent,
		})
	}

	/** Build the request URL. Exposed for tests; never carries the key. */
	url(path, query = {}) {
		const u = new URL(this.baseUrl + path)
		for (const [k, v] of Object.entries(query)) {
			if (v === undefined || v === null || v === '') continue
			u.searchParams.set(k, String(v))
		}
		return u
	}

	async request(path, query = {}) {
		const url = this.url(path, query)
		let res
		try {
			res = await this.fetchImpl(url, {
				method: 'GET',
				headers: this.headers(),
				signal: AbortSignal.timeout(this.timeoutMs),
			})
		} catch (err) {
			const reason = err && err.name === 'TimeoutError' ? 'timed out' : (err && err.message) || 'network error'
			throw new ApiError(`Request failed: ${reason}`, { status: 0, code: 'network' })
		}
		const text = await res.text()
		let body = text
		try {
			body = text ? JSON.parse(text) : null
		} catch {
			// non-JSON body (proxy error page etc.) -- keep the raw text
		}
		if (res.ok) return body
		throw errorFromResponse(res.status, res.headers, body)
	}

	/**
	 * Live matches (one request). Returns the `data` array.
	 * @param {object} [opts] { tour, limit }
	 */
	async listLiveMatches(opts = {}) {
		const body = await this.request('/matches', {
			status: 'live',
			tour: opts.tour,
			limit: opts.limit ?? 200,
		})
		return body && Array.isArray(body.data) ? body.data : []
	}

	/** Full match detail (one request). */
	async getMatch(matchId) {
		const id = String(matchId ?? '').trim()
		if (!/^\d+$/.test(id)) throw new ApiError(`Invalid match id "${id}"`, { status: 400, code: 'bad_request' })
		return this.request(`/matches/${encodeURIComponent(id)}`)
	}
}
