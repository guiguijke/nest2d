import { connectDB } from '~~/server/db/mongo'
import { getCurrencyByCountry } from '~~/server/utils/currency'
import { TRIAL_DAYS } from '~~/server/features/payment/const'

/**
 * Public catalog of subscription plans (standard + privacy), as synced from
 * Stripe by 6_subscription_plan_sync.ts. Lets the landing and the profile
 * page activate the Pro tier automatically once the product exists in
 * Stripe — no code change needed.
 */
export default defineEventHandler(async (event) => {
    const db = await connectDB()
    const docs = await db.collection('subscription_plan').find({}).toArray()

    const country = getHeader(event, 'cf-ipcountry')
    const currency = getCurrencyByCountry(country)

    const mapPlan = (doc) => {
        if (!doc) return { available: false }
        // Fall back to whatever currency the price offers (not hard-coded
        // usd) so EUR-only prices display correctly without cf-ipcountry.
        const available = Object.keys(doc.prices || {})
        const finalCurrency = doc.prices?.[currency] != null
            ? currency
            : available[0] || 'usd'
        return {
            available: true,
            title: doc.title,
            description: doc.description,
            interval: doc.interval,
            amount: (doc.prices?.[finalCurrency] ?? 0) / 100,
            currency: finalCurrency,
            trialDays: TRIAL_DAYS,
        }
    }

    return {
        standard: mapPlan(docs.find((doc) => doc.tier !== 'privacy')),
        privacy: mapPlan(docs.find((doc) => doc.tier === 'privacy')),
    }
})
