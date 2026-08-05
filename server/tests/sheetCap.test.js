import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import './helpers/h3Shims'

// The mocked db is swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null, enqueued: [] }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/core/project/service', () => ({
    enqueueNestingJob: vi.fn(async (_domain, payload) => {
        state.enqueued.push(payload)
        return { ok: true, slug: 'job-1' }
    }),
}))
vi.mock('~~/server/tracking/add', () => ({
    trackEvent: vi.fn(),
}))
// Stripe must never be reached on the free-quota path.
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import nestHandler from '~~/server/api/project/[slug]/nest.post.js'
import { assertSheetCountWithinTier, sheetCapForTier, FREE_SHEET_CAP } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const ev = (userId, slug, body) => ({
    context: { auth: { userId } },
    _params: { slug },
    // nest.post.js imports readBody from 'h3' directly — h3 reads
    // event._requestBody as the raw body and asserts event.method.
    method: 'POST',
    _requestBody: JSON.stringify(body),
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})

const nestBody = (sheets) => ({
    files: [{ slug: 'f1', count: 10 }],
    params: {
        sheets: sheets.map(([w, h, c]) => ({ width: w, height: h, count: c })),
        space: 2,
    },
})

function baseDb(users, extra = {}) {
    return fakeDb({
        users,
        projects: [{ slug: 'p1', ownerId: 'u1' }],
        user_dxf_files: [{ slug: 'f1', name: 'part.dxf' }],
        subscription_plan: [{ priceId: 'price_std', tier: 'standard' }],
        ...extra,
    })
}

const freeUser = (overrides = {}) => ({
    id: 'u1',
    provider: 'google',
    freeNestingUsed: 0,
    freeNestingPeriod: currentPeriod(),
    ...overrides,
})

beforeEach(() => {
    state.db = null
    state.enqueued = []
})

describe('sheetCapForTier (resolver, AGENTS #34)', () => {
    it('free is capped, paid tiers uncapped, unknown tiers uncapped', () => {
        expect(sheetCapForTier('free')).toBe(FREE_SHEET_CAP)
        expect(sheetCapForTier('standard')).toBe(Infinity)
        expect(sheetCapForTier('privacy')).toBe(Infinity)
        expect(sheetCapForTier('whatever')).toBe(Infinity)
    })

    it('assertSheetCountWithinTier throws the stable 403 sheet_cap_exceeded', async () => {
        expect(() => assertSheetCountWithinTier(2, 'free')).not.toThrow()
        expect(() => assertSheetCountWithinTier(3, 'free')).toThrowError(
            expect.objectContaining({ statusCode: 403, statusMessage: 'sheet_cap_exceeded' })
        )
        expect(() => assertSheetCountWithinTier(50, 'standard')).not.toThrow()
    })
})

describe('POST /api/project/[slug]/nest — free sheet cap (D-PAY-9)', () => {
    it('free user at 3 sheets total (mixed formats) -> 403 sheet_cap_exceeded, quota NOT consumed', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = nestBody([[3000, 1500, 1], [1000, 2000, 1], [1000, 1000, 1]])
        await expect(nestHandler(ev('u1', 'p1', body))).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: 'sheet_cap_exceeded',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0) // cap enforced BEFORE any charge
    })

    it('free user at 2 sheets total -> enqueued, free unit consumed', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = nestBody([[3000, 1500, 2]])
        await nestHandler(ev('u1', 'p1', body))
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.freeNestingUsed).toBe(1)
    })

    it('legacy single-sheet params with sheetCount 3 -> 403 (same cap)', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = {
            files: [{ slug: 'f1', count: 10 }],
            params: { width: 3000, height: 1500, sheetCount: 3, space: 2 },
        }
        await expect(nestHandler(ev('u1', 'p1', body))).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: 'sheet_cap_exceeded',
        })
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('standard subscriber at 5 sheets -> enqueued (uncapped)', async () => {
        const userDoc = freeUser({
            subscription: { status: 'active', priceId: 'price_std', currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        })
        state.db = baseDb([userDoc])
        const body = nestBody([[3000, 1500, 5]])
        await nestHandler(ev('u1', 'p1', body))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.computeLevel).toBe('standard')
    })

    it('demo project at 3 sheets -> enqueued (EXEMPT from the cap, dedicated quota — J-056)', async () => {
        const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'demo', isDemo: true }],
            user_dxf_files: [{ slug: 'f1', name: 'marine.dxf', projectSlug: 'demo', isDemo: true }],
        })
        const body = nestBody([[3000, 1500, 3]])
        await nestHandler(ev('u1', 'demo', body))
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.demoNestingUsed).toBe(1)
        expect(userDoc.freeNestingUsed).toBe(0)
    })
})
