import { createError } from 'h3'

/**
 * Partner promo codes ("JD20" → 20 free nestings/month instead of 10).
 *
 * Model: one code = a raised free monthly quota for the duration of a
 * campaign. The campaign end date (promoCodes.expiresAt) is snapshot on the
 * user at redeem time (users.promo.expiresAt) and the admin can RENEW the
 * campaign: setting a new expiresAt on the code propagates to every
 * beneficiary (admin PATCH route). A code without expiresAt is unlimited.
 * When a user's promo expires, their quota falls back to the default and
 * they may redeem another code (one ACTIVE code per account).
 *
 * Stripe is NOT involved: this is not a discount, just a bigger free quota.
 */

export const PROMO_CODE_REGEX = /^[A-Z0-9]{3,20}$/

/**
 * Whether a users.promo snapshot currently grants the raised quota.
 * @param {any} promo users.promo subdocument (may be null/undefined)
 * @returns {boolean}
 */
export function isPromoActive(promo) {
    if (!promo) return false
    if (!Number.isInteger(promo.freeNestingLimit) || promo.freeNestingLimit <= 0) return false
    return !promo.expiresAt || new Date(promo.expiresAt) > new Date()
}

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
 *  - 409 promo_already  the user already has an ACTIVE promo (an expired one
 *                       can be replaced by a new code)
 *
 * No transaction (Mongo standalone): the guarded $inc on promoCodes is the
 * atomic gate for new redeems; the users $set is guarded by "no promo OR
 * expired promo" with a compensating decrement on race. The documented
 * residual race is two concurrent redeems of the LAST allowed redemption
 * both passing the guard → redemptionCount may exceed maxRedemptions by at
 * most 1 (accepted, see specs/90-decisions.md).
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
    if (isPromoActive(user?.promo)) {
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

    // Snapshot the limit AND the campaign end date on the user (the admin
    // can extend it later for every beneficiary at once). The guard turns a
    // concurrent double-redeem — or a re-redeem while the previous promo is
    // still active — into a clean refusal instead of a silent overwrite.
    const assigned = await db.collection('users').updateOne(
        {
            id: user.id,
            $or: [{ promo: { $exists: false } }, { 'promo.expiresAt': { $lte: now } }],
        },
        {
            $set: {
                promo: {
                    code,
                    freeNestingLimit: doc.freeNestingLimit,
                    redeemedAt: now,
                    expiresAt: doc.expiresAt ?? null,
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
