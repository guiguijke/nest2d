import { connectDB } from '~~/server/db/mongo'
import { getCurrencyByCountry } from '~~/server/utils/currency'
import { getEntitlement } from '~~/server/utils/entitlement'
import { TRIAL_DAYS } from '~~/server/features/payment/const'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const db = await connectDB()
    const plan = await db.collection('subscription_plan').findOne({ id: 'subscription' })
    const privacyPlan = await db.collection('subscription_plan').findOne({ id: 'subscription:privacy' })

    const country = getHeader(event, 'cf-ipcountry')
    const currency = getCurrencyByCountry(country)

    const entitlement = await getEntitlement(userId)

    const mapPlan = (doc) => {
        if (!doc) return null
        // Fall back to whatever currency the price offers (not hard-coded usd)
        // so EUR-only prices display correctly without a cf-ipcountry header.
        const available = Object.keys(doc.prices || {})
        const finalCurrency = doc.prices?.[currency] != null
            ? currency
            : available[0] || 'usd'
        const amount = doc.prices?.[finalCurrency] ?? 0
        return {
            priceId: doc.priceId,
            title: doc.title,
            description: doc.description,
            interval: doc.interval,
            amount: amount / 100,
            currency: finalCurrency,
            trialDays: TRIAL_DAYS,
        }
    }

    // Is the current subscription the privacy tier? (priceId match)
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { subscription: 1 } }
    )
    const isPrivacyTier = Boolean(
        privacyPlan?.priceId && user?.subscription?.priceId === privacyPlan.priceId
    )

    return {
        plan: mapPlan(plan),
        privacyPlan: mapPlan(privacyPlan),
        isPrivacyTier,
        ...entitlement,
    }
})
