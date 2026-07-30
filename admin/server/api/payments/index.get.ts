import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Payments overview — corrected to show real money + subscriptions.
//
// Three data sources:
//   1. Credit purchases (transactions completed) — joined with `products` to
//      recover the amount in EUR (product.prices.eur, in CENTIMES).
//   2. Active subscriptions (users with active subscription) — joined with
//      `subscription_plan` to recover the tier (standard/privacy) and plan price.
//   3. Financial KPIs: MRR (sum of active subscription monthly prices), total
//      credit revenue, active subscriber count.
//
// NB: the currency actually paid is NOT stored locally (Stripe only knows it).
// We use the plan/product default currency (eur). This is an approximation,
// documented in the UI subtitle.
const ACTIVE_SUB_STATUSES = ['trialing', 'active']
// trial is "not yet paying"; we count it for active subscribers but exclude
// it from MRR to avoid overstating revenue.
const PAYING_SUB_STATUSES = ['active']

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 50))
  const db = await connectDB()

  // ---- 1. Credit transactions + EUR amount (join products) ----
  const txQuery: any = { status: 'completed' }
  if (q.userId) txQuery.userId = String(q.userId)

  const creditTx = await db
    .collection(COL.transactions)
    .aggregate([
      { $match: txQuery },
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $lookup: {
          from: 'products',
          localField: 'stripePriceId',
          foreignField: 'stripePriceId',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          amountEur: {
            $cond: {
              if: { $ifNull: ['$product.prices.eur', false] },
              then: { $divide: ['$product.prices.eur', 100] },
              else: null,
            },
          },
        },
      },
    ])
    .toArray()

  const totalCompletedTx = await db.collection(COL.transactions).countDocuments(txQuery)

  // Total credit revenue (sum of amountEur across ALL completed, not just page).
  const creditRevenueAgg = await db
    .collection(COL.transactions)
    .aggregate([
      { $match: { status: 'completed' } },
      {
        $lookup: { from: 'products', localField: 'stripePriceId', foreignField: 'stripePriceId', as: 'product' },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $group: { _id: null, totalEur: { $sum: { $divide: [{ $ifNull: ['$product.prices.eur', 0] }, 100] } }, totalCredits: { $sum: '$credit' } } },
    ])
    .toArray()
  const creditRevenue = creditRevenueAgg[0] || { totalEur: 0, totalCredits: 0 }

  // ---- 2. Active subscriptions (join subscription_plan) ----
  const subscriptions = await db
    .collection(COL.users)
    .aggregate([
      { $match: { 'subscription.status': { $in: ACTIVE_SUB_STATUSES } } },
      {
        $lookup: {
          from: 'subscription_plan',
          localField: 'subscription.priceId',
          foreignField: 'priceId',
          as: 'plan',
        },
      },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: '$id',
          name: 1,
          email: 1,
          status: '$subscription.status',
          priceId: '$subscription.priceId',
          currentPeriodEnd: '$subscription.currentPeriodEnd',
          cancelAtPeriodEnd: '$subscription.cancelAtPeriodEnd',
          stripeSubscriptionId: '$subscription.stripeSubscriptionId',
          tier: { $ifNull: ['$plan.tier', 'standard'] },
          planName: '$plan.name',
          planPriceEur: {
            $cond: {
              if: { $ifNull: ['$plan.prices.eur', false] },
              then: { $divide: ['$plan.prices.eur', 100] },
              else: null,
            },
          },
        },
      },
      { $sort: { currentPeriodEnd: -1 } },
    ])
    .toArray()

  // ---- 3. KPIs ----
  const activeSubscribers = subscriptions.length
  // MRR = sum of monthly prices of PAYING (active, not trialing) subscriptions.
  // Strip privacy tier is monthly; if interval differs we still sum the stored
  // price as an approximation.
  const mrr = subscriptions
    .filter((s: any) => PAYING_SUB_STATUSES.includes(s.status) && s.planPriceEur)
    .reduce((sum: number, s: any) => sum + s.planPriceEur, 0)

  const trialing = subscriptions.filter((s: any) => s.status === 'trialing').length
  const privacyTier = subscriptions.filter((s: any) => s.tier === 'privacy').length

  return {
    creditTransactions: creditTx,
    subscriptions,
    kpis: {
      mrrEur: Math.round(mrr * 100) / 100,
      creditRevenueEur: Math.round(creditRevenue.totalEur * 100) / 100,
      creditsSold: creditRevenue.totalCredits,
      activeSubscribers,
      trialing,
      privacyTier,
    },
    pagination: { page, limit, total: totalCompletedTx, pages: Math.ceil(totalCompletedTx / limit) || 1 },
  }
})
