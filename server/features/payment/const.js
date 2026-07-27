import { connectDB } from '~~/server/db/mongo'

// FREE_NESTING_LIMIT and TRIAL_DAYS live in constants/payment.constants.js
// (shared with client-side landing copy). Re-exported here so existing
// server imports keep working.
export { FREE_NESTING_LIMIT, TRIAL_DAYS } from '~~/constants/payment.constants'

/**
 * Number of credits (balance units) one nesting operation costs for
 * pay-as-you-go users. Matches the historical worker-side decrement
 * (initial balance 30 = 3 nestings).
 */
export const CREDIT_COST_PER_NESTING = 10

/**
 * The Stripe product id of the monthly subscription plan. The plan sync reads
 * this product directly, and the pay-as-you-go credit sync excludes it.
 */
export const SUBSCRIPTION_PRODUCT_ID = 'prod_UewzzIGcYV3zSu'

export async function getStripeVariants() {
    const db = await connectDB()
    const prices = await db.collection('paywallProduct').find({}).toArray()
    return prices
}
