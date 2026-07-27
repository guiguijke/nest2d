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

    const country = getHeader(event, 'cf-ipcountry')
    const currency = getCurrencyByCountry(country)

    const entitlement = await getEntitlement(userId)

    let planView = null
    if (plan) {
        // Fall back to whatever currency the price offers (not hard-coded usd)
        // so EUR-only prices display correctly without a cf-ipcountry header.
        const available = Object.keys(plan.prices || {})
        const finalCurrency = plan.prices?.[currency] != null
            ? currency
            : available[0] || 'usd'
        const amount = plan.prices?.[finalCurrency] ?? 0
        planView = {
            priceId: plan.priceId,
            title: plan.title,
            description: plan.description,
            interval: plan.interval,
            amount: amount / 100,
            currency: finalCurrency,
            trialDays: TRIAL_DAYS,
        }
    }

    return {
        plan: planView,
        ...entitlement,
    }
})
