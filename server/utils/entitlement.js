import { createError } from 'h3'
import { connectDB } from '~~/server/db/mongo'
import { FREE_NESTING_LIMIT } from '~~/server/features/payment/const'
import { ACTIVE_SUBSCRIPTION_STATUSES, getSubscription, mapSubscription } from '~~/server/features/payment/stripe'
import logger from './logger'

/**
 * Free quota is a MONTHLY allowance: 10 free nestings per calendar month
 * (UTC), reset lazily on the next consumption of a new month. The period is
 * tracked as 'YYYY-MM' on the user document (freeNestingPeriod).
 */
function currentFreePeriod() {
    return new Date().toISOString().slice(0, 7)
}

/**
 * Resets the free counter when the month rolled over. Safe to call before
 * reading freeNestingUsed; atomic, so concurrent calls can't double-reset.
 */
async function resetFreeQuotaIfNewPeriod(db, userId) {
    await db
        .collection('users')
        .updateOne(
            { id: userId, freeNestingPeriod: { $ne: currentFreePeriod() } },
            { $set: { freeNestingUsed: 0, freeNestingPeriod: currentFreePeriod() } },
        )
}

/**
 * Returns true if the user's stored subscription currently grants access.
 * @param {any} user
 * @returns {boolean}
 */
function hasActiveSubscription(user) {
    const subscription = user?.subscription
    if (!subscription) {
        return false
    }
    if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
        return false
    }
    // No period end recorded yet (e.g. just created) — trust the status.
    if (!subscription.currentPeriodEnd) {
        return true
    }
    return new Date(subscription.currentPeriodEnd) > new Date()
}

/**
 * Re-reads the subscription from Stripe and persists it. Used as a lazy
 * fallback when the locally stored period looks expired, so the polling lag
 * doesn't wrongly block a freshly-renewed subscriber.
 * @param {import('mongodb').Db} db
 * @param {any} user
 * @returns {Promise<boolean>} whether the refreshed subscription is active
 */
async function refreshSubscription(db, user) {
    const subscriptionId = user?.subscription?.stripeSubscriptionId
    if (!subscriptionId) {
        return false
    }
    try {
        const stripeSub = await getSubscription(subscriptionId)
        const mapped = mapSubscription(stripeSub)
        await db.collection('users').updateOne({ id: user.id }, { $set: { subscription: mapped } })
        return hasActiveSubscription({ subscription: mapped })
    } catch (err) {
        logger.warn('Failed to refresh subscription from Stripe', {
            userId: user.id,
            subscriptionId,
            err,
        })
        return false
    }
}

/**
 * Read-only entitlement summary for UI (banner, paywall state).
 * @param {string} userId
 * @returns {Promise<{freeRemaining: number, subscriptionStatus: string|null, requiresPaywall: boolean}>}
 */
export async function getEntitlement(userId) {
    const db = await connectDB()
    await resetFreeQuotaIfNewPeriod(db, userId)
    const user = await db
        .collection('users')
        .findOne({ id: userId }, { projection: { freeNestingUsed: 1, subscription: 1, grantedUntil: 1 } })

    const subscriptionStatus = user?.subscription?.status || null
    const active = hasActiveSubscription(user)
    // An admin-granted free period (set from the admin panel) grants full access
    // until its expiry, exactly like an active subscription would.
    const granted = user?.grantedUntil && new Date(user.grantedUntil) > new Date()
    const freeRemaining = Math.max(0, FREE_NESTING_LIMIT - (user?.freeNestingUsed || 0))

    return {
        freeRemaining,
        subscriptionStatus,
        // An active grant (admin "mois gratuit") bypasses the paywall.
        requiresPaywall: !granted && !active && freeRemaining === 0,
    }
}

/**
 * Maps the user's subscription priceId to a plan tier using the synced
 * subscription_plan documents (see 6_subscription_plan_sync.ts). Returns
 * 'standard' when the price is unknown but the subscription is active — an
 * unknown price must never silently grant premium features.
 * @param {any} user
 * @returns {Promise<string|null>} 'standard' | 'privacy' | null
 */
export async function getSubscriptionTier(user) {
    if (!hasActiveSubscription(user)) {
        return null
    }
    const db = await connectDB()
    const plan = await db
        .collection('subscription_plan')
        .findOne({ priceId: user.subscription.priceId }, { projection: { tier: 1 } })
    return plan?.tier || 'standard'
}

/**
 * Whether the user may enable the zero-knowledge vault ("Confidentialité+"
 * tier).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function hasPrivacyTier(userId) {
    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId }, { projection: { subscription: 1 } })
    return (await getSubscriptionTier(user)) === 'privacy'
}

/**
 * Compute profiles by plan tier. EVERY tier gets a fully optimized result
 * (the engine computes until convergence, see plateau stop in nest-engine);
 * the plan only caps the compute THROUGHPUT (vcores = parallel SA walks /
 * threads) and therefore the delivery time, plus the number of layout
 * directions explorable per nesting (free: 1 — the other directions cost
 * one nesting credit each; paid: all 3, unselectable for a faster result).
 *
 * wallCapSec is a worst-case wall-clock cap (plateau stop usually ends the
 * job much earlier). priority: lower = dequeued first.
 *
 * Computed SERVER-SIDE at enqueue time and persisted on the job — the
 * client can never inflate its own budget.
 *
 * TODO(calibration): vcores/wallCapSec are initial estimates — tune with
 * the perf_curve harness on the production machine (EPYC 7002, 16T budget).
 */
export const COMPUTE_TIERS = {
    free: { vcores: 1, wallCapSec: 600, maxDirections: 1, priority: 30 },
    standard: { vcores: 4, wallCapSec: 300, maxDirections: 3, priority: 20 },
    privacy: { vcores: 8, wallCapSec: 180, maxDirections: 3, priority: 10 },
}

/** Layout directions the engine can optimize towards (BPP alternatives). */
export const NEST_DIRECTIONS = ['left', 'bottom', 'balanced']

/**
 * The user's compute tier: 'privacy' (Confidentialité+) > 'standard'
 * (subscription or admin grant) > 'free'.
 * @param {string} userId
 * @param {{type: string}|null} charge the charge returned by assertCanNest (null on UI paths)
 * @returns {Promise<'free'|'standard'|'privacy'>}
 */
export async function getComputeTier(userId, charge) {
    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId }, { projection: { subscription: 1, grantedUntil: 1 } })

    const tier = await getSubscriptionTier(user)
    if (tier === 'privacy') return 'privacy'
    // Subscribers AND admin-granted users (free month from the admin panel)
    // get the paid tier — checked from the subscription (UI path, charge is
    // null), the grant, and the job's charge (enqueue path).
    const granted = user?.grantedUntil && new Date(user.grantedUntil) > new Date()
    if (tier === 'standard' || granted || charge?.type === 'subscription' || charge?.type === 'grant') {
        return 'standard'
    }
    return 'free'
}

/**
 * Compute profile granted to a nesting job, by tier.
 *
 * @param {string} userId
 * @param {{type: string}|null} charge the charge returned by assertCanNest
 * @returns {Promise<{vcores: number, wallCapSec: number, maxDirections: number, priority: number, level: string}>}
 */
export async function getComputeProfile(userId, charge) {
    const tier = await getComputeTier(userId, charge)
    return { ...COMPUTE_TIERS[tier], level: tier }
}

/**
 * Validates a client-requested direction list against the tier's allowance.
 * Returns the sanitized list (deduped, canonical order). Throws 400/403 on
 * invalid input — the client may request FEWER directions (faster result)
 * but never more than maxDirections.
 *
 * @param {any} requested params.directions from the client (may be absent)
 * @param {number} maxDirections tier allowance
 * @returns {string[]}
 */
export function validateDirections(requested, maxDirections) {
    let list = Array.isArray(requested)
        ? requested.filter((d) => NEST_DIRECTIONS.includes(d))
        : []
    list = [...new Set(list)]
    if (list.length === 0) {
        // Default: everything the tier allows, in canonical order.
        list = NEST_DIRECTIONS.slice(0, Math.max(1, maxDirections))
    }
    if (list.length > maxDirections) {
        throw createError({
            statusCode: 403,
            statusMessage: `Your plan allows ${maxDirections} layout direction(s) per nesting`,
        })
    }
    return NEST_DIRECTIONS.filter((d) => list.includes(d))
}

/**
 * Gate for nesting requests.
 *
 * Charge order: admin grant → active subscription → free monthly quota.
 * The consumed unit is recorded and returned so the caller can persist it on
 * the job — the workers refund it if the nesting fails.
 *
 * Throws a 402 with a paywall reason when nothing is available.
 *
 * @param {string} userId
 * @returns {Promise<{type: 'grant'|'subscription'|'free'}>}
 */
export async function assertCanNest(userId) {
    const db = await connectDB()
    const user = await db
        .collection('users')
        .findOne({ id: userId }, { projection: { id: 1, freeNestingUsed: 1, subscription: 1, grantedUntil: 1 } })

    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // An admin-granted free period ("mois gratuit", set from the admin panel)
    // grants full access until its expiry, consuming no quota.
    if (user.grantedUntil && new Date(user.grantedUntil) > new Date()) {
        return { type: 'grant' }
    }

    if (hasActiveSubscription(user)) {
        return { type: 'subscription' }
    }

    // Period looks expired but we have a subscription on file — the poll may not
    // have caught a renewal yet, so verify against Stripe before denying.
    if (user.subscription?.stripeSubscriptionId && (await refreshSubscription(db, user))) {
        return { type: 'subscription' }
    }

    // Atomically consume a free nesting operation. The guard prevents two
    // concurrent requests from both spending the same remaining free slot.
    await resetFreeQuotaIfNewPeriod(db, userId)
    const consumed = await db
        .collection('users')
        .findOneAndUpdate(
            { id: userId, freeNestingUsed: { $lt: FREE_NESTING_LIMIT } },
            { $inc: { freeNestingUsed: 1 } },
        )

    if (consumed) {
        return { type: 'free' }
    }

    throw createError({
        statusCode: 402,
        statusMessage: 'Subscription required',
        data: { reason: 'paywall' },
    })
}
