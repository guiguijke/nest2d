import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Payments overview: recent transactions + subscriber summary.
//
// transactions schema (main app): { stripePriceId, credit, transactionInternalId,
// userId, checkoutId, status, attempt, createdAt, updatedAt }.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 50))

  const query: any = {}
  if (q.status) query.status = String(q.status)
  if (q.userId) query.userId = String(q.userId)

  const db = await connectDB()

  const [transactions, total, subscriberSummary, statusBreakdown] = await Promise.all([
    db
      .collection(COL.transactions)
      .find(query, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    db.collection(COL.transactions).countDocuments(query),
    db
      .collection(COL.users)
      .aggregate([
        { $match: { 'subscription.status': { $in: ['trialing', 'active', 'past_due', 'canceled'] } } },
        { $group: { _id: '$subscription.status', count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection(COL.transactions)
      .aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
  ])

  // Enrich transactions with the user's name/email for display.
  const userIds = [...new Set(transactions.map((t: any) => t.userId).filter(Boolean))]
  const users = userIds.length
    ? await db
        .collection(COL.users)
        .find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } })
        .toArray()
    : []
  const userMap = new Map(users.map((u: any) => [u.id, u]))
  const items = transactions.map((t: any) => ({ ...t, user: userMap.get(t.userId) || null }))

  return {
    items,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
    subscriberSummary: subscriberSummary.map((s: any) => ({ status: s._id, count: s.count })),
    statusBreakdown: statusBreakdown.map((s: any) => ({ status: s._id, count: s.count })),
  }
})
