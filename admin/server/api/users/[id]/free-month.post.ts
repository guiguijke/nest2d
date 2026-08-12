import { requireAdmin } from '../../../utils/auth'
import { connectDB, COL } from '../../../db/mongo'
import { grantStripeFreeMonth } from '../../../utils/stripe'

// Grant one free month to a user — hybrid strategy.
//
//  - Subscriber (has an active Stripe subscription): apply a 100%-off coupon
//    valid for one billing cycle via the Stripe API. The grant is visible in
//    the Stripe dashboard.
//  - Non-subscriber (local account / Google without subscription, or any
//    account without a payment method): set `grantedUntil = now + 30d` on the
//    user doc. The main app's entitlement layer honors this field.
//
// Body: { reason?: string }
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  const body = await readBody(event).catch(() => ({}))
  const reason = String(body?.reason || '').slice(0, 500)

  const db = await connectDB()
  const users = db.collection(COL.users)
  const user = await users.findOne({ id })
  if (!user) throw createError({ statusCode: 404, statusMessage: 'Utilisateur introuvable' })

  const subId = user.subscription?.stripeSubscriptionId
  const ACTIVE = ['trialing', 'active']
  const hasActiveSub = user.subscription?.status && ACTIVE.includes(user.subscription.status) && subId

  let result: any
  // grantedUntil is set in BOTH branches. For subscribers we still apply a
  // Stripe coupon (visible in the dashboard + zero-invoices the cycle), but we
  // also set the local field so the entitlement layer honors the free month
  // even if the user cancels their subscription right after — otherwise the
  // "free month" promise would silently vanish on cancellation.
  const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (hasActiveSub) {
    // Stripe path.
    const { couponId } = await grantStripeFreeMonth(subId)
    await users.updateOne(
      { id },
      { $set: { grantedUntil: until, grantedBy: admin.id, grantedAt: new Date(), grantedReason: reason || null, grantedTier: 'standard' } },
    )
    result = { method: 'stripe_coupon', couponId, until }
  } else {
    // Local grant path.
    await users.updateOne(
      { id },
      { $set: { grantedUntil: until, grantedBy: admin.id, grantedAt: new Date(), grantedReason: reason || null, grantedTier: 'standard' } },
    )
    result = { method: 'local_grant', until }
  }

  // Audit + (optional) notification to the user via the main app's Resend.
  db.collection('adminActions')
    .insertOne({
      targetUserId: id,
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'freeMonth',
      summary: `Mois gratuit offert (${result.method})`,
      raw: { reason, ...result },
      at: new Date(),
    })
    .catch(() => {})

  return { ok: true, ...result }
})
