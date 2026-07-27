import { connectDB } from '~~/server/db/mongo'

/**
 * Number of free nesting operations a feature-flagged user gets before the
 * subscription paywall kicks in. Shared across Bins and Strip nesting.
 */
export const FREE_NESTING_LIMIT = 3

/**
 * Length of the Stripe free trial (in days) attached to the subscription.
 */
export const TRIAL_DAYS = 7

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
