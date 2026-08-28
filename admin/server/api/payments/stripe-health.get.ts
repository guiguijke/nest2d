import { requireAdmin } from '../../utils/auth'
import { connectDB } from '../../db/mongo'

// Stripe health panel data.
//
//   1. LOCAL heartbeat: the main app's webhook upserts stripe_status
//      .last_webhook on every VERIFIED event — this is the "are webhooks
//      actually reaching us" signal (the endpoint being configured in Stripe
//      is not enough).
//   2. LIVE Stripe views: last events seen by Stripe and the account balance,
//      for cross-checking when the heartbeat looks stale.
//
// Failures against the Stripe API degrade gracefully (error string) so the
// page still renders with the local heartbeat.
export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const db = await connectDB()

    const heartbeat = await db.collection('stripe_status').findOne({ _id: 'last_webhook' })

    const key = useRuntimeConfig().stripeSecretKey as string
    let stripe: any = null
    if (key) {
        try {
            const auth = { Authorization: `Bearer ${key}` } as Record<string, string>
            const [events, balance] = await Promise.all([
                $fetch('https://api.stripe.com/v1/events', { params: { limit: 8 }, headers: auth }),
                $fetch('https://api.stripe.com/v1/balance', { headers: auth }),
            ])
            stripe = {
                lastEvent:
                    (events?.data || []).length > 0
                        ? {
                              type: events.data[0].type,
                              created: new Date(events.data[0].created * 1000),
                          }
                        : null,
                balance: [
                    ...(balance?.available || []).map((b: any) => ({ ...b, pending: false })),
                    ...(balance?.pending || []).map((b: any) => ({ ...b, pending: true })),
                ],
            }
        } catch (err: any) {
            stripe = { error: String(err?.message || err) }
        }
    }

    return {
        stripeConfigured: Boolean(key),
        lastWebhook: heartbeat
            ? { type: heartbeat.type, eventId: heartbeat.eventId, receivedAt: heartbeat.receivedAt }
            : null,
        stripe,
    }
})
