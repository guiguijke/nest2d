import { connectDB } from '~~/server/db/mongo'
import { getSubscriptionTier } from '~~/server/utils/entitlement'
import {
    cancelSubscriptionAtPeriodEnd,
    changeSubscriptionPrice,
    mapSubscription,
} from '~~/server/features/payment/stripe'

/**
 * In-place plan change for EXISTING subscribers, offered as an alternative to
 * account deletion (and reusable from the subscription card later):
 *
 *  - targetTier 'free'    → cancel at period end (access kept until
 *                           currentPeriodEnd, then the account falls back to
 *                           the free monthly quota). Same Stripe call as the
 *                           self-serve cancel endpoint.
 *  - targetTier 'privacy' → upgrade standard → Privacy+ by UPDATING the
 *                           subscription price in place with proration (the
 *                           difference is charged immediately on the card on
 *                           file; an active trial keeps running). Never a new
 *                           Checkout — that would stack a second subscription.
 *
 * Free accounts have no subscription to update: their upgrade path stays the
 * Checkout flow (/api/payment/subscribe). Downgrades privacy → standard are
 * deliberately not supported (only "free or higher" is offered).
 *
 * Error statusMessages are stable codes so the client translates them.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody(event)
    const targetTier = body?.targetTier
    if (!['free', 'privacy'].includes(targetTier)) {
        throw createError({ statusCode: 400, statusMessage: 'invalid_target_tier' })
    }

    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { subscription: 1 } }
    )

    const subscriptionId = user?.subscription?.stripeSubscriptionId
    const currentTier = await getSubscriptionTier(user) // null when not active
    if (!subscriptionId || !currentTier) {
        throw createError({ statusCode: 400, statusMessage: 'no_active_subscription' })
    }
    if (currentTier === targetTier) {
        throw createError({ statusCode: 400, statusMessage: 'already_on_tier' })
    }

    let updated
    if (targetTier === 'free') {
        updated = await cancelSubscriptionAtPeriodEnd(subscriptionId)
    } else {
        // standard → privacy upgrade (privacy → standard would be a downgrade).
        if (currentTier === 'privacy') {
            throw createError({ statusCode: 400, statusMessage: 'downgrade_not_supported' })
        }
        const privacyPlan = await db
            .collection('subscription_plan')
            .findOne({ id: 'subscription:privacy' })
        if (!privacyPlan?.priceId) {
            throw createError({ statusCode: 503, statusMessage: 'plan_unavailable' })
        }
        updated = await changeSubscriptionPrice(subscriptionId, privacyPlan.priceId)
    }

    const mapped = mapSubscription(updated)
    await db
        .collection('users')
        .updateOne({ id: userId }, { $set: { subscription: mapped } })

    return {
        ok: true,
        targetTier,
        status: mapped.status,
        cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        currentPeriodEnd: mapped.currentPeriodEnd,
    }
})
