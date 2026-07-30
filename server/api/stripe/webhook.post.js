import crypto from 'node:crypto'
import { connectDB } from '~~/server/db/mongo'
import { mapSubscription } from '~~/server/features/payment/stripe'
import logger from '~~/server/utils/logger'

const tag = 'stripe-webhook'

/**
 * Stripe webhook endpoint.
 *
 * Receives Stripe events (checkout completed, subscription lifecycle) and
 * updates the stored user subscription so the UI reflects the change without
 * waiting on the polling sync (plugins 4 & 7). This is the primary source of
 * truth in production; the polling loops remain as a safety net.
 *
 * No SDK: signature is verified by hand with node:crypto (the rest of the
 * codebase already talks to the Stripe REST API directly). The raw body must
 * be read here before anything else consumes the request stream — the
 * request-logging middleware explicitly skips this route for that reason.
 */
export default defineEventHandler(async (event) => {
    const webhookSecret = useRuntimeConfig(event).stripeWebhookSecret
    if (!webhookSecret) {
        // Refuse to run unauthenticated: an endpoint that accepts unsigned
        // events would let anyone grant themselves a subscription.
        throw createError({ statusCode: 503, statusMessage: 'Webhook not configured' })
    }

    const signature = getHeader(event, 'stripe-signature')
    if (!signature) {
        throw createError({ statusCode: 400, statusMessage: 'Missing signature' })
    }

    const rawBody = await readRawBody(event)
    if (!rawBody) {
        throw createError({ statusCode: 400, statusMessage: 'Empty body' })
    }

    const verified = verifyStripeSignature(rawBody, signature, webhookSecret)
    if (!verified) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid signature' })
    }

    const payload = JSON.parse(rawBody.toString('utf8'))
    const { type, data } = payload
    const object = data?.object

    logger.info(`[${tag}] Received`, { type, id: payload?.id })

    const db = await connectDB()

    try {
        if (type === 'checkout.session.completed') {
            await handleCheckoutCompleted(db, object)
        } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
            await handleSubscriptionChange(db, object)
        } else if (type === 'customer.subscription.deleted') {
            await handleSubscriptionDeleted(db, object)
        } else {
            // Unhandled event types are expected — acknowledge so Stripe
            // doesn't retry them.
            logger.info(`[${tag}] Unhandled event type`, { type })
        }
    } catch (err) {
        // Log but still 200: if we throw, Stripe retries forever and floods
        // the queue. Persistent failures are better caught by the polling sync.
        logger.warn(`[${tag}] Handler error for ${type}`, err)
    }

    return { received: true }
})

/**
 * Resolves a freshly paid checkout: marks it completed and persists the
 * subscription on the user. client_reference_id holds the NestorCut userId
 * (set in createSubscriptionCheckout).
 */
async function handleCheckoutCompleted(db, session) {
    const userId = session?.client_reference_id
    const checkoutId = session?.id

    if (checkoutId) {
        await db
            .collection('subscription_checkouts')
            .updateOne({ checkoutId }, { $set: { status: 'completed', updatedAt: new Date() } })
    }

    // The subscription object isn't expanded in the default webhook payload,
    // so when it's only an id we rely on the subsequent
    // customer.subscription.created/updated events (fired right after) to
    // persist the full subscription. Still try if it's expanded.
    const subscription = session?.subscription && typeof session.subscription === 'object' ? session.subscription : null

    if (userId && subscription) {
        const mapped = mapSubscription(subscription)
        await db.collection('users').updateOne({ id: userId }, { $set: { subscription: mapped } })
        logger.info(`[${tag}] Checkout completed`, { userId, status: mapped.status })
    }
}

/**
 * Persists the current state of a subscription on the owning user, found via
 * the Stripe customer id (stored on user.stripeCustomerId at checkout time).
 */
async function handleSubscriptionChange(db, subscription) {
    const customerId = subscription?.customer
    if (!customerId) return

    const mapped = mapSubscription(subscription)
    await db.collection('users').updateOne({ stripeCustomerId: customerId }, { $set: { subscription: mapped } })
    logger.info(`[${tag}] Subscription updated`, {
        customerId,
        status: mapped.status,
    })
}

/**
 * Final cancellation: Stripe fires this at the end of the billing period.
 * The subscription object already carries status 'canceled', so reusing
 * mapSubscription flips the stored state correctly.
 */
async function handleSubscriptionDeleted(db, subscription) {
    const customerId = subscription?.customer
    if (!customerId) return

    const mapped = mapSubscription(subscription)
    await db.collection('users').updateOne({ stripeCustomerId: customerId }, { $set: { subscription: mapped } })
    logger.info(`[${tag}] Subscription deleted`, { customerId })
}

/**
 * Verifies the Stripe-Signature header against the raw request body.
 *
 * Stripe signs with: HMAC-SHA256(secret, "${timestamp}.${rawBody}") and sends
 * the header as "t=<timestamp>,v1=<hex1>,v1=<hex2>". We reconstruct the
 * signed payload and compare in constant time to avoid timing attacks.
 *
 * Also rejects signatures older than 5 minutes to prevent replay attacks.
 */
function verifyStripeSignature(rawBody, signatureHeader, secret) {
    const parts = Object.fromEntries(
        signatureHeader.split(',').map((p) => {
            const [k, v] = p.split('=')
            return [k, v]
        }),
    )
    const timestamp = parts.t
    const signatures = signatureHeader
        .split(',')
        .filter((p) => p.startsWith('v1='))
        .map((p) => p.slice(3))

    if (!timestamp || signatures.length === 0) {
        return false
    }

    // Replay protection: ignore signatures older than 5 minutes.
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(timestamp)
    if (Number.isNaN(ageSeconds) || Math.abs(ageSeconds) > 300) {
        return false
    }

    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`
    const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')

    const expectedBuf = Buffer.from(expected, 'hex')
    return signatures.some((sig) => {
        const sigBuf = Buffer.from(sig, 'hex')
        if (sigBuf.length !== expectedBuf.length) return false
        return crypto.timingSafeEqual(sigBuf, expectedBuf)
    })
}
