const STRIPE_BASE = 'https://api.stripe.com/v1'

function authHeaders(contentType?: string) {
  const key = useRuntimeConfig().stripeSecretKey as string
  if (!key) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe non configuré (NUXT_STRIPE_SECRET_KEY).' })
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` }
  if (contentType) headers['Content-Type'] = contentType
  return headers
}

/**
 * Grants one free month to a subscriber by extending their current subscription
 * via Stripe. Strategy: extend `trial_end` (or billing cycle) by ~30 days.
 *
 * For a subscription that is active/trialing, we add 30 days of credit by
 * extending `billing_cycle_anchor`'s `trial_end` is not appropriate mid-cycle;
 * the cleanest, least-invasive approach is to set `trial_end` to now+30d when
 * the sub is not currently trialing, otherwise to create a one-off coupon.
 *
 * To keep this predictable and visible in the Stripe dashboard, we use a
 * once-per-subscription coupon (percent_off 100, duration once) applied via a
 * subscription update with `coupon`. We create the coupon idempotently.
 */
export async function grantStripeFreeMonth(subscriptionId: string): Promise<{ couponId: string }> {
  const couponId = 'aplasma_free_month'

  // Guard against repeated application: if this subscription already has the
  // free-month coupon applied (discount still active), refuse instead of
  // stacking. Without this, an admin clicking N times would grant N free
  // cycles on the same subscription.
  const existing = await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: authHeaders('application/x-www-form-urlencoded'),
  }).catch(() => null)
  const alreadyGranted = (existing?.discount?.coupon?.id === couponId)
    || (Array.isArray(existing?.discounts) && existing.discounts.some((d: any) => d?.coupon?.id === couponId))
  if (alreadyGranted) {
    throw createError({
      statusCode: 409,
      statusMessage: "Ce mois gratuit a déjà été appliqué à cet abonnement.",
    })
  }

  // Ensure the coupon exists (idempotent — Stripe returns the existing one).
  await $fetch(`${STRIPE_BASE}/coupons`, {
    method: 'POST',
    headers: authHeaders('application/x-www-form-urlencoded'),
    body: new URLSearchParams({
      'id': couponId,
      'percent_off': '100',
      'duration': 'once',
      'name': 'NestorCut — Mois offert (admin)',
      'redeem_by': String(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60), // usable for 90 days
    }),
  }).catch(() => {
    /* 400 "resource_already_exists" is expected on repeat runs */
  })

  // Apply the coupon to the subscription.
  await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: authHeaders('application/x-www-form-urlencoded'),
    body: new URLSearchParams({ coupon: couponId }),
  })

  return { couponId }
}

/**
 * Returns a lightweight view of a subscription for the admin UI.
 */
export async function getSubscription(subscriptionId: string) {
  return await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: authHeaders('application/x-www-form-urlencoded'),
  })
}
