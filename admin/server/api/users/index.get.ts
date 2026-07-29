import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Paginated, searchable user list with filters.
//
// Query params:
//   q        — free text (matches email/name/id, case-insensitive)
//   provider — 'local' | 'google'
//   status   — 'active' | 'banned' | 'subscriber' | 'granted'
//   country  — signup country code (exact)
//   page     — 1-based (default 1)
//   limit    — page size (default 50, max 200)
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 50))
  const skip = (page - 1) * limit

  const query: any = {}
  const search = String(q.q || '').trim()
  if (search) {
    const r = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    query.$or = [{ email: r }, { name: r }, { id: r }]
  }
  if (q.provider) query.provider = q.provider
  if (q.status === 'banned') query.banned = true
  if (q.status === 'subscriber') query['subscription.status'] = { $in: ['trialing', 'active'] }
  if (q.status === 'granted') query.grantedUntil = { $gt: new Date() }
  if (q.status === 'active') query.lastActiveAt = { $gte: new Date(Date.now() - 5 * 60 * 1000) }
  if (q.country) query.signupCountry = String(q.country).toUpperCase()

  const db = await connectDB()
  const users = db.collection(COL.users)

  const [total, items] = await Promise.all([
    users.countDocuments(query),
    users
      .find(query, {
        projection: {
          _id: 0,
          id: 1,
          provider: 1,
          email: 1,
          name: 1,
          createdAt: 1,
          lastActiveAt: 1,
          balance: 1,
          banned: 1,
          bannedAt: 1,
          bannedReason: 1,
          grantedUntil: 1,
          subscription: 1,
          signupCountry: 1,
          signupIp: 1,
          isAdmin: 1,
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
  ])

  return {
    items,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  }
})
