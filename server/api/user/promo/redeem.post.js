import { connectDB } from '~~/server/db/mongo'
import { assertRateLimit } from '~~/server/utils/ratelimit'
import { redeemPromoCode } from '~~/server/utils/promo'

/**
 * Redeem a partner promo code, raising the caller's free monthly nesting
 * quota (snapshot at redeem time). Errors are stable codes translated
 * client-side: promo_invalid (400/404), promo_expired (410), promo_maxed
 * (409), promo_already (409).
 *
 * Body: { code: string }
 * Response: { code, freeNestingLimit }
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // Codes are short and enumerable — throttle brute-force probing.
    assertRateLimit(event, 'promo-redeem', { limit: 10, windowMs: 600_000 })

    const db = await connectDB()
    const user = await db
        .collection('users')
        .findOne({ id: userId }, { projection: { id: 1, promo: 1 } })
    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody(event).catch(() => ({}))
    return await redeemPromoCode(db, user, body?.code)
})
