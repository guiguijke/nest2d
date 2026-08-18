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

import { assertCanNest, effectiveFreeLimit, getComputeProfile, getComputeTier, getDemoEntitlement, getEntitlement, validateDirections } from '~~/server/utils/entitlement'
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

    it('follows the campaign end date: expired promo falls back to the default', () => {
        const future = new Date(Date.now() + 180 * 24 * 3600 * 1000)
        const past = new Date(Date.now() - 24 * 3600 * 1000)
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: 20, expiresAt: future } })).toBe(20)
        expect(effectiveFreeLimit({ promo: { freeNestingLimit: 20, expiresAt: past } })).toBe(10)
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

    it('computes freeRemaining on the default limit once the campaign has ended', async () => {
        state.db = fakeDb({
            users: [
                freeUser({
                    freeNestingUsed: 3,
                    promo: { code: 'JD20', freeNestingLimit: 20, expiresAt: new Date(Date.now() - 24 * 3600 * 1000) },
                }),
            ],
        })
        const res = await getEntitlement('u1')
        expect(res.freeRemaining).toBe(7)
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

    it('charges against the default limit once the promo campaign has ended', async () => {
        const user = freeUser({
            freeNestingUsed: 10,
            promo: { code: 'JD20', freeNestingLimit: 20, expiresAt: new Date(Date.now() - 24 * 3600 * 1000) },
        })
        const db = fakeDb({ users: [user] })
        state.db = db
        await expect(assertCanNest('u1')).rejects.toMatchObject({ statusCode: 402 })
        const calls = db.collection('users').calls.findOneAndUpdate
        expect(calls[0].filter.freeNestingUsed).toEqual({ $lt: 10 })
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

describe('getComputeTier (admin grant tiers, D-PAY-11)', () => {
    const day = 24 * 3600 * 1000

    it('defaults a grant without grantedTier to standard (historical behaviour)', async () => {
        state.db = fakeDb({ users: [freeUser({ grantedUntil: new Date(Date.now() + day) })] })
        expect(await getComputeTier('u1', null)).toBe('standard')
        const profile = await getComputeProfile('u1', null)
        expect(profile).toMatchObject({ vcores: 4, priority: 20, maxDirections: 3, level: 'standard' })
    })

    it('grantedTier privacy promotes to the Pro compute profile', async () => {
        state.db = fakeDb({
            users: [freeUser({ grantedUntil: new Date(Date.now() + day), grantedTier: 'privacy' })],
        })
        expect(await getComputeTier('u1', null)).toBe('privacy')
        const profile = await getComputeProfile('u1', null)
        expect(profile).toMatchObject({ vcores: 8, priority: 10, maxDirections: 3, level: 'privacy' })
    })

    it('honors grantedTier on the enqueue path (charge type grant)', async () => {
        state.db = fakeDb({
            users: [freeUser({ grantedUntil: new Date(Date.now() + day), grantedTier: 'privacy' })],
        })
        expect(await getComputeTier('u1', { type: 'grant' })).toBe('privacy')
    })

    it('an expired grant falls back to free even with grantedTier set', async () => {
        state.db = fakeDb({
            users: [freeUser({ grantedUntil: new Date(Date.now() - day), grantedTier: 'privacy' })],
        })
        expect(await getComputeTier('u1', null)).toBe('free')
    })

    it('a real Stripe subscription always wins over a grant', async () => {
        state.db = fakeDb({
            users: [freeUser({
                subscription: { status: 'active', currentPeriodEnd: new Date(Date.now() + day) },
                grantedUntil: new Date(Date.now() + day),
                grantedTier: 'privacy',
            })],
        })
        // Unknown priceId → standard by default, never a silent premium.
        expect(await getComputeTier('u1', null)).toBe('standard')
    })
})

describe('getDemoEntitlement', () => {
    it('is unlimited when local compute is on (string or boolean)', async () => {
        state.db = fakeDb({ users: [freeUser({ demoNestingUsed: 10, demoNestingPeriod: currentPeriod() })] })
        await expect(getDemoEntitlement('u1', true)).resolves.toEqual({
            demoRemaining: null,
            demoUnlimited: true,
        })
        await expect(getDemoEntitlement('u1', 'true')).resolves.toEqual({
            demoRemaining: null,
            demoUnlimited: true,
        })
    })

    it('keeps the monthly cap when local compute is off', async () => {
        state.db = fakeDb({ users: [freeUser({ demoNestingUsed: 3, demoNestingPeriod: currentPeriod() })] })
        await expect(getDemoEntitlement('u1', false)).resolves.toEqual({
            demoRemaining: 7,
            demoUnlimited: false,
        })
    })
})

describe('validateDirections (D-MOT-5 amendé)', () => {
    it('defaults to left when the client sends nothing', () => {
        expect(validateDirections(undefined, 3)).toEqual(['left'])
        expect(validateDirections([], 3)).toEqual(['left'])
    })

    it('keeps a requested subset in canonical order', () => {
        expect(validateDirections(['balanced', 'left'], 3)).toEqual(['left', 'balanced'])
    })
})
