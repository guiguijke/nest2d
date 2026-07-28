import { connectDB } from '~~/server/db/mongo'

/**
 * Aggregated activity stats for the current user, used by the profile page
 * and dashboard. Counts are computed from the source collections (projects,
 * nesting_jobs, user_dxf_files…) rather than from the unreliable
 * `user.nesting_count` counter, which is nesting-only and never read.
 *
 * A single $facet round-trip gathers every count at once. "This month" uses
 * calendar-month UTC bounds to match the freeNestingPeriod convention.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const db = await connectDB()
    const startOfMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
    )

    // One aggregation over nesting_jobs for nesting-related counts + parts.
    const [nestingAgg = {}] = await db.collection('nesting_jobs').aggregate([
        { $match: { ownerId: userId } },
        {
            $facet: {
                total: [{ $count: 'n' }],
                completed: [{ $match: { status: 'done' } }, { $count: 'n' }],
                failed: [{ $match: { status: 'error' } }, { $count: 'n' }],
                partsPlaced: [
                    { $match: { status: 'done' } },
                    { $group: { _id: null, total: { $sum: '$requested' } } },
                ],
                thisMonth: [
                    { $match: { createdAt: { $gte: startOfMonth } } },
                    { $count: 'n' },
                ],
            },
        },
    ]).toArray()

    const pick = (arr) => (Array.isArray(arr) && arr[0]?.n != null ? arr[0].n : 0)
    const sumField = (arr) =>
        Array.isArray(arr) && arr[0]?.total != null ? arr[0].total : 0

    // DXF files + projects are simple counts, run in parallel.
    const [
        projects,
        dxfFiles,
        dxfProcessed,
    ] = await Promise.all([
        db.collection('projects').countDocuments({ ownerId: userId }),
        db.collection('user_dxf_files').countDocuments({ ownerId: userId }),
        db.collection('user_dxf_files').countDocuments({
            ownerId: userId,
            processingStatus: 'completed',
        }),
    ])

    return {
        projects,
        nestings: pick(nestingAgg.total),
        nestingsCompleted: pick(nestingAgg.completed),
        nestingsFailed: pick(nestingAgg.failed),
        partsNested: sumField(nestingAgg.partsPlaced),
        nestingsThisMonth: pick(nestingAgg.thisMonth),
        dxfFiles,
        dxfProcessed,
    }
})
