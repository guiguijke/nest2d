/**
 * Measured queue/compute times per compute tier, for the public /plans page.
 *
 * Source of truth: `nesting_jobs` docs that reached status 'done' with the
 * three real timestamps (createdAt → startAt → finishedAt). Browser-computed
 * jobs (Mode Local) are never claimed by a worker, so they have no startAt
 * and are excluded naturally by the $exists filters. Demo jobs
 * (ownerId 'demo') are excluded — their anti-abuse profile is not
 * representative of a paid tier.
 *
 * Tier resolution: recent jobs carry `compute.level` ('free' | 'standard' |
 * 'privacy') written server-side; older jobs only have `params.vcores`
 * (8 → privacy, 4 → standard, otherwise free). Numbers are MEASURED, never
 * marketing — that honesty is the selling point.
 */
import { DEMO_OWNER_ID } from '../../../shared/constants/demo.constants'

export const QUEUE_TIMES_WINDOW_DAYS = 30

const TIERS = ['free', 'standard', 'privacy']

/**
 * Percentile with linear interpolation between closest ranks (numpy 'linear'
 * method) on an already-sorted array.
 */
function percentile(sorted, p) {
    if (sorted.length === 1) return sorted[0]
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * Pure aggregation. rows = [{ tier, waitSec, wallSec }]; returns per-tier
 * { jobs, waitP50Sec, waitP95Sec, wallP50Sec, wallP95Sec } or null when the
 * tier has no usable job. Structurally aberrant values (negative wait —
 * clock skew between API and worker — or non-positive wall) are dropped.
 */
export function summarizeQueueTimes(rows) {
    const byTier = { free: [], standard: [], privacy: [] }
    for (const row of rows || []) {
        if (!byTier[row?.tier]) continue
        const waitSec = Number(row.waitSec)
        const wallSec = Number(row.wallSec)
        if (!Number.isFinite(waitSec) || !Number.isFinite(wallSec)) continue
        if (waitSec < 0 || wallSec <= 0) continue
        byTier[row.tier].push({ waitSec, wallSec })
    }
    const tiers = {}
    for (const tier of TIERS) {
        const list = byTier[tier]
        if (!list.length) {
            tiers[tier] = null
            continue
        }
        const waits = list.map((r) => r.waitSec).sort((a, b) => a - b)
        const walls = list.map((r) => r.wallSec).sort((a, b) => a - b)
        tiers[tier] = {
            jobs: list.length,
            waitP50Sec: percentile(waits, 50),
            waitP95Sec: percentile(waits, 95),
            wallP50Sec: percentile(walls, 50),
            wallP95Sec: percentile(walls, 95),
        }
    }
    return tiers
}

function resolveTier(doc) {
    const level = doc?.compute?.level
    if (TIERS.includes(level)) return level
    const vcores = Number(doc?.params?.vcores)
    if (vcores >= 8) return 'privacy'
    if (vcores >= 4) return 'standard'
    return 'free'
}

/**
 * Queries done jobs over the last 30 rolling days and aggregates wait
 * (startAt - createdAt) and wall (finishedAt - startAt) times per tier.
 */
export async function getQueueTimes(db) {
    const now = new Date()
    const since = new Date(now.getTime() - QUEUE_TIMES_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const docs = await db
        .collection('nesting_jobs')
        .find({
            status: 'done',
            createdAt: { $gte: since },
            startAt: { $exists: true },
            finishedAt: { $exists: true },
            ownerId: { $ne: DEMO_OWNER_ID },
        })
        .project({
            'compute.level': 1,
            'params.vcores': 1,
            createdAt: 1,
            startAt: 1,
            finishedAt: 1,
        })
        .toArray()
    const rows = docs.map((doc) => ({
        tier: resolveTier(doc),
        waitSec: (doc.startAt - doc.createdAt) / 1000,
        wallSec: (doc.finishedAt - doc.startAt) / 1000,
    }))
    return {
        windowDays: QUEUE_TIMES_WINDOW_DAYS,
        generatedAt: now.toISOString(),
        tiers: summarizeQueueTimes(rows),
    }
}
