import { clientIp, rateLimitAllow, denyRateLimit } from '~~/server/utils/ratelimit'

/**
 * /api/files/** is the download surface whose slug used to be a 24-bit
 * secret (pentest C-1). 30 req/min per session (IP as fallback) makes a
 * brute-force of even a short leftover slug impractical.
 */
export default defineEventHandler((event) => {
    const url = String(event.path || event.node?.req?.url || '')
    if (!url.startsWith('/api/files')) return

    const userId = event.context?.auth?.userId
    const ip = clientIp(event)
    const key = userId ? `files:user:${userId}` : `files:ip:${ip}`
    const windowMs = 60_000
    if (!rateLimitAllow(key, { limit: 30, windowMs })) {
        denyRateLimit(event, { windowMs })
    }
})
