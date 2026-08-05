import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// The mocked db is swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

// createVaultSession wraps the DEK with the deployment master key — mocked:
// the wrap itself is covered by the vault utils, what matters here is that
// the handler calls it BEFORE persisting the fingerprint (never half-enabled).
const vaultMocks = vi.hoisted(() => ({
    createVaultSession: vi.fn(async () => ({ expiresAt: new Date() })),
    getVaultStatus: vi.fn(async () => ({ enabled: false, locked: true, keyId: null })),
}))
vi.mock('~~/server/utils/vault', () => vaultMocks)

import enableHandler from '~~/server/api/security/vault/enable.post.js'
import statusHandler from '~~/server/api/security/vault/status.get.js'
import { getComputeTier } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

const KEY = Buffer.alloc(32, 7).toString('base64')
const ev = (userId, body = { key: KEY }) => ({ context: { auth: { userId } }, _body: body })

async function expectErr(promise, statusCode, statusMessage) {
    await expect(promise).rejects.toMatchObject({ statusCode, statusMessage })
}

beforeEach(() => {
    state.db = null
    vaultMocks.createVaultSession.mockClear()
    vaultMocks.getVaultStatus.mockClear()
})

describe('POST /api/security/vault/enable (opt-in tous plans — D-PRV-5)', () => {
    it('401 without auth', async () => {
        await expectErr(enableHandler({ context: {} }), 401, 'Unauthorized')
    })

    it('200 for a FREE user (no subscription, no tier gate anymore)', async () => {
        const userDoc = { id: 'u1', provider: 'google' }
        state.db = fakeDb({ users: [userDoc] })
        const res = await enableHandler(ev('u1'))
        expect(res.ok).toBe(true)
        expect(res.keyId).toHaveLength(8)
        // Session wrapped BEFORE the fingerprint persisted (never half-enabled).
        expect(vaultMocks.createVaultSession).toHaveBeenCalledTimes(1)
        expect(userDoc.encryption?.enabled).toBe(true)
        expect(userDoc.encryption?.keyId).toBe(res.keyId)
    })

    it('200 for a privacy-tier subscriber (regression: the tier still activates)', async () => {
        const userDoc = {
            id: 'u1',
            provider: 'google',
            subscription: { status: 'active', priceId: 'price_privacy' },
        }
        state.db = fakeDb({ users: [userDoc], subscription_plan: [{ priceId: 'price_privacy', tier: 'privacy' }] })
        const res = await enableHandler(ev('u1'))
        expect(res.ok).toBe(true)
    })

    it('403 email_not_verified for a local unverified account — FIRST, before key validation and the 409', async () => {
        // Unverified + already enabled + still gets the 403 (guard order).
        const userDoc = { id: 'u1', provider: 'local', emailVerified: false, encryption: { enabled: true } }
        state.db = fakeDb({ users: [userDoc] })
        await expectErr(enableHandler(ev('u1', { key: 'too-short' })), 403, 'email_not_verified')
        expect(vaultMocks.createVaultSession).not.toHaveBeenCalled()
    })

    it('200 for a local VERIFIED account', async () => {
        const userDoc = { id: 'u1', provider: 'local', emailVerified: true }
        state.db = fakeDb({ users: [userDoc] })
        const res = await enableHandler(ev('u1'))
        expect(res.ok).toBe(true)
    })

    it('400 on an invalid key (after the email guard)', async () => {
        const userDoc = { id: 'u1', provider: 'google' }
        state.db = fakeDb({ users: [userDoc] })
        await expectErr(enableHandler(ev('u1', { key: 'AAAA' })), 400, 'Invalid key')
        expect(vaultMocks.createVaultSession).not.toHaveBeenCalled()
    })

    it('409 when the vault is already enabled', async () => {
        const userDoc = { id: 'u1', provider: 'google', encryption: { enabled: true } }
        state.db = fakeDb({ users: [userDoc] })
        await expect(enableHandler(ev('u1'))).rejects.toMatchObject({ statusCode: 409 })
        expect(vaultMocks.createVaultSession).not.toHaveBeenCalled()
    })
})

describe('GET /api/security/vault/status', () => {
    it('returns eligible: true for every plan (stable API shape)', async () => {
        state.db = fakeDb({ users: [{ id: 'u1' }] })
        const res = await statusHandler({ context: { auth: { userId: 'u1' } } })
        expect(res.eligible).toBe(true)
        expect(res.enabled).toBe(false)
    })

    it('401 without auth', async () => {
        await expectErr(statusHandler({ context: {} }), 401, 'Unauthorized')
    })
})

describe('compute tier `privacy` (D-PAY-8: compute only — regression)', () => {
    it('still resolves to privacy compute for a privacy subscriber', async () => {
        const userDoc = {
            id: 'u1',
            subscription: { status: 'active', priceId: 'price_privacy' },
        }
        state.db = fakeDb({ users: [userDoc], subscription_plan: [{ priceId: 'price_privacy', tier: 'privacy' }] })
        expect(await getComputeTier('u1', null)).toBe('privacy')
    })

    it('standard for a standard subscriber, free without anything', async () => {
        const std = { id: 'u2', subscription: { status: 'active', priceId: 'price_std' } }
        const free = { id: 'u3' }
        state.db = fakeDb({ users: [std, free], subscription_plan: [{ priceId: 'price_std', tier: 'standard' }] })
        expect(await getComputeTier('u2', null)).toBe('standard')
        expect(await getComputeTier('u3', null)).toBe('free')
    })
})
