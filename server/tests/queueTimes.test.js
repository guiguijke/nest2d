import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// The mocked db is swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

import { getQueueTimes, summarizeQueueTimes } from '~~/server/features/metrics/queueTimes'
import { fakeDb } from './helpers/fakeMongo'

// Fresh handler per test: the 60 s response cache is module-level state.
async function loadHandler() {
    vi.resetModules()
    return (await import('~~/server/api/metrics/queue-times.get.js')).default
}

beforeEach(() => {
    state.db = null
})

describe('summarizeQueueTimes (pure)', () => {
    it('computes exact linear-interpolated percentiles on 1..100', () => {
        const rows = Array.from({ length: 100 }, (_, i) => ({
            tier: 'free',
            waitSec: i + 1,
            wallSec: i + 1,
        }))
        const out = summarizeQueueTimes(rows)
        expect(out.free.jobs).toBe(100)
        expect(out.free.waitP50Sec).toBeCloseTo(50.5, 10)
        expect(out.free.waitP95Sec).toBeCloseTo(95.05, 10)
        expect(out.free.wallP50Sec).toBeCloseTo(50.5, 10)
        expect(out.free.wallP95Sec).toBeCloseTo(95.05, 10)
    })

    it('returns null for a tier without any job', () => {
        const out = summarizeQueueTimes([{ tier: 'standard', waitSec: 3, wallSec: 9 }])
        expect(out.free).toBeNull()
        expect(out.privacy).toBeNull()
        expect(out.standard.jobs).toBe(1)
    })

    it('returns null for every tier on empty input', () => {
        expect(summarizeQueueTimes([])).toEqual({ free: null, standard: null, privacy: null })
        expect(summarizeQueueTimes(null)).toEqual({ free: null, standard: null, privacy: null })
    })

    it('filters structurally aberrant values (wait < 0, wall <= 0, NaN)', () => {
        const out = summarizeQueueTimes([
            { tier: 'free', waitSec: -5, wallSec: 100 }, // clock skew
            { tier: 'free', waitSec: 10, wallSec: 0 }, // impossible wall
            { tier: 'free', waitSec: 10, wallSec: -3 },
            { tier: 'free', waitSec: NaN, wallSec: 50 },
            { tier: 'free', waitSec: 12, wallSec: 60 }, // the only usable row
        ])
        expect(out.free).toEqual({
            jobs: 1,
            waitP50Sec: 12,
            waitP95Sec: 12,
            wallP50Sec: 60,
            wallP95Sec: 60,
        })
    })

    it('single value: p50 = p95 = value', () => {
        const out = summarizeQueueTimes([{ tier: 'privacy', waitSec: 7, wallSec: 42 }])
        expect(out.privacy.waitP50Sec).toBe(7)
        expect(out.privacy.waitP95Sec).toBe(7)
        expect(out.privacy.wallP50Sec).toBe(42)
        expect(out.privacy.wallP95Sec).toBe(42)
    })

    it('ignores unknown tiers and computes each tier independently', () => {
        const out = summarizeQueueTimes([
            { tier: 'enterprise', waitSec: 1, wallSec: 1 },
            { tier: 'free', waitSec: 2, wallSec: 10 },
            { tier: 'free', waitSec: 4, wallSec: 20 },
            { tier: 'standard', waitSec: 1, wallSec: 5 },
        ])
        expect(out).not.toHaveProperty('enterprise')
        expect(out.free).toEqual({ jobs: 2, waitP50Sec: 3, waitP95Sec: 3.9, wallP50Sec: 15, wallP95Sec: 19.5 })
        expect(out.standard.jobs).toBe(1)
    })
})

describe('getQueueTimes (Mongo query)', () => {
    const now = Date.now()
    const job = (overrides) => ({
        status: 'done',
        ownerId: 'user-1',
        createdAt: new Date(now - 60_000),
        startAt: new Date(now - 50_000), // 10 s wait
        finishedAt: new Date(now), // 50 s wall
        ...overrides,
    })

    it('aggregates per tier: compute.level wins, vcores fallback, exclusions applied', async () => {
        const docs = [
            job({ compute: { level: 'standard' }, params: { vcores: 1 } }), // level wins over vcores
            job({ params: { vcores: 4 } }), // legacy → standard
            job({ params: { vcores: 8 } }), // legacy → privacy
            job({ compute: { level: 'privacy' } }), // recent → privacy
            job({}), // nothing → free
            job({ ownerId: 'demo', compute: { level: 'privacy' } }), // demo → excluded
            job({ startAt: undefined, finishedAt: undefined }), // local browser job → excluded
            job({ createdAt: new Date(now - 40 * 24 * 3600 * 1000) }), // older than 30 j → excluded
            job({ status: 'processing' }), // not done → excluded
        ]
        state.db = fakeDb({ nesting_jobs: docs })
        const res = await getQueueTimes(state.db)

        expect(res.windowDays).toBe(30)
        expect(typeof res.generatedAt).toBe('string')
        expect(res.tiers.standard.jobs).toBe(2)
        expect(res.tiers.privacy.jobs).toBe(2)
        expect(res.tiers.free.jobs).toBe(1)
        // All kept jobs have wait 10 s / wall 50 s.
        expect(res.tiers.standard.waitP50Sec).toBeCloseTo(10, 10)
        expect(res.tiers.standard.wallP50Sec).toBeCloseTo(50, 10)

        const filter = state.db.collection('nesting_jobs').calls.find[0]
        expect(filter.status).toBe('done')
        expect(filter.ownerId).toEqual({ $ne: 'demo' })
        expect(filter.startAt).toEqual({ $exists: true })
        expect(filter.finishedAt).toEqual({ $exists: true })
        expect(filter.createdAt.$gte).toBeInstanceOf(Date)
    })

    it('returns null tiers when no job matches', async () => {
        state.db = fakeDb({ nesting_jobs: [] })
        const res = await getQueueTimes(state.db)
        expect(res.tiers).toEqual({ free: null, standard: null, privacy: null })
    })
})

describe('GET /api/metrics/queue-times (route)', () => {
    it('200 with the public response shape', async () => {
        const now = Date.now()
        state.db = fakeDb({
            nesting_jobs: [
                {
                    status: 'done',
                    ownerId: 'user-1',
                    compute: { level: 'standard' },
                    createdAt: new Date(now - 20_000),
                    startAt: new Date(now - 15_000),
                    finishedAt: new Date(now),
                },
            ],
        })
        const handler = await loadHandler()
        const res = await handler({ context: {} })
        expect(res.windowDays).toBe(30)
        expect(typeof res.generatedAt).toBe('string')
        expect(res.tiers.standard.jobs).toBe(1)
        expect(res.tiers.free).toBeNull()
        expect(res.tiers.privacy).toBeNull()
    })

    it('serves the 60 s module cache: Mongo hit once for two calls', async () => {
        state.db = fakeDb({ nesting_jobs: [] })
        const handler = await loadHandler()
        const first = await handler({ context: {} })
        const second = await handler({ context: {} })
        expect(second).toEqual(first)
        expect(state.db.collection('nesting_jobs').calls.find).toHaveLength(1)
    })
})
