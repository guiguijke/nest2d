import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Human-readable "what happened today" view.
//
// Aggregates signups, finished jobs (+ compute time), payments, and an
// hourly activity pulse from the tracking collection. Returns a small, fixed
// payload designed for the readable Activity tab.
export default defineEventHandler(async (event) => {
    requireAdmin(event)

    const db = await connectDB()
    const q = getQuery(event)
    // Default window: today (since midnight). Allow a custom number of days.
    const windowDays = Math.min(7, Math.max(1, parseInt(q.windowDays as string) || 1))
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

    const sinceToday = new Date()
    sinceToday.setHours(0, 0, 0, 0)

    // ---- Signups ----
    const signups = await db
        .collection(COL.users)
        .find(
            { createdAt: { $gte: since } },
            { projection: { _id: 0, id: 1, name: 1, email: 1, provider: 1, signupCountry: 1, createdAt: 1 } },
        )
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()

    // ---- Finished jobs (nesting + strip) ----
    const jobMatch = { finishedAt: { $gte: since }, status: 'done' }
    const [classicJobs, stripJobs] = await Promise.all([
        db
            .collection(COL.nestingJobs)
            .aggregate([
                { $match: jobMatch },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        totalTimeMin: { $sum: { $ifNull: ['$timeTaken', 0] } },
                        avgDensity: { $avg: { $ifNull: ['$density', null] } },
                    },
                },
            ])
            .toArray(),
        db
            .collection(COL.stripJobQueue)
            .aggregate([
                { $match: jobMatch },
                { $group: { _id: null, count: { $sum: 1 }, totalTimeMin: { $sum: { $ifNull: ['$timeTaken', 0] } } } },
            ])
            .toArray(),
    ])
    const c = classicJobs[0] || {}
    const s = stripJobs[0] || {}
    const jobsToday = {
        count: (c.count || 0) + (s.count || 0),
        nestingCount: c.count || 0,
        stripCount: s.count || 0,
        totalTimeMin: (c.totalTimeMin || 0) + (s.totalTimeMin || 0),
        avgDensity: c.avgDensity || null,
    }

    // ---- Payments today ----
    const newSubscriptions = await db.collection('subscription_checkouts').countDocuments({
        createdAt: { $gte: since },
    })

    // ---- Hourly activity pulse (events per hour) ----
    const pulse = await db
        .collection(COL.tracking)
        .aggregate([
            { $match: { timestamp: { $gte: since } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%H:00', date: '$timestamp' } },
                    events: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ])
        .toArray()
        .then((rows) => rows.map((r: any) => ({ hour: r._id, events: r.events })))

    return {
        windowDays,
        since,
        signups,
        jobsToday,
        payments: { newSubscriptions },
        pulse,
    }
})
