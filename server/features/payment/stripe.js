const STRIPE_BASE = 'https://api.stripe.com/v1'

function authHeaders(contentType) {
    const stripeSecretKey = useRuntimeConfig().stripeSecretKey
    const headers = {
        'Authorization': `Bearer ${stripeSecretKey}`,
    }
    if (contentType) {
        headers['Content-Type'] = contentType
    }
    return headers
}

/**
 * Creates (or returns) a Stripe customer for the given user.
 * @param {{email: string, userId: string}} user
 * @returns {Promise<string>} the Stripe customer id
 */
export async function createCustomer({ email, userId }) {
    const params = new URLSearchParams()
    if (email) {
        params.append('email', email)
    }
    params.append('metadata[userId]', userId)

    const response = await $fetch(`${STRIPE_BASE}/customers`, {
        method: 'POST',
        headers: authHeaders('application/x-www-form-urlencoded'),
        body: params,
    })
    return response.id
}

/**
 * Creates a Stripe Checkout session in subscription mode with a free trial.
 * @param {{
 *   customerId: string,
 *   priceId: string,
 *   currency: string,
 *   trialDays: number,
 *   userId: string,
 *   internalId: string,
 *   successUrl: string,
 *   cancelUrl: string,
 * }} options
 * @returns {Promise<{id: string, url: string}>}
 */
export async function createSubscriptionCheckout({
    customerId,
    priceId,
    currency,
    trialDays,
    userId,
    internalId,
    successUrl,
    cancelUrl,
}) {
    const params = new URLSearchParams()
    params.append('mode', 'subscription')
    params.append('customer', customerId)
    params.append('success_url', successUrl)
    params.append('cancel_url', cancelUrl)
    params.append('line_items[0][price]', priceId)
    params.append('line_items[0][quantity]', '1')
    if (currency) {
        params.append('currency', currency)
    }
    if (trialDays > 0) {
        params.append('subscription_data[trial_period_days]', String(trialDays))
    }
    params.append('client_reference_id', userId)
    params.append('metadata[userId]', userId)
    params.append('metadata[internalId]', internalId)
    params.append('allow_promotion_codes', 'true')

    const response = await $fetch(`${STRIPE_BASE}/checkout/sessions`, {
        method: 'POST',
        headers: authHeaders('application/x-www-form-urlencoded'),
        body: params,
    })
    return { id: response.id, url: response.url }
}

/**
 * Reads a checkout session, expanding the created subscription.
 * @param {string} checkoutId
 * @returns {Promise<any>}
 */
export async function getCheckoutSession(checkoutId) {
    return await $fetch(`${STRIPE_BASE}/checkout/sessions/${checkoutId}`, {
        method: 'GET',
        headers: authHeaders('application/x-www-form-urlencoded'),
        query: {
            'expand[]': 'subscription',
        },
    })
}

/**
 * Reads the current state of a subscription from Stripe.
 * @param {string} subscriptionId
 * @returns {Promise<any>}
 */
export async function getSubscription(subscriptionId) {
    return await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
        method: 'GET',
        headers: authHeaders('application/x-www-form-urlencoded'),
    })
}

/**
 * Reads a charge with its balance transaction expanded. The balance
 * transaction carries the amount actually settled in the account currency
 * (EUR for a French account) — used to record non-EUR payments in the
 * income book at their real EUR value.
 * @param {string} chargeId
 * @returns {Promise<any>}
 */
export async function getChargeBalanceTransaction(chargeId) {
    return await $fetch(`${STRIPE_BASE}/charges/${chargeId}`, {
        method: 'GET',
        headers: authHeaders(),
        query: {
            'expand[]': 'balance_transaction',
        },
    })
}

/**
 * Maps a raw Stripe subscription object to the fields we persist on the user.
 * @param {any} subscription
 * @returns {{stripeSubscriptionId: string, status: string, currentPeriodEnd: Date, cancelAtPeriodEnd: boolean, priceId: string, updatedAt: Date}}
 */
export function mapSubscription(subscription) {
    const item = subscription?.items?.data?.[0]
    return {
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        priceId: item?.price?.id || null,
        updatedAt: new Date(),
    }
}

/**
 * Schedules a subscription to be canceled at the end of the current billing
 * period. The user keeps access until currentPeriodEnd; status stays
 * 'active'/'trialing'. This is the self-serve "unsubscribe" path — it never
 * revokes access mid-cycle.
 * @param {string} subscriptionId
 * @returns {Promise<any>} the updated Stripe subscription object
 */
export async function cancelSubscriptionAtPeriodEnd(subscriptionId) {
    const params = new URLSearchParams()
    params.append('cancel_at_period_end', 'true')
    return await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
        method: 'POST',
        headers: authHeaders('application/x-www-form-urlencoded'),
        body: params,
    })
}

/**
 * Cancels a subscription IMMEDIATELY (DELETE revokes access at once, no end
 * of period). Only used on account deletion, where keeping access until the
 * period end is meaningless — the account is gone.
 * @param {string} subscriptionId
 * @returns {Promise<any>} the canceled Stripe subscription object
 */
export async function cancelSubscriptionImmediately(subscriptionId) {
    return await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    })
}

/**
 * Deletes a Stripe customer (cancels any remaining subscription and detaches
 * payment methods). Best-effort on account deletion: without it, a late
 * webhook addressed to the orphan customer would keep hitting our API.
 * @param {string} customerId
 * @returns {Promise<any>}
 */
export async function deleteCustomer(customerId) {
    return await $fetch(`${STRIPE_BASE}/customers/${customerId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    })
}

/**
 * Switches an existing subscription to a different price IN PLACE (Stripe
 * subscription update), with proration — the upgrade difference is charged
 * immediately on the card on file, and a trialing subscription keeps its
 * trial. This is the proper upgrade path: creating a new Checkout session
 * for an existing subscriber would stack a SECOND subscription on the same
 * customer (double billing).
 * @param {string} subscriptionId
 * @param {string} newPriceId
 * @returns {Promise<any>} the updated Stripe subscription object
 */
export async function changeSubscriptionPrice(subscriptionId, newPriceId) {
    const subscription = await getSubscription(subscriptionId)
    const itemId = subscription?.items?.data?.[0]?.id
    if (!itemId) {
        throw createError({ statusCode: 502, statusMessage: 'Subscription has no item to update' })
    }
    const params = new URLSearchParams()
    params.append('items[0][id]', itemId)
    params.append('items[0][price]', newPriceId)
    params.append('proration_behavior', 'create_prorations')
    return await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
        method: 'POST',
        headers: authHeaders('application/x-www-form-urlencoded'),
        body: params,
    })
}

/**
 * Subscription statuses that grant access to nesting.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active']
