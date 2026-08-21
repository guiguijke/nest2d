import { beforeEach, describe, expect, it, vi } from 'vitest'

// J-090 — voie « projet 100 % privé » : le serveur ne voit que des
// métadonnées, le job part directement en awaiting_local (aucune
// préparation worker), le quota est consommé une seule fois et le gate
// vault est sauté (aucun fichier à lire côté serveur).

const state = vi.hoisted(() => ({ db: null, requireFileAccess: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

vi.mock('~~/server/utils/entitlement', () => ({
    assertCanNest: vi.fn(async () => ({ kind: 'free' })),
}))

vi.mock('~~/server/utils/vault', () => ({
    requireFileAccess: (...args) => state.requireFileAccess(...args),
    resolvePolygonParts: vi.fn(async () => []),
}))

vi.mock('~~/server/utils/colors', () => ({
    resolvePartColor: vi.fn(() => '#2563EB'),
}))

import { DOMAINS } from '~~/server/core/domains'
import { buildJobSlug, createLocalProject, enqueueNestingJob } from '~~/server/core/project/service'
import { fakeDb } from './helpers/fakeMongo'

beforeEach(() => {
    state.db = fakeDb({ projects: [], nesting_jobs: [] })
    state.requireFileAccess = vi.fn(async () => ({ dek: null }))
})

describe('createLocalProject (J-090)', () => {
    it('inserts a metadata-only project flagged local', async () => {
        const { slug } = await createLocalProject(DOMAINS.bin, 'u1')
        const docs = state.db.collection('projects').calls.insertOne
        expect(docs).toHaveLength(1)
        expect(docs[0]).toMatchObject({ slug, ownerId: 'u1', local: true })
        expect(docs[0].name).toBeTruthy()
        expect(docs[0].createdAt).toBeInstanceOf(Date)
    })
})

describe('enqueueNestingJob — voie locale (J-090)', () => {
    const base = {
        userId: 'u1',
        projectSlug: 'proj-1',
        fileMetadata: [{ slug: 'a.dxf', simpleName: 'a', count: 2, rotations: [0, 90, 180, 270] }],
        params: { sheets: [{ width: 1000, height: 2000, count: 5 }], space: 2, computeLocation: 'local' },
        extraFields: { priority: 20 },
        charge: { kind: 'free' },
    }

    it('inserts the job awaiting_local with the imposed localConfig, no vault gate', async () => {
        const { slug } = await enqueueNestingJob(DOMAINS.bin, {
            ...base,
            skipVaultGate: true,
            initialStatus: 'awaiting_local',
            localConfig: { timeBudgetSec: 13, vcores: 1, maxDirections: 1, directions: ['left'], level: 'browser' },
        })
        expect(slug).toBeTruthy()
        const inserted = state.db.collection('nesting_jobs').calls.insertOne
        expect(inserted).toHaveLength(1)
        expect(inserted[0].status).toBe('awaiting_local')
        expect(inserted[0].localConfig).toMatchObject({ timeBudgetSec: 13, level: 'browser' })
        expect(inserted[0].charge).toEqual({ kind: 'free' })
        // Vault jamais touché : pas de session DEK requise pour un job
        // dont la géométrie ne passe jamais par le serveur.
        expect(state.requireFileAccess).not.toHaveBeenCalled()
    })

    it('buildJobSlug without simpleName uses the opaque slug, not a filename', () => {
        const slug = buildJobSlug(DOMAINS.bin, [
            { slug: 'f-aabbccddeeff.dxf', count: 3 },
        ])
        expect(slug).toMatch(/^nested-f-aabbccddeeff_3-[a-f0-9]+$/)
        expect(slug).not.toMatch(/secret|client|bracket/i)
    })

    it('keeps the legacy shape for cloud jobs (pending, no localConfig, vault gate on)', async () => {
        await enqueueNestingJob(DOMAINS.bin, { ...base })
        const inserted = state.db.collection('nesting_jobs').calls.insertOne
        expect(inserted[0].status).toBe('pending')
        expect(inserted[0].localConfig).toBeUndefined()
        expect(state.requireFileAccess).toHaveBeenCalledOnce()
    })
})
