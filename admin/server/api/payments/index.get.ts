import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Payments overview — corrected to show real money + subscriptions.
//
// Two data sources:
//   1. Active subscriptions (users with active subscription) — joined with
//      `subscription_plan` to recover the tier (standard/privacy) and plan price.
//   2. Financial KPIs: MRR (sum of active subscription monthly prices) and
//      active subscriber count.
//
// NB: the currency actually paid is NOT stored locally (Stripe only knows it).
// We use the plan default currency (eur). This is an approximation, documented
// in the UI subtitle.
const ACTIVE_SUB_STATUSES = ['trialing', 'active']
// trial is "not yet paying"; we count it for active subscribers but exclude
// it from MRR to avoid overstating revenue.
const PAYING_SUB_STATUSES = ['active']

export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const db = await connectDB()

    // ---- 1. Active subscriptions (join subscription_plan) ----
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

    // ---- 2. KPIs ----
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
        subscriptions,
        kpis: {
            mrrEur: Math.round(mrr * 100) / 100,
            activeSubscribers,
            trialing,
            privacyTier,
        },
    }
})
