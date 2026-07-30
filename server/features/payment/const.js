// FREE_NESTING_LIMIT and TRIAL_DAYS live in constants/payment.constants.js
// (shared with client-side landing copy). Re-exported here so existing
// server imports keep working.
export { FREE_NESTING_LIMIT, TRIAL_DAYS } from '~~/shared/constants/payment.constants'

/**
 * The Stripe product id of the monthly subscription plan. The plan sync reads
 * this product directly.
 */
export const SUBSCRIPTION_PRODUCT_ID = 'prod_UewzzIGcYV3zSu'
