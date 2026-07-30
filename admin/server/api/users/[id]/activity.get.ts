import { requireAdmin } from '../../../utils/auth'
import { connectDB, COL } from '../../../db/mongo'

// Per-user activity: recent jobs (nesting + strip merged) + aggregate totals.
//
// Job metadata is stored in plaintext even for vault users (only the files and
// geometry are encrypted), so the admin can always see usage.
export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

    const db = await connectDB()

    // Project a small, display-oriented slice from each job collection.
    const proj = {
        _id: 0,
        slug: 1,
        projectSlug: 1,
        stripSlug: 1,
        status: 1,
        density: 1,
        usedSheetShare: 1,
        placed: 1,
        requested: 1,
        layoutCount: 1,
        width: 1, // strip-only
        timeTaken: 1,
        startAt: 1,
        finishedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        error: 1,
        'params.computeLevel': 1,
        'params.timeBudgetSec': 1,
        charge: 1,
    }

    // Last 30 jobs from each system, tagged with the system name.
    const [classic, strip] = await Promise.all([
        db
            .collection(COL.nestingJobs)
            .find({ ownerId: id }, { projection: proj })
            .sort({ finishedAt: -1, createdAt: -1 })
            .limit(30)
            .toArray()
            .then((rows) => rows.map((r: any) => ({ ...r, system: 'nesting' }))),
        db
            .collection(COL.stripJobQueue)
            .find({ ownerId: id }, { projection: proj })
            .sort({ finishedAt: -1, createdAt: -1 })
            .limit(30)
            .toArray()
            .then((rows) => rows.map((r: any) => ({ ...r, system: 'strip' }))),
    ])

    // Merge + sort by most recent activity.
    const jobs = [...classic, ...strip]
        .sort((a, b) => {
            const at = new Date(a.finishedAt || a.updatedAt || a.createdAt).getTime()
            const bt = new Date(b.finishedAt || b.updatedAt || b.createdAt).getTime()
            return bt - at
        })
        .slice(0, 30)

    // Aggregate totals across ALL the user's jobs (not just the last 30).
    const [classicTotals, stripTotals] = await Promise.all([
        db
            .collection(COL.nestingJobs)
            .aggregate([
                { $match: { ownerId: id } },
                {
                    $group: {
                        _id: null,
                        totalJobs: { $sum: 1 },
                        totalTimeMin: { $sum: { $ifNull: ['$timeTaken', 0] } },
                        placed: { $sum: { $ifNull: ['$placed', 0] } },
                        finished: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
                        failed: { $sum: { $cond: [{ $in: ['$status', ['error', 'failed']] }, 1, 0] } },
                        avgDensity: { $avg: { $ifNull: ['$density', null] } },
                        sheets: { $sum: { $ifNull: ['$layoutCount', 0] } },
                    },
                },
            ])
            .toArray(),
        db
            .collection(COL.stripJobQueue)
            .aggregate([
                { $match: { ownerId: id } },
                {
                    $group: {
                        _id: null,
                        totalJobs: { $sum: 1 },
                        totalTimeMin: { $sum: { $ifNull: ['$timeTaken', 0] } },
                        placed: { $sum: { $ifNull: ['$placed', 0] } },
                        finished: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
                        failed: { $sum: { $cond: [{ $in: ['$status', ['error', 'failed']] }, 1, 0] } },
                    },
                },
            ])
            .toArray(),
    ])

    const c = classicTotals[0] || {}
    const s = stripTotals[0] || {}
    const totals = {
        totalJobs: (c.totalJobs || 0) + (s.totalJobs || 0),
        totalTimeMin: (c.totalTimeMin || 0) + (s.totalTimeMin || 0),
        placed: (c.placed || 0) + (s.placed || 0),
        finished: (c.finished || 0) + (s.finished || 0),
        failed: (c.failed || 0) + (s.failed || 0),
        avgDensity: c.avgDensity || null,
        sheets: c.sheets || 0,
    }

    return { jobs, totals }
})
