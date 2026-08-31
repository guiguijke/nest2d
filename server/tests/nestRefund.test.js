import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// R-1 (audit 2026-08-31 §R-1) : la charge de quota (assertCanNest) avait lieu
// AVANT des validations qui peuvent échouer (409 concurrent_limit, échec
// d'insertion/vault) — une unité gratuite brûlée sans job créé ni refund.
// Ces tests verrouillent le refund côté route (le refund interne
// d'enqueueNestingJob, lui, vit dans service.js).

const state = vi.hoisted(() => ({ db: null, enqueued: [], enqueueImpl: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/core/project/service', () => ({
    enqueueNestingJob: vi.fn(async (_domain, payload) => {
        state.enqueued.push(payload)
        if (state.enqueueImpl) return state.enqueueImpl()
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
import { fakeDb } from './helpers/fakeMongo'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const ev = (userId, slug, body) => ({
    context: { auth: { userId } },
    _params: { slug },
    method: 'POST',
    _requestBody: JSON.stringify(body),
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})

const nestBody = () => ({
    files: [{ slug: 'f1', count: 10 }],
    params: {
        sheets: [{ width: 3000, height: 1500, count: 1 }],
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
    state.enqueueImpl = null
})

describe('POST /api/project/[slug]/nest — refund des charges pré-enqueue (R-1)', () => {
    it('409 concurrent_limit : l\'unité free consommée est RESTITUÉE (verrou R-1)', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc], {
            // Free = 1 job parallèle max : un job actif sature le quota.
            nesting_jobs: [{ slug: 'job-running', ownerId: 'u1', status: 'pending' }],
        })
        await expect(nestHandler(ev('u1', 'p1', nestBody()))).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: 'concurrent_limit',
        })
        expect(state.enqueued).toHaveLength(0)
        // Chargée par assertCanNest puis refundée par le catch de la route :
        // avant le fix, elle restait consommée sans job créé.
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('échec d\'enqueue (vault verrouillé simulé) : refund, erreur relancée', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        state.enqueueImpl = () => {
            throw Object.assign(new Error('vault locked'), {
                statusCode: 403,
                statusMessage: 'vault_locked',
            })
        }
        await expect(nestHandler(ev('u1', 'p1', nestBody()))).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: 'vault_locked',
        })
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('succès : PAS de refund — l\'unité reste portée par le job (refund worker si échec)', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        await nestHandler(ev('u1', 'p1', nestBody()))
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.freeNestingUsed).toBe(1)
        // La charge passée au job est intacte (jamais marquée refunded : le
        // refund interne d'enqueueNestingJob est mocké ici — c'est le job
        // qui porte l'unité, le worker la refunde si le nesting échoue).
        expect(state.enqueued[0].charge).toEqual({ type: 'free' })
    })
})
