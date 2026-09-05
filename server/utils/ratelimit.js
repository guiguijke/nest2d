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

/**
 * A2 (audit compte 2026-09-05) : teste la limite SANS consommer — pour les
 * compteurs qui ne doivent incrémenter que les ÉCHECS (login). Renvoie
 * { allowed, retryAfterMs } avec le délai réel restant dans la fenêtre.
 */
export function rateLimitPeek(key, { limit = 10, windowMs = 60_000 } = {}) {
    sweep(windowMs)
    const now = Date.now()
    const entry = buckets.get(key)
    if (!entry || now - entry.windowStart >= windowMs) {
        return { allowed: true, retryAfterMs: 0 }
    }
    if (entry.count < limit) {
        return { allowed: true, retryAfterMs: 0 }
    }
    return { allowed: false, retryAfterMs: Math.max(1000, entry.windowStart + windowMs - now) }
}

/** A2 : remise à zéro du compteur (connexion réussie). */
export function rateLimitReset(key) {
    buckets.delete(key)
}

export function denyRateLimit(event, { windowMs = 60_000, retryAfterMs = null } = {}) {
    // A2 : délai RÉEL restant quand l'appelant le connaît (peek), et code
    // stable pour un message traduit côté client avec le délai.
    const waitMs = Math.max(1000, retryAfterMs || windowMs)
    const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000))
    setHeader(event, 'Retry-After', String(retryAfterSec))
    throw createError({
        statusCode: 429,
        statusMessage: 'Too many attempts. Please try again later.',
        data: { code: 'rate_limited', retryAfterSec },
    })
}

export function assertRateLimit(event, key, options = {}) {
    const ip = clientIp(event)
    if (!rateLimitAllow(`${key}:${ip}`, options)) {
        denyRateLimit(event, options)
    }
}
