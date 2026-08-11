import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Measured queue/compute times per compute tier over the last 30 rolling
// days. Direct TS port of the main app's server/features/metrics/queueTimes.js
// (same logic, same exclusions) — keep the two in sync.
//
// Source of truth: `nesting_jobs` docs that reached status 'done' with the
// three real timestamps (createdAt → startAt → finishedAt). Browser-computed
// jobs (Mode Local) have no startAt and are excluded by the $exists filters.
// Demo jobs (ownerId 'demo') are excluded.
//
// Tier resolution: `compute.level` ('free' | 'standard' | 'privacy') when
// present, else `params.vcores` (8 → privacy, 4 → standard, otherwise free).

const QUEUE_TIMES_WINDOW_DAYS = 30
const DEMO_OWNER_ID = 'demo' // mirrors shared/constants/demo.constants
const TIERS = ['free', 'standard', 'privacy'] as const
type Tier = (typeof TIERS)[number]

// Percentile with linear interpolation between closest ranks (numpy 'linear')
// on an already-sorted array.
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 1) return sorted[0]
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function resolveTier(doc: any): Tier {
    const level = doc?.compute?.level
    if ((TIERS as readonly string[]).includes(level)) return level
    const vcores = Number(doc?.params?.vcores)
    if (vcores >= 8) return 'privacy'
    if (vcores >= 4) return 'standard'
    return 'free'
}

export default defineEventHandler(async (event) => {
    requireAdmin(event)

    const db = await connectDB()
    const now = new Date()
    const since = new Date(now.getTime() - QUEUE_TIMES_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    const docs = await db
        .collection(COL.nestingJobs)
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

    // Group per tier; structurally aberrant values (negative wait — clock
    // skew between API and worker — or non-positive wall) are dropped.
    const byTier: Record<Tier, { waitSec: number; wallSec: number }[]> = {
        free: [],
        standard: [],
        privacy: [],
    }
    for (const doc of docs) {
        const waitSec = (doc.startAt.getTime() - doc.createdAt.getTime()) / 1000
        const wallSec = (doc.finishedAt.getTime() - doc.startAt.getTime()) / 1000
        if (!Number.isFinite(waitSec) || !Number.isFinite(wallSec)) continue
        if (waitSec < 0 || wallSec <= 0) continue
        byTier[resolveTier(doc)].push({ waitSec, wallSec })
    }

    const tiers: Record<Tier, any> = {}
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

    return {
        windowDays: QUEUE_TIMES_WINDOW_DAYS,
        generatedAt: now.toISOString(),
        tiers,
    }
})
