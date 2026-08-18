/**
 * Paid access for UI (banner, paywall, profile).
 * Stripe active/trialing OR admin grant (compute.level standard/privacy,
 * or the `granted` flag from /api/user). Never use freeRemaining alone —
 * a granted Unlimited user can sit at 10/10 free used.
 */
export function hasPaidAccess(user) {
    if (!user) return false
    if (user.granted === true) return true
    const status = user.subscriptionStatus
    if (status === 'active' || status === 'trialing') return true
    const level = user.compute?.level
    return level === 'standard' || level === 'privacy'
}
