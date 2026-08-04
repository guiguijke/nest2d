import { describe, expect, it } from 'vitest'
import { isPromoActive, normalizePromoCode, redeemPromoCode } from '~~/server/utils/promo'
import { fakeDb } from './helpers/fakeMongo'

const JD20 = () => ({
    code: 'JD20',
    freeNestingLimit: 20,
    partner: "JD's Garage",
    active: true,
    expiresAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    createdAt: new Date(),
})

const FUTURE = () => new Date(Date.now() + 180 * 24 * 3600 * 1000)
const PAST = () => new Date(Date.now() - 24 * 3600 * 1000)

async function expectErr(promise, statusCode, statusMessage) {
    await expect(promise).rejects.toMatchObject({ statusCode, statusMessage })
}

describe('isPromoActive', () => {
    it('is false without a promo or with a corrupt limit', () => {
        expect(isPromoActive(null)).toBe(false)
        expect(isPromoActive(undefined)).toBe(false)
        expect(isPromoActive({})).toBe(false)
        expect(isPromoActive({ freeNestingLimit: 0 })).toBe(false)
        expect(isPromoActive({ freeNestingLimit: '20' })).toBe(false)
    })

    it('is true for a valid limit without end date (unlimited)', () => {
        expect(isPromoActive({ freeNestingLimit: 20 })).toBe(true)
        expect(isPromoActive({ freeNestingLimit: 20, expiresAt: null })).toBe(true)
    })

    it('follows the campaign end date', () => {
        expect(isPromoActive({ freeNestingLimit: 20, expiresAt: FUTURE() })).toBe(true)
        expect(isPromoActive({ freeNestingLimit: 20, expiresAt: PAST() })).toBe(false)
    })
})

describe('normalizePromoCode', () => {
    it('trims and uppercases', () => {
        expect(normalizePromoCode('  jd20 ')).toBe('JD20')
        expect(normalizePromoCode('JD20')).toBe('JD20')
    })

    it('maps empty input to empty string', () => {
        expect(normalizePromoCode('')).toBe('')
        expect(normalizePromoCode(null)).toBe('')
        expect(normalizePromoCode(undefined)).toBe('')
    })
})

describe('redeemPromoCode', () => {
    it('redeems a valid code: snapshot on the user, count incremented, case normalized', async () => {
        const codeDoc = JD20()
        const userDoc = { id: 'u1' }
        const db = fakeDb({ promoCodes: [codeDoc], users: [userDoc] })

        const res = await redeemPromoCode(db, { id: 'u1' }, 'jd20')

        expect(res).toEqual({ code: 'JD20', freeNestingLimit: 20 })
        expect(codeDoc.redemptionCount).toBe(1)
        expect(userDoc.promo.code).toBe('JD20')
        expect(userDoc.promo.freeNestingLimit).toBe(20)
        expect(userDoc.promo.redeemedAt).toBeInstanceOf(Date)
    })

    it('400 promo_invalid on empty or malformed code', async () => {
        const db = fakeDb({ promoCodes: [JD20()], users: [{ id: 'u1' }] })
        await expectErr(redeemPromoCode(db, { id: 'u1' }, ''), 400, 'promo_invalid')
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'JD 20!'), 400, 'promo_invalid')
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'AB'), 400, 'promo_invalid')
    })

    it('404 promo_invalid on unknown code', async () => {
        const db = fakeDb({ promoCodes: [JD20()], users: [{ id: 'u1' }] })
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'NOPE'), 404, 'promo_invalid')
    })

    it('410 promo_expired on inactive code', async () => {
        const db = fakeDb({ promoCodes: [{ ...JD20(), active: false }], users: [{ id: 'u1' }] })
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'JD20'), 410, 'promo_expired')
    })

    it('410 promo_expired on expired code', async () => {
        const past = new Date(Date.now() - 24 * 3600 * 1000)
        const db = fakeDb({ promoCodes: [{ ...JD20(), expiresAt: past }], users: [{ id: 'u1' }] })
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'JD20'), 410, 'promo_expired')
    })

    it('accepts a code expiring in the future', async () => {
        const future = new Date(Date.now() + 24 * 3600 * 1000)
        const db = fakeDb({ promoCodes: [{ ...JD20(), expiresAt: future }], users: [{ id: 'u1' }] })
        const res = await redeemPromoCode(db, { id: 'u1' }, 'JD20')
        expect(res.freeNestingLimit).toBe(20)
    })

    it('409 promo_maxed when maxRedemptions is reached', async () => {
        const maxed = { ...JD20(), maxRedemptions: 2, redemptionCount: 2 }
        const db = fakeDb({ promoCodes: [maxed], users: [{ id: 'u1' }] })
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'JD20'), 409, 'promo_maxed')
        expect(maxed.redemptionCount).toBe(2) // not incremented on refusal
    })

    it('enforces the maxRedemptions guard atomically (no increment past the cap)', async () => {
        const doc = { ...JD20(), maxRedemptions: 1 }
        const db = fakeDb({ promoCodes: [doc], users: [{ id: 'u1' }, { id: 'u2' }] })

        await redeemPromoCode(db, { id: 'u1' }, 'JD20')
        expect(doc.redemptionCount).toBe(1)

        await expectErr(redeemPromoCode(db, { id: 'u2' }, 'JD20'), 409, 'promo_maxed')
        expect(doc.redemptionCount).toBe(1)
    })

    it('409 promo_already when the user already has a promo (checked before any increment)', async () => {
        const codeDoc = JD20()
        const user = { id: 'u1', promo: { code: 'OTHER', freeNestingLimit: 15, redeemedAt: new Date() } }
        const db = fakeDb({ promoCodes: [codeDoc], users: [user] })
        await expectErr(redeemPromoCode(db, user, 'JD20'), 409, 'promo_already')
        expect(codeDoc.redemptionCount).toBe(0)
    })

    it('compensates the increment when the user-side write loses a race', async () => {
        // Stale read: the caller's user object has no promo yet, but the
        // users document already does (concurrent redeem in another tab).
        const codeDoc = JD20()
        const db = fakeDb({
            promoCodes: [codeDoc],
            users: [{ id: 'u1', promo: { code: 'OTHER', freeNestingLimit: 15, redeemedAt: new Date() } }],
        })
        await expectErr(redeemPromoCode(db, { id: 'u1' }, 'JD20'), 409, 'promo_already')
        expect(codeDoc.redemptionCount).toBe(0) // compensating decrement applied
    })

    it('snapshots the campaign end date from the code onto the user', async () => {
        const end = FUTURE()
        const codeDoc = { ...JD20(), expiresAt: end }
        const userDoc = { id: 'u1' }
        const db = fakeDb({ promoCodes: [codeDoc], users: [userDoc] })

        await redeemPromoCode(db, { id: 'u1' }, 'JD20')

        expect(userDoc.promo.expiresAt).toEqual(end)
    })

    it('replaces an expired promo (one ACTIVE code per account, re-activation allowed)', async () => {
        const codeDoc = JD20()
        const expired = { code: 'OLD5', freeNestingLimit: 15, redeemedAt: PAST(), expiresAt: PAST() }
        const userDoc = { id: 'u1', promo: { ...expired } }
        const db = fakeDb({ promoCodes: [codeDoc], users: [userDoc] })

        const res = await redeemPromoCode(db, { id: 'u1', promo: { ...expired } }, 'JD20')

        expect(res).toEqual({ code: 'JD20', freeNestingLimit: 20 })
        expect(userDoc.promo.code).toBe('JD20')
        expect(codeDoc.redemptionCount).toBe(1)
    })

    it('redeems when the stored promo is expired even on a stale read (no promo on the caller)', async () => {
        const codeDoc = JD20()
        const userDoc = { id: 'u1', promo: { code: 'OLD5', freeNestingLimit: 15, redeemedAt: PAST(), expiresAt: PAST() } }
        const db = fakeDb({ promoCodes: [codeDoc], users: [userDoc] })

        const res = await redeemPromoCode(db, { id: 'u1' }, 'JD20')

        expect(res.code).toBe('JD20')
        expect(userDoc.promo.code).toBe('JD20')
    })

    it('409 + compensation when the stored promo was renewed concurrently (still active)', async () => {
        // The caller read an expired promo, but the campaign was renewed
        // since — the user-side guard must refuse the overwrite.
        const codeDoc = JD20()
        const userDoc = { id: 'u1', promo: { code: 'OTHER', freeNestingLimit: 15, redeemedAt: PAST(), expiresAt: FUTURE() } }
        const db = fakeDb({ promoCodes: [codeDoc], users: [userDoc] })

        const staleUser = { id: 'u1', promo: { code: 'OTHER', freeNestingLimit: 15, redeemedAt: PAST(), expiresAt: PAST() } }
        await expectErr(redeemPromoCode(db, staleUser, 'JD20'), 409, 'promo_already')
        expect(codeDoc.redemptionCount).toBe(0) // compensating decrement applied
        expect(userDoc.promo.code).toBe('OTHER') // untouched
    })
})
