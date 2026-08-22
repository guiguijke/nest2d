/**
 * Minimal in-memory fixed-window rate limiter. Single-process only — fine
 * for the self-hosted single-instance deployment.
 *
 * Client IP: NEVER trust the first X-Forwarded-For hop (the client can
 * spoof it). Prefer Cloudflare's CF-Connecting-IP; otherwise the LAST
 * XFF hop (the one the trusted proxy appended). Confirmed in prod: first
 * hop let 6 contact mails through a 5/h cap (pentest H-3).
 */
const buckets = new Map()
let lastSweep = Date.now()

function headerValue(headers, name) {
    if (!headers) return ''
    const raw = headers[name] || headers[name.toLowerCase()]
    if (Array.isArray(raw)) return String(raw[0] || '')
    return typeof raw === 'string' ? raw : ''
}

export function clientIp(event) {
    const headers = event?.node?.req?.headers || {}
    const cf = headerValue(headers, 'cf-connecting-ip').trim()
    if (cf) return cf
    const xff = headerValue(headers, 'x-forwarded-for')
    if (xff) {
        const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
        if (hops.length) return hops[hops.length - 1]
    }
    return (
        getRequestIP(event, { xForwardedFor: false }) ||
        event?.node?.req?.socket?.remoteAddress ||
        'unknown'
    )
}

function sweep(windowMs) {
    const now = Date.now()
    if (now - lastSweep < windowMs) return
    lastSweep = now
    for (const [key, entry] of buckets) {
        if (now - entry.windowStart > windowMs * 2) buckets.delete(key)
    }
}

/**
 * Returns true if the action is allowed, false if the limit is exceeded.
 */
export function rateLimitAllow(key, { limit = 10, windowMs = 60_000 } = {}) {
    sweep(windowMs)
    const now = Date.now()
    const entry = buckets.get(key)
    if (!entry || now - entry.windowStart >= windowMs) {
        buckets.set(key, { windowStart: now, count: 1 })
        return true
    }
    entry.count += 1
    return entry.count <= limit
}

export function denyRateLimit(event, { windowMs = 60_000 } = {}) {
    setHeader(event, 'Retry-After', String(Math.max(1, Math.ceil(windowMs / 1000))))
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Please try again later.' })
}

export function assertRateLimit(event, key, options = {}) {
    const ip = clientIp(event)
    if (!rateLimitAllow(`${key}:${ip}`, options)) {
        denyRateLimit(event, options)
    }
}
