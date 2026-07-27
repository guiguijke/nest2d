/**
 * Minimal in-memory fixed-window rate limiter. Single-process only — fine
 * for the self-hosted single-instance deployment.
 */
const buckets = new Map()
let lastSweep = Date.now()

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

export function assertRateLimit(event, key, options) {
    const ip =
        getRequestIP(event, { xForwardedFor: true }) ||
        event.node.req.socket.remoteAddress ||
        'unknown'
    if (!rateLimitAllow(`${key}:${ip}`, options)) {
        throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Please try again later.' })
    }
}
