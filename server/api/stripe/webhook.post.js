import crypto from 'node:crypto'
import { connectDB } from '~~/server/db/mongo'
import { getChargeBalanceTransaction, mapSubscription } from '~~/server/features/payment/stripe'
import { createIncomeEntry } from '~~/server/features/accounting/abby'
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
        } else if (type === 'invoice.payment_succeeded') {
            await handleInvoicePaid(db, object)
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
 * Pushes every Stripe collection into the Abby income book (livre des
 * recettes → préremplit les déclarations URSSAF). Stripe stays the only
 * invoicing system (PDF invoices carry the 293 B footer); Abby only
 * receives receipts, so there is no double invoice numbering.
 *
 * Dedup: Abby has no GET /incomeBook, so sends are tracked in
 * accounting_entries (unique index on stripeInvoiceId). The insert-first
 * pattern makes concurrent webhook retries safe — the loser hits the
 * duplicate key and bows out. Refunds are NOT handled here: they are rare
 * enough to stay a manual Abby correction (documented in
 * docs/stripe-go-live.md).
 */
async function handleInvoicePaid(db, invoice) {
    const stripeInvoiceId = invoice?.id
    const amountPaid = invoice?.amount_paid
    // Zero-amount invoices are trial starts — nothing was collected.
    if (!stripeInvoiceId || !amountPaid) return

    let claimed = false
    try {
        await db.collection('accounting_entries').insertOne({
            stripeInvoiceId,
            status: 'processing',
            createdAt: new Date(),
        })
        claimed = true
    } catch (err) {
        // Duplicate key: already sent or in flight. To replay a 'failed'
        // entry, delete its document and let the next webhook retry in.
        if (err?.code !== 11000) throw err
    }
    if (!claimed) return

    const finish = (fields) =>
        db
            .collection('accounting_entries')
            .updateOne({ stripeInvoiceId }, { $set: { ...fields, updatedAt: new Date() } })

    try {
        // EUR settles 1:1. For other currencies, record the amount actually
        // settled in EUR (balance transaction of the charge — a French
        // account settles in EUR).
        let amountCents = amountPaid
        if (invoice.currency !== 'eur') {
            // invoice.charge exists on pre-"Basil" API versions; on newer
            // defaults it may be absent — the entry then stays 'failed' and
            // visible instead of recording a wrong amount.
            const chargeId = invoice.charge
            const charge = chargeId ? await getChargeBalanceTransaction(chargeId) : null
            const settled = charge?.balance_transaction?.amount
            if (!settled) {
                await finish({ status: 'failed', error: `no settled EUR amount (currency=${invoice.currency})` })
                logger.warn(`[${tag}] Abby sync: no EUR settlement`, { stripeInvoiceId, currency: invoice.currency })
                return
            }
            amountCents = settled
        }

        const abbyIncomeId = await createIncomeEntry({
            client: invoice.customer_name || invoice.customer_email || 'Client Stripe',
            amountCents,
            paidAt: invoice.status_transitions?.paid_at
                ? new Date(invoice.status_transitions.paid_at * 1000)
                : new Date(),
            // The Stripe invoice number (e.g. "AB12-0042") is the reference
            // an accountant will look for.
            reference: invoice.number || stripeInvoiceId,
        })

        if (abbyIncomeId) {
            await finish({ status: 'sent', abbyIncomeId, amountCents, currency: 'eur' })
            logger.info(`[${tag}] Income entry sent to Abby`, { stripeInvoiceId, amountCents })
        } else {
            // No API key configured: integration disabled — record as
            // skipped so a later backfill can find the gap.
            await finish({ status: 'skipped_no_key', amountCents })
        }
    } catch (err) {
        await finish({ status: 'failed', error: String(err?.message || err) })
        logger.warn(`[${tag}] Abby income book push failed`, { stripeInvoiceId, err })
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
