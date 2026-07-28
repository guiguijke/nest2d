import { connectDB } from '~~/server/db/mongo'
import { getCurrencyByCountry } from '~~/server/utils/currency'

export default defineEventHandler(async (event) => {
    const db = await connectDB()
    const products = await db.collection('products').find({}).toArray()

    const country = getHeader(event, 'cf-ipcountry')
    const currency = getCurrencyByCountry(country)

    const options = products
        .map(product => {
            // Fall back to whatever currency the price actually offers (eur,
            // usd, ...) instead of hard-coding usd — otherwise EUR-only prices
            // display as 0 for users without a cf-ipcountry header.
            const available = Object.keys(product.prices || {})
            const finalCurrency = product.prices?.[currency] != null
                ? currency
                : available[0] || 'usd'
            const priceAmount = product.prices?.[finalCurrency] || 0

            return {
                stripePriceId: product.stripePriceId,
                credit: product.balance,
                title: product.title,
                description: product.description,
                amount: priceAmount / 100,
                currency: finalCurrency,
            }
        })
        .sort((a, b) => a.amount - b.amount)

    return {
        options
    }
})