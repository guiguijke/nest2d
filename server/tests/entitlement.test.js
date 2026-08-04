import { beforeEach, describe, expect, it, vi } from 'vitest'

// The mocked db is swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

// Stripe must never be reached on the free-quota path — the mocks make any
// accidental call loud instead of a network attempt.
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import { assertCanNest, effectiveFreeLimit, getEntitlement } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const freeUser = (overrides = {}) => ({
    id: 'u1',
    provider: 'google',
    freeNestingUsed: 0,
    freeNestingPeriod: currentPeriod(),
    ...overrides,
})

beforeEach(() => {
    state.db = null
})

describe('effectiveFreeLimit', () => {
    it('falls back to the default limit without a promo', () => {
        expect(effectiveFreeLimit(undefined)).toBe(10)
        expect(effectiveFreeLimit({})).toBe(10)
        expect(effectiveFreeLimit({ promo: {} })).toBe(10)
    })

    it('uses the snapshotted promo limit', () => {
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: 20 } })).toBe(20)
    })

    it('ignores corrupt snapshot values', () => {
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: 0 } })).toBe(10)
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: -5 } })).toBe(10)
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: '20' } })).toBe(10)
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: 20.5 } })).toBe(10)
    })
})

describe('getEntitlement', () => {
    it('computes freeRemaining from the default limit without promo', async () => {
        state.db = fakeDb({ users: [freeUser({ freeNestingUsed: 3 })] })
        const res = await getEntitlement('u1')
        expect(res.freeRemaining).toBe(7)
        expect(res.requiresPaywall).toBe(false)
    })

    it('computes freeRemaining from the promo-raised limit', async () => {
        state.db = fakeDb({
            users: [freeUser({ freeNestingUsed: 3, promo: { code: 'JD20', freeNestingLimit: 20 } })],
        })
        const res = await getEntitlement('u1')
        expect(res.freeRemaining).toBe(17)
    })

    it('resets the monthly counter lazily, on the raised limit when promo', async () => {
        const user = freeUser({
            freeNestingUsed: 8,
            freeNestingPeriod: '2020-01', // previous month → lazy reset
            promo: { code: 'JD20', freeNestingLimit: 20 },
        })
        state.db = fakeDb({ users: [user] })
        const res = await getEntitlement('u1')
        expect(user.freeNestingUsed).toBe(0)
        expect(user.freeNestingPeriod).toBe(currentPeriod())
        expect(res.freeRemaining).toBe(20)
    })

    it('requiresPaywall when the promo-raised quota is exhausted', async () => {
        state.db = fakeDb({
            users: [freeUser({ freeNestingUsed: 20, promo: { code: 'JD20', freeNestingLimit: 20 } })],
        })
        const res = await getEntitlement('u1')
        expect(res.freeRemaining).toBe(0)
        expect(res.requiresPaywall).toBe(true)
    })
})

describe('assertCanNest', () => {
    it('charges the free quota up to the promo-raised limit (atomic filter carries it)', async () => {
        const user = freeUser({ freeNestingUsed: 19, promo: { code: 'JD20', freeNestingLimit: 20 } })
        const db = fakeDb({ users: [user] })
        state.db = db

        const charge = await assertCanNest('u1')
        expect(charge).toEqual({ type: 'free' })
        expect(user.freeNestingUsed).toBe(20)

        const calls = db.collection('users').calls.findOneAndUpdate
        expect(calls[0].filter.freeNestingUsed).toEqual({ $lt: 20 })

        // 21st nesting → paywall.
        await expect(assertCanNest('u1')).rejects.toMatchObject({ statusCode: 402 })
    })

    it('keeps the default limit without promo', async () => {
        const user = freeUser({ freeNestingUsed: 10 })
        state.db = fakeDb({ users: [user] })
        await expect(assertCanNest('u1')).rejects.toMatchObject({ statusCode: 402 })
    })

    it('charge order unchanged: an admin grant still primes over the promo quota', async () => {
        const user = freeUser({
            grantedUntil: new Date(Date.now() + 24 * 3600 * 1000),
            promo: { code: 'JD20', freeNestingLimit: 20 },
        })
        state.db = fakeDb({ users: [user] })
        const charge = await assertCanNest('u1')
        expect(charge).toEqual({ type: 'grant' })
        expect(user.freeNestingUsed).toBe(0) // no free slot consumed
    })

    it('charge order unchanged: an active subscription still primes over the promo quota', async () => {
        const user = freeUser({
            subscription: {
                status: 'active',
                currentPeriodEnd: new Date(Date.now() + 24 * 3600 * 1000),
            },
            promo: { code: 'JD20', freeNestingLimit: 20 },
        })
        state.db = fakeDb({ users: [user] })
        const charge = await assertCanNest('u1')
        expect(charge).toEqual({ type: 'subscription' })
        expect(user.freeNestingUsed).toBe(0)
    })
})
