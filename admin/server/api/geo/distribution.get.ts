import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Geographic distribution of clients.
//
// Two sources, merged:
//  1. users.signupCountry — the country captured at signup (best, but only
//     present for users who signed up after the instrumentation was added).
//  2. tracking.country    — the country of recorded events (cf-ipcountry).
//     Covers legacy users and gives an activity-weighted view.
//
// We return a ranked list of countries with user counts and event counts,
// plus a 30-day signup trend per country for the top countries.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = await connectDB()
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [bySignup, byTracking, signups30d] = await Promise.all([
    // Distinct users per signup country.
    db
      .collection(COL.users)
      .aggregate([
        { $match: { signupCountry: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$signupCountry', users: { $sum: 1 } } },
        { $sort: { users: -1 } },
      ])
      .toArray(),
    // Event volume per country (activity-weighted).
    db
      .collection(COL.tracking)
      .aggregate([
        { $match: { country: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$country', events: { $sum: 1 }, distinctUsers: { $addToSet: '$userId' } } },
        {
          $project: {
            _id: 1,
            events: 1,
            users: { $size: '$distinctUsers' },
          },
        },
        { $sort: { events: -1 } },
      ])
      .toArray(),
    // New signups per country over the last 30 days (trend).
    db
      .collection(COL.users)
      .aggregate([
        { $match: { createdAt: { $gte: since30d }, signupCountry: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$signupCountry', signups30d: { $sum: 1 } } },
        { $sort: { signups30d: -1 } },
      ])
      .toArray(),
  ])

  // Merge into a single map keyed by country code.
  const map = new Map<string, any>()
  for (const r of bySignup) map.set(r._id, { country: r._id, users: r.users, events: 0, eventUsers: 0, signups30d: 0 })
  for (const r of byTracking) {
    const entry = map.get(r._id) || { country: r._id, users: 0, events: 0, eventUsers: 0, signups30d: 0 }
    entry.events = r.events
    entry.eventUsers = r.users
    if (!map.has(r._id)) map.set(r._id, entry)
  }
  for (const r of signups30d) {
    const entry = map.get(r._id) || { country: r._id, users: 0, events: 0, eventUsers: 0, signups30d: 0 }
    entry.signups30d = r.signups30d
    if (!map.has(r._id)) map.set(r._id, entry)
  }

  const countries = [...map.values()].sort((a, b) => b.users - a.users || b.events - a.events)

  const totalUsers = countries.reduce((s, c) => s + c.users, 0)
  const totalEvents = countries.reduce((s, c) => s + c.events, 0)
  const unknownUsers = (await db.collection(COL.users).countDocuments({
    $or: [{ signupCountry: null }, { signupCountry: '' }, { signupCountry: { $exists: false } }],
  }))

  return {
    countries,
    totals: { users: totalUsers, events: totalEvents, unknownUsers },
    generatedAt: new Date(),
  }
})
