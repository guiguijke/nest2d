import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Weekly retention cohorts.
//
// A cohort = users grouped by signup week (Monday start). For each cohort,
// retained[w] = % of its users with at least one tracked event in week w
// after their signup (w=0 is the signup week). Activity comes from the
// `tracking` collection (one doc per event, userId backfilled at login),
// reduced to distinct (userId, day) pairs first so event storms don't skew
// anything.
//
// NB: users who signed up before the tracking instrumentation have no events
// — their cohort still counts them in `size`, which deflates their
// percentages. The UI mentions it.
const DAY = 86400000
const WEEK = 7 * DAY
const MAX_WEEKS = 8
// Epoch day 0 (1970-01-01) was a Thursday; Monday is epoch day 4.
const MONDAY_EPOCH_DAYS = 4

export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const db = await connectDB()

    const [users, activeDays] = await Promise.all([
        db
            .collection(COL.users)
            .find({}, { projection: { _id: 0, id: 1, createdAt: 1 } })
            .limit(20000)
            .toArray(),
        db
            .collection(COL.tracking)
            .aggregate([
                { $match: { userId: { $type: 'string' } } },
                {
                    $group: {
                        _id: {
                            userId: '$userId',
                            day: { $dateTrunc: { date: '$timestamp', unit: 'day' } },
                        },
                    },
                },
            ])
            .toArray(),
    ])

    const daysByUser = new Map<string, Set<number>>()
    for (const d of activeDays) {
        const set = daysByUser.get(d._id.userId) || new Set<number>()
        set.add(Math.floor(new Date(d._id.day).getTime() / DAY))
        daysByUser.set(d._id.userId, set)
    }

    const cohorts = new Map<number, { week: number; size: number; retained: number[] }>()
    const summarize = (week: number) => cohorts.get(week) || { week, size: 0, retained: new Array(MAX_WEEKS + 1).fill(0) }

    // Rolling denominators for the W1/W4 summary (only cohorts old enough).
    let eligibleW1 = 0
    let retainedW1 = 0
    let eligibleW4 = 0
    let retainedW4 = 0

    for (const u of users) {
        if (!u.createdAt) continue
        const createdMs = new Date(u.createdAt).getTime()
        const createdDay = Math.floor(createdMs / DAY)
        const cohortWeek = Math.floor((createdDay - MONDAY_EPOCH_DAYS) / 7)
        const entry = summarize(cohortWeek)
        entry.size++
        cohorts.set(cohortWeek, entry)

        const days = daysByUser.get(u.id)
        if (days) {
            const seenWeeks = new Set<number>()
            for (const day of days) {
                const w = Math.floor((day - createdDay) / 7)
                if (w >= 0 && w <= MAX_WEEKS) seenWeeks.add(w)
            }
            for (const w of seenWeeks) entry.retained[w]++
        }

        const ageWeeks = (Date.now() - createdMs) / WEEK
        const activeIn = (w: number) => (days ? [...days].some((d) => Math.floor((d - createdDay) / 7) === w) : false)
        if (ageWeeks >= 2) {
            eligibleW1++
            if (activeIn(1)) retainedW1++
        }
        if (ageWeeks >= 5) {
            eligibleW4++
            if (activeIn(4)) retainedW4++
        }
    }

    const fmtLabel = (week: number) => {
        const monday = new Date((week * 7 + MONDAY_EPOCH_DAYS) * DAY)
        return monday.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    }

    const rows = [...cohorts.values()]
        .sort((a, b) => b.week - a.week)
        .map((c) => {
            const mondayMs = (c.week * 7 + MONDAY_EPOCH_DAYS) * DAY
            return {
                label: fmtLabel(c.week),
                size: c.size,
                // Weeks this cohort has actually lived — the UI shows "—"
                // beyond this so young cohorts don't read as 0% retention.
                age: Math.min(MAX_WEEKS, Math.floor((Date.now() - mondayMs) / WEEK)),
                retained: c.retained.map((n) => (c.size ? Math.round((n / c.size) * 100) : 0)),
            }
        })

    return {
        cohorts: rows,
        summary: {
            trackedUsers: daysByUser.size,
            totalUsers: users.length,
            w1: eligibleW1 ? Math.round((retainedW1 / eligibleW1) * 100) : null,
            w4: eligibleW4 ? Math.round((retainedW4 / eligibleW4) * 100) : null,
        },
    }
})
