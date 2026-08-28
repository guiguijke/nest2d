import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Payments overview — corrected to show real money + subscriptions.
//
// Three data sources:
//   1. Active subscriptions (users with active subscription) — joined with
//      `subscription_plan` to recover the tier (standard/privacy) and plan price.
//   2. Financial KPIs: MRR (sum of active subscription monthly prices) and
//      active subscriber count.
//   3. Checkout funnel: every "S'abonner" click creates a subscription_checkouts
//      doc (status 'created'); success flips it to 'completed', abandonment to
//      'expired' (webhook/polling after Stripe's 24h). This section exposes
//      who TRIED to pay without converting, plus payment_failures (declined
//      charges from invoice.payment_failed).
//
// NB: the currency actually paid is NOT stored locally (Stripe only knows it).
// We use the plan default currency (eur). This is an approximation, documented
// in the UI subtitle.
const ACTIVE_SUB_STATUSES = ['trialing', 'active']
// trial is "not yet paying"; we count it for active subscribers but exclude
// it from MRR to avoid overstating revenue.
const PAYING_SUB_STATUSES = ['active']
// A checkout still 'created' younger than this is "in progress", not a lost
// sale — Stripe sessions live 24h.
const IN_PROGRESS_MS = 24 * 60 * 60 * 1000

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

    // ---- 3. Checkout funnel (tentatives de paiement) ----
    const checkouts = await db
        .collection(COL.subscriptionCheckouts)
        .find({}, { projection: { userId: 1, status: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(10000)
        .toArray()

    const now = Date.now()
    const completedUsers = new Set(checkouts.filter((c: any) => c.status === 'completed').map((c: any) => c.userId))
    const inProgress = checkouts.filter(
        (c: any) => c.status !== 'completed' && new Date(c.createdAt).getTime() > now - IN_PROGRESS_MS
    ).length
    const completedCount = checkouts.filter((c: any) => c.status === 'completed').length

    // Users who opened checkout(s) but never converted anywhere.
    const perUser = new Map<string, { userId: string; attempts: number; lastAt: Date; lastStatus: string }>()
    for (const c of checkouts) {
        if (c.status === 'completed' || completedUsers.has(c.userId)) continue
        const entry = perUser.get(c.userId) || { userId: c.userId, attempts: 0, lastAt: c.createdAt, lastStatus: c.status }
        entry.attempts++
        if (new Date(c.createdAt) > new Date(entry.lastAt)) {
            entry.lastAt = c.createdAt
            entry.lastStatus = c.status
        }
        perUser.set(c.userId, entry)
    }
    const attemptsByUser = [...perUser.values()].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
    // Resolve emails in one query (users are keyed by `id`, not _id).
    if (attemptsByUser.length) {
        const usersById = await db
            .collection(COL.users)
            .find({ id: { $in: attemptsByUser.map((a) => a.userId) } }, { projection: { id: 1, email: 1, name: 1 } })
            .toArray()
        const byId = new Map(usersById.map((u: any) => [u.id, u]))
        for (const a of attemptsByUser) {
            a.email = byId.get(a.userId)?.email || null
            a.name = byId.get(a.userId)?.name || null
        }
    }

    // ---- 4. Échecs de paiement (invoice.payment_failed) ----
    const paymentFailures = await db
        .collection(COL.paymentFailures)
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray()

    const attemptsTotal = checkouts.length
    const abandoned = attemptsTotal - completedCount - inProgress

    return {
        subscriptions,
        kpis: {
            mrrEur: Math.round(mrr * 100) / 100,
            activeSubscribers,
            trialing,
            privacyTier,
        },
        funnel: {
            attemptsTotal,
            completed: completedCount,
            inProgress,
            abandoned,
            abandonRate: attemptsTotal ? Math.round((abandoned / attemptsTotal) * 100) : 0,
        },
        attemptsByUser,
        paymentFailures,
    }
})
