import { connectDB } from '~~/server/db/mongo'
import {
    cancelSubscriptionAtPeriodEnd,
    mapSubscription,
} from '~~/server/features/payment/stripe'

/**
 * Schedules the user's subscription to be canceled at the end of the current
 * billing period. The user keeps access until currentPeriodEnd (status stays
 * active/trialing), then Stripe flips it to canceled. This is the self-serve
 * "unsubscribe" path — it never revokes access mid-cycle.
 *
 * State is persisted on the user document with mapSubscription, so the UI can
 * immediately reflect the pending cancellation without waiting for the 6h
 * polling sync to catch up.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { subscription: 1 } }
    )

    const subscriptionId = user?.subscription?.stripeSubscriptionId
    if (!subscriptionId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'No active subscription to cancel',
        })
    }

    // Schedule cancellation at period end. Stripe keeps status active until
    // the period ends; cancel_at_period_end becomes true immediately.
    const updated = await cancelSubscriptionAtPeriodEnd(subscriptionId)
    const mapped = mapSubscription(updated)

    await db
        .collection('users')
        .updateOne({ id: userId }, { $set: { subscription: mapped } })

    return {
        ok: true,
        status: mapped.status,
        cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        currentPeriodEnd: mapped.currentPeriodEnd,
    }
})
