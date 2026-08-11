import { connectDB } from '~~/server/db/mongo'
import { getQueueTimes } from '~~/server/features/metrics/queueTimes'
import { assertRateLimit } from '~~/server/utils/ratelimit'

/**
 * GET /api/metrics/queue-times — PUBLIC measured queue/compute stats per
 * tier (p50/p95 over the last 30 days), displayed on /plans. No auth: the
 * payload is aggregates only, never user data. Mongo is hit at most once
 * per minute thanks to the module-level cache (timestamp comparison, no
 * timer — timers break the dev worker loop, see AGENTS.md 36b).
 */
const CACHE_TTL_MS = 60_000
let cache = null // { at: number, data: object }

export default defineEventHandler(async (event) => {
    assertRateLimit(event, 'metrics-queue-times', { limit: 30, windowMs: 60_000 })

    const now = Date.now()
    if (!cache || now - cache.at >= CACHE_TTL_MS) {
        const db = await connectDB()
        cache = { at: now, data: await getQueueTimes(db) }
    }
    setHeader(event, 'Cache-Control', 'public, max-age=60')
    return cache.data
})
