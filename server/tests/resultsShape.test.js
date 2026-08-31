import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

const state = vi.hoisted(() => ({ db: null }))
vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

import { getResults } from '~~/server/features/results/resultcontroller'
import { fakeDb } from './helpers/fakeMongo'

beforeEach(() => {
    state.db = fakeDb({
        nesting_jobs: [
            { slug: 'jA', ownerId: 'u1', projectSlug: 'pA', status: 'awaiting_local', createdAt: new Date('2026-08-30') },
            { slug: 'jB', ownerId: 'u1', projectSlug: 'pB', status: 'done', createdAt: new Date('2026-08-29') },
        ],
    })
})

describe('getResults — projectSlug additif (isolation live)', () => {
    it('each item carries projectSlug; filter by project keeps only that slug', async () => {
        const all = await getResults('u1')
        expect(all.items.map((i) => i.projectSlug).sort()).toEqual(['pA', 'pB'])
        const aOnly = await getResults('u1', 'pA')
        expect(aOnly.items).toHaveLength(1)
        expect(aOnly.items[0].slug).toBe('jA')
        expect(aOnly.items[0].projectSlug).toBe('pA')
        expect(aOnly.items[0].status).toBe('awaiting_local')
    })
})
