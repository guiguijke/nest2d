/**
 * Report export gating (D-RAP-11): the nesting report CONTENT stays visible
 * on every plan [prod]; the export actions (copy to clipboard / CSV) are
 * Unlimited+.
 *
 * This gate is COMMERCIAL, not security: the report is already rendered on
 * screen and a determined free user could copy the numbers by hand. It
 * therefore lives 100% client-side (no server route to protect) — documented
 * decision (A3, J-057).
 *
 * The plan comes from the already-loaded user payload
 * (`useNuxtData('user').compute.level`, J-044) — no dedicated endpoint.
 *
 * @param {string|null|undefined} computeLevel 'free'|'standard'|'privacy'
 * @param {boolean} paidPlansDisabled NUXT_PUBLIC_PAID_PLANS_DISABLED (D-PAY-7)
 * @returns {'enabled'|'locked'|'disabled'}
 *   enabled  = paid plan → exports work normally (D-RAP-4 behavior);
 *   locked   = free → buttons visible with the lock affordance and the
 *              explicit i18n label, click opens the existing paywall dialog
 *              (frustration becomes the upgrade argument, J-054);
 *   disabled = paid plans temporarily off → silently disabled, NO paywall.
 */
export function reportExportState(computeLevel, paidPlansDisabled) {
    const paid = computeLevel === 'standard' || computeLevel === 'privacy'
    if (paid) return 'enabled'
    return paidPlansDisabled ? 'disabled' : 'locked'
}
