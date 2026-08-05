import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// The mocked db + runtime config are swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null, enqueued: [], config: { public: { localComputeEnabled: false } } }))
globalThis.useRuntimeConfig = () => state.config

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
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import nestHandler from '~~/server/api/project/[slug]/nest.post.js'
import payloadHandler from '~~/server/api/results/[slug]/local-payload.get.js'
import resultHandler from '~~/server/api/results/[slug]/local-result.post.js'
import failHandler from '~~/server/api/results/[slug]/local-fail.post.js'
import { BROWSER_COMPUTE, resolveComputeLocation } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const ev = (userId, slug, body, method = 'POST') => ({
    context: { auth: { userId } },
    _params: { slug },
    method,
    // nest.post.js uses h3's readBody (reads _requestBody); the local routes
    // use the auto-imported one (shimmed, reads _body).
    _requestBody: JSON.stringify(body ?? {}),
    _body: body ?? {},
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})

const nestBody = (sheets) => ({
    files: [{ slug: 'f1', count: 10 }],
    params: { sheets: sheets.map(([w, h, c]) => ({ width: w, height: h, count: c })), space: 2 },
})

const freeUser = (overrides = {}) => ({
    id: 'u1',
    provider: 'google',
    freeNestingUsed: 0,
    freeNestingPeriod: currentPeriod(),
    ...overrides,
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

beforeEach(() => {
    state.db = null
    state.enqueued = []
    state.config = { public: { localComputeEnabled: false } }
})

describe('resolveComputeLocation (resolver, J-059)', () => {
    it('flag OFF => null (nothing written, pipeline unchanged)', () => {
        expect(resolveComputeLocation(false, true, 'free', null)).toBe(null)
        expect(resolveComputeLocation('false', false, 'free', null)).toBe(null)
    })
    it('demo => local (QA vehicle, every account)', () => {
        expect(resolveComputeLocation(true, true, 'standard', null)).toBe('local')
    })
    it('free => local ; paid => project opt-in or server', () => {
        expect(resolveComputeLocation(true, false, 'free', null)).toBe('local')
        expect(resolveComputeLocation('true', false, 'standard', {})).toBe('server')
        expect(resolveComputeLocation(true, false, 'privacy', { localCompute: true })).toBe('local')
    })
})

describe('POST nest — computeLocation written server-side (P3)', () => {
    it('flag OFF: no computeLocation, legacy profile (strictly unchanged)', async () => {
        state.db = baseDb([freeUser()])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1]])))
        expect(state.enqueued).toHaveLength(1)
        const params = state.enqueued[0].params
        expect(params.computeLocation).toBeUndefined()
        expect(params.computeLevel).toBe('free')
        expect(params.timeBudgetSec).toBe(600)
    })

    it('flag ON + free: local + browser profile (13 s, 1 vcore, level browser)', async () => {
        state.config = { public: { localComputeEnabled: 'true' } }
        state.db = baseDb([freeUser()])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1]])))
        const params = state.enqueued[0].params
        expect(params.computeLocation).toBe('local')
        expect(params.computeLevel).toBe('browser')
        expect(params.timeBudgetSec).toBe(BROWSER_COMPUTE.timeBudgetSec)
        expect(params.vcores).toBe(1)
        expect(params.directions).toHaveLength(1)
    })

    it('flag ON + demo: local regardless of tier (QA vehicle), demo quota consumed', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'demo', isDemo: true }],
            user_dxf_files: [{ slug: 'f1', name: 'marine.dxf', projectSlug: 'demo', isDemo: true }],
        })
        await nestHandler(ev('u1', 'demo', nestBody([[3000, 1500, 2]])))
        expect(state.enqueued[0].params.computeLocation).toBe('local')
        expect(state.enqueued[0].params.computeLevel).toBe('browser')
        expect(userDoc.demoNestingUsed).toBe(1)
    })
})

describe('local-payload / local-result / local-fail routes (flag-gated)', () => {
    const localJob = (overrides = {}) => ({
        slug: 'job-1',
        ownerId: 'u1',
        projectSlug: 'p1',
        status: 'awaiting_local',
        requested: 10,
        params: { sheets: [{ width: 3000, height: 1500, count: 1 }] },
        charge: { type: 'free' },
        localPayload: {
            problem: 'bpp',
            instance: { name: 'x', items: [], bins: [] },
            // Mongo BSON Int64 surfaces as a Long — mimic its toString().
            engineConfig: { time_budget_sec: 13, prng_seed: { toString: () => '4122680510047324256' } },
        },
        ...overrides,
    })

    it('local-payload: 404 when flag OFF, 409 when not awaiting, 200 with seed as string', async () => {
        state.db = fakeDb({ nesting_jobs: [localJob()] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 404 })

        state.config = { public: { localComputeEnabled: 'true' } }
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(res.problem).toBe('bpp')
        expect(res.engineConfig.prng_seed).toBe('4122680510047324256') // Int64 serialized (AGENTS #16)

        state.db = fakeDb({ nesting_jobs: [localJob({ status: 'done', localPayload: null })] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 409 })
    })

    it('local-result: marks done with normalized alternatives, payload unset, charge NOT refunded', async () => {
        const jobDoc = localJob()
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [jobDoc] })
        const alternatives = [{
            rank: 0,
            seed: 42,
            bias: 'left',
            iterations: 25,
            solution: {
                cost: 2,
                density: 0.375,
                layouts: [{ placed_items: [{ item_id: 0, transformation: { rotation: 90, translation: [10, 20] } }] }],
            },
        }]
        const res = await resultHandler(ev('u1', 'job-1', { alternatives }))
        expect(res.ok).toBe(true)
        expect(jobDoc.status).toBe('done')
        expect(jobDoc.alternatives[0].strategy).toBe('left')
        expect(jobDoc.alternatives[0].layoutCount).toBe(1)
        expect(jobDoc.alternatives[0].metrics.cost).toBe(2)
        expect(jobDoc.liveLayout.stage).toBe('final')
        expect(jobDoc.liveLayout.items[0]).toEqual([0, 0, 90, 10, 20])
        expect(jobDoc.localPayload).toBeUndefined()
        expect(jobDoc.charge.refunded).toBeUndefined()
    })

    it('local-fail: refunds the free slot inline (mirror refund.py), marks error', async () => {
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const jobDoc = localJob()
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [jobDoc], users: [userDoc] })
        const res = await failHandler(ev('u1', 'job-1', { error: 'memory_cap' }))
        expect(res.ok).toBe(true)
        expect(jobDoc.status).toBe('error')
        expect(userDoc.freeNestingUsed).toBe(2) // refunded
        expect(jobDoc.charge.refunded).toBe(true)
    })

    it('local-fail: demo charge refunds the demo slot ; grant refunds nothing', async () => {
        const userDoc = freeUser({ demoNestingUsed: 4 })
        const demoJob = localJob({ projectSlug: 'demo', charge: { type: 'demo' } })
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [demoJob], users: [userDoc] })
        await failHandler(ev('u1', 'job-1', { error: 'boom' }))
        expect(userDoc.demoNestingUsed).toBe(3)

        const grantJob = localJob({ slug: 'job-2', ownerId: 'u2', charge: { type: 'grant' } })
        const userDoc2 = freeUser({ id: 'u2', freeNestingUsed: 5 })
        state.db = fakeDb({ nesting_jobs: [grantJob], users: [userDoc2] })
        await failHandler(ev('u2', 'job-2', { error: 'boom' }))
        expect(userDoc2.freeNestingUsed).toBe(5)
        expect(grantJob.charge.refunded).toBe(true)
    })

    it('routes 404 for other users\u2019 jobs (never reveal existence)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [localJob({ ownerId: 'someone-else' })] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 404 })
        await expect(resultHandler(ev('u1', 'job-1', { alternatives: [{}] }))).rejects.toMatchObject({ statusCode: 404 })
    })
})
