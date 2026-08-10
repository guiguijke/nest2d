import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// The mocked db is swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

// The vault session cache is mocked for the HANDLER tests below (what matters
// there is call ordering, not storage). The real RAM implementation is
// exercised through `realVault` (vi.importActual) in the D-PRV-7 describe.
const vaultMocks = vi.hoisted(() => ({
    createVaultSession: vi.fn(async () => ({ expiresAt: new Date() })),
    getVaultStatus: vi.fn(async () => ({ enabled: false, locked: true, keyId: null })),
}))
vi.mock('~~/server/utils/vault', () => vaultMocks)

import enableHandler from '~~/server/api/security/vault/enable.post.js'
import statusHandler from '~~/server/api/security/vault/status.get.js'
import { getComputeTier } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

// Real (unmocked) vault utils: RAM session cache, no Mongo involved for
// sessions anymore (D-PRV-7). The module Map is shared across these tests —
// each uses its own userId.
const realVault = await vi.importActual('~~/server/utils/vault')

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

afterEach(() => {
    vi.restoreAllMocks()
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
        // Session opened BEFORE the fingerprint persisted (never half-enabled).
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

describe('vault session RAM cache (D-PRV-7 — no Mongo, no wrap)', () => {
    const dek = () => Buffer.alloc(32, 42)

    it('createVaultSession + getVaultSession round-trips the DEK', async () => {
        const { expiresAt } = await realVault.createVaultSession('ram-u1', dek())
        expect(expiresAt).toBeInstanceOf(Date)
        const session = await realVault.getVaultSession('ram-u1')
        expect(session).not.toBeNull()
        expect(session.dek.equals(dek())).toBe(true)
        expect(session.expiresAt).toBeInstanceOf(Date)
        await realVault.clearVaultSessions('ram-u1')
    })

    it('stores a defensive copy: mutating the caller buffer does not alias the session', async () => {
        const caller = dek()
        await realVault.createVaultSession('ram-u2', caller)
        caller.fill(0)
        const session = await realVault.getVaultSession('ram-u2')
        expect(session.dek.equals(dek())).toBe(true)
        await realVault.clearVaultSessions('ram-u2')
    })

    it('slides the TTL on activity (mocked Date.now)', async () => {
        const t0 = 1_000_000
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0)
        await realVault.createVaultSession('ram-u3', dek())

        // 1h later: activity slides the window to t0+1h+2h.
        nowSpy.mockReturnValue(t0 + 60 * 60 * 1000)
        const session = await realVault.getVaultSession('ram-u3')
        expect(session).not.toBeNull()
        expect(session.expiresAt.getTime()).toBe(t0 + 3 * 60 * 60 * 1000)

        // 1h59m later: still alive thanks to the slide.
        nowSpy.mockReturnValue(t0 + 3 * 60 * 60 * 1000 - 60 * 1000)
        expect(await realVault.getVaultSession('ram-u3')).not.toBeNull()
        await realVault.clearVaultSessions('ram-u3')
    })

    it('returns null after expiry AND wipes the buffer', async () => {
        const t0 = 2_000_000
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0)
        await realVault.createVaultSession('ram-u4', dek())
        const session = await realVault.getVaultSession('ram-u4')
        const mapBuffer = session.dek // the session's own buffer

        nowSpy.mockReturnValue(t0 + realVault.VAULT_SESSION_TTL_MS + 1)
        expect(await realVault.getVaultSession('ram-u4')).toBeNull()
        // The wiped buffer is all zeros — the DEK is gone even for anyone
        // still holding a reference.
        expect(mapBuffer.every((b) => b === 0)).toBe(true)
    })

    it('clearVaultSessions wipes and removes the session', async () => {
        await realVault.createVaultSession('ram-u5', dek())
        const session = await realVault.getVaultSession('ram-u5')
        const mapBuffer = session.dek
        await realVault.clearVaultSessions('ram-u5')
        expect(await realVault.getVaultSession('ram-u5')).toBeNull()
        expect(mapBuffer.every((b) => b === 0)).toBe(true)
    })

    it('re-creating a session wipes the previous buffer', async () => {
        await realVault.createVaultSession('ram-u6', dek())
        const first = (await realVault.getVaultSession('ram-u6')).dek
        await realVault.createVaultSession('ram-u6', Buffer.alloc(32, 9))
        expect(first.every((b) => b === 0)).toBe(true)
        const session = await realVault.getVaultSession('ram-u6')
        expect(session.dek.equals(Buffer.alloc(32, 9))).toBe(true)
        await realVault.clearVaultSessions('ram-u6')
    })

    it('requireFileAccess throws 403 vault_locked without an active session', async () => {
        state.db = fakeDb({ users: [{ id: 'ram-u7', encryption: { enabled: true } }] })
        await expectErr(realVault.requireFileAccess('ram-u7'), 403, 'vault_locked')
    })

    it('requireFileAccess returns the DEK with an active session', async () => {
        state.db = fakeDb({ users: [{ id: 'ram-u8', encryption: { enabled: true } }] })
        await realVault.createVaultSession('ram-u8', dek())
        const { dek: granted } = await realVault.requireFileAccess('ram-u8')
        expect(granted.equals(dek())).toBe(true)
        await realVault.clearVaultSessions('ram-u8')
    })

    it('requireFileAccess returns dek: null when encryption is disabled (legacy plaintext path)', async () => {
        state.db = fakeDb({ users: [{ id: 'ram-u9' }] })
        const { dek: granted } = await realVault.requireFileAccess('ram-u9')
        expect(granted).toBeNull()
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
