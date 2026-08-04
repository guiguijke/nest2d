import { createError } from 'h3'

/**
 * Partner promo codes ("JD20" → 20 free nestings/month instead of 10).
 *
 * Model: one code = a raised free monthly quota, snapshot on the user at
 * redeem time (users.promo = { code, freeNestingLimit, redeemedAt }). Later
 * edits/deactivation/expiration of the code never affect existing
 * beneficiaries — expiration and maxRedemptions only gate NEW redeems
 * (partnership promise). One code per user (v1).
 *
 * Stripe is NOT involved: this is not a discount, just a bigger free quota.
 */

export const PROMO_CODE_REGEX = /^[A-Z0-9]{3,20}$/

/**
 * @param {any} raw
 * @returns {string} trimmed, uppercased code ('' when empty)
 */
export function normalizePromoCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
}

/**
 * Redeems a promo code for a user. Throws createError with a stable
 * statusMessage code (translated client-side):
 *  - 400 promo_invalid  empty / bad format
 *  - 404 promo_invalid  unknown code
 *  - 410 promo_expired  inactive or expired code
 *  - 409 promo_maxed    maxRedemptions reached
 *  - 409 promo_already  the user already redeemed a (different) code
 *
 * No transaction (Mongo standalone): the guarded $inc on promoCodes is the
 * atomic gate for new redeems; the users $set is guarded by
 * `promo: { $exists: false }` with a compensating decrement on race. The
 * documented residual race is two concurrent redeems of the LAST allowed
 * redemption both passing the guard → redemptionCount may exceed
 * maxRedemptions by at most 1 (accepted, see specs/90-decisions.md).
 *
 * @param {import('mongodb').Db} db
 * @param {any} user user document carrying at least { id, promo }
 * @param {any} rawCode
 * @returns {Promise<{code: string, freeNestingLimit: number}>}
 */
export async function redeemPromoCode(db, user, rawCode) {
    const code = normalizePromoCode(rawCode)
    if (!code || !PROMO_CODE_REGEX.test(code)) {
        throw createError({ statusCode: 400, statusMessage: 'promo_invalid' })
    }
    if (user?.promo) {
        throw createError({ statusCode: 409, statusMessage: 'promo_already' })
    }

    const promoCodes = db.collection('promoCodes')
    const now = new Date()

    const doc = await promoCodes.findOne({ code })
    if (!doc) {
        throw createError({ statusCode: 404, statusMessage: 'promo_invalid' })
    }
    if (doc.active !== true || (doc.expiresAt && new Date(doc.expiresAt) <= now)) {
        throw createError({ statusCode: 410, statusMessage: 'promo_expired' })
    }
    if (doc.maxRedemptions != null && (doc.redemptionCount || 0) >= doc.maxRedemptions) {
        throw createError({ statusCode: 409, statusMessage: 'promo_maxed' })
    }

    // Atomic gate: re-asserts every condition (an admin may have deactivated
    // the code, or the last slot may have been taken, since the read above).
    const claimed = await promoCodes.updateOne(
        {
            code,
            active: true,
            $and: [
                { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
                {
                    $or: [
                        { maxRedemptions: null },
                        { $expr: { $lt: ['$redemptionCount', '$maxRedemptions'] } },
                    ],
                },
            ],
        },
        { $inc: { redemptionCount: 1 } },
    )
    if (claimed.modifiedCount === 0) {
        // Lost a race — re-read to classify why for a precise error.
        const current = await promoCodes.findOne({ code })
        if (!current) {
            throw createError({ statusCode: 404, statusMessage: 'promo_invalid' })
        }
        if (current.active !== true || (current.expiresAt && new Date(current.expiresAt) <= now)) {
            throw createError({ statusCode: 410, statusMessage: 'promo_expired' })
        }
        throw createError({ statusCode: 409, statusMessage: 'promo_maxed' })
    }

    // Snapshot the limit on the user. The $exists guard turns a concurrent
    // double-redeem (same user, two tabs) into a clean refusal instead of a
    // silent overwrite.
    const assigned = await db
        .collection('users')
        .updateOne(
            { id: user.id, promo: { $exists: false } },
            {
                $set: {
                    promo: {
                        code,
                        freeNestingLimit: doc.freeNestingLimit,
                        redeemedAt: now,
                    },
                },
            },
        )
    if (assigned.modifiedCount === 0) {
        await promoCodes.updateOne({ code }, { $inc: { redemptionCount: -1 } })
        throw createError({ statusCode: 409, statusMessage: 'promo_already' })
    }

    return { code, freeNestingLimit: doc.freeNestingLimit }
}
