import { connectDB } from '~~/server/db/mongo'

/**
 * Syncs the subscription plans from Stripe into the `subscription_plan`
 * collection (one document per plan). Plans are identified as Products whose
 * default price is recurring or marked metadata.type=subscription.
 *
 * Tiers come from product metadata.tier:
 *   - missing / 'standard' → the base unlimited-nesting plan (document id
 *     'subscription' for backwards compatibility)
 *   - 'privacy' → the "Confidentialité+" plan unlocking the zero-knowledge
 *     vault (document id 'subscription:privacy')
 *
 * The tier is what entitlement.js maps a user's subscription.priceId to.
 */
export default defineNitroPlugin(async () => {
    const config = useRuntimeConfig()
    const stripeSecretKey = config.stripeSecretKey

    if (!stripeSecretKey) {
        console.warn('[subscription-plan-sync] No Stripe secret key, skipping.')
        return
    }

    console.log('Starting Stripe subscription plan sync...')

    const productResponse = await $fetch<{ data: any[] }>('https://api.stripe.com/v1/products', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${stripeSecretKey}`,
        },
        query: {
            active: 'true',
            limit: 100,
            'expand[]': 'data.default_price',
        },
    })

    const candidates = productResponse.data.filter((product: any) => {
        if (product.metadata?.type === 'subscription') {
            return true
        }
        const price = product.default_price
        return typeof price === 'object' && price?.recurring != null
    })

    if (candidates.length === 0) {
        console.warn('[subscription-plan-sync] No subscription product found in Stripe.')
        return
    }

    const db = await connectDB()
    let standardClaimed = false

    for (const product of candidates) {
        const tier = product.metadata?.tier === 'privacy' ? 'privacy' : 'standard'

        const defaultPriceId =
            typeof product.default_price === 'object'
                ? product.default_price.id
                : product.default_price

        let priceData = product.default_price
        if (defaultPriceId) {
            priceData = await $fetch(`https://api.stripe.com/v1/prices/${defaultPriceId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${stripeSecretKey}`,
                },
                query: {
                    'expand[]': 'currency_options',
                },
            })
        }

        const prices: Record<string, number> = {}
        if (priceData?.currency_options) {
            for (const [currency, option] of Object.entries(priceData.currency_options)) {
                prices[currency] = (option as any).unit_amount
            }
        }
        if (priceData?.currency && !prices[priceData.currency]) {
            prices[priceData.currency] = priceData.unit_amount
        }

        // The first standard plan keeps the legacy document id so existing
        // readers (subscribe/subscription endpoints) keep working.
        const docId = tier === 'privacy'
            ? 'subscription:privacy'
            : !standardClaimed
                ? 'subscription'
                : `subscription:${priceData?.id}`
        if (tier === 'standard') standardClaimed = true

        const plan = {
            id: docId,
            productId: product.id,
            priceId: priceData?.id,
            tier,
            title: product.name,
            description: product.description,
            interval: priceData?.recurring?.interval || 'month',
            prices,
            updatedAt: new Date(),
        }

        await db
            .collection('subscription_plan')
            .updateOne({ id: docId }, { $set: plan }, { upsert: true })

        console.log(`[subscription-plan-sync] Synced ${tier} plan`, plan.priceId)
    }
})
