import { beforeEach, describe, expect, it, vi } from 'vitest'

// The mocked db is swapped per test through this hoisted state; bucket
// deletions are recorded (the sweeper must go through bucket.delete so
// GridFS chunks follow — a raw .files delete would orphan them).
const state = vi.hoisted(() => ({ db: null, deleted: [] }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
    getBucket: vi.fn(),
}))

vi.mock('~~/server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runPurgeOnce, PURGE_AFTER_MS } from '~~/server/features/purge/sweep'
import { fakeDb } from './helpers/fakeMongo'

const NOW = new Date('2026-08-10T12:00:00Z')
const OLD = new Date(NOW.getTime() - PURGE_AFTER_MS - 2 * 60 * 60 * 1000) // 26 h
const FRESH = new Date(NOW.getTime() - 60 * 60 * 1000) // 1 h

const blob = (filename, uploadDate, metadata = { ownerId: 'u1' }) => ({
    _id: `id:${filename}`,
    filename,
    uploadDate,
    metadata,
})

const deleteBlob = async (bucket, id) => {
    state.deleted.push([bucket, id])
}

beforeEach(() => {
    state.db = null
    state.deleted = []
})

describe('runPurgeOnce — buckets (filet de sécurité)', () => {
    it('deletes old plaintext non-demo blobs, keeps fresh/enc/demo ones', async () => {
        state.db = fakeDb({
            'userDxf.files': [
                blob('old-plain.dxf', OLD),
                blob('fresh.dxf', FRESH),
                blob('old-enc.dxf', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' }),
                blob('old-demo.dxf', OLD, { ownerId: 'demo' }),
            ],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toEqual([['userDxf', 'id:old-plain.dxf']])
        expect(report.blobs).toBe(1)
    })
})

describe('runPurgeOnce — résultats pilotés par les jobs', () => {
    const job = (overrides = {}) => {
        const slug = overrides.slug || 'nested-abc'
        return {
            _id: 'j1',
            slug,
            ownerId: 'u1',
            status: 'done',
            updatedAt: OLD,
            dxf_files: [`${slug}_part_1.dxf`],
            svg_files: [`${slug}_part_1.svg`],
            alternatives: [{ alt_id: 'b', dxf_files: [`${slug}_alt-b_part_1.dxf`], svg_files: [] }],
            ...overrides,
        }
    }

    it('deletes every listed blob (canonical + alternatives) and sets purgedAt', async () => {
        const jobs = [job()]
        state.db = fakeDb({
            nesting_jobs: jobs,
            strip_nesting_job_queue: [],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            'nestDxf.files': [
                blob('nested-abc_part_1.dxf', OLD),
                blob('nested-abc_alt-b_part_1.dxf', OLD),
            ],
            'nestSvg.files': [blob('nested-abc_part_1.svg', OLD)],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toContainEqual(['nestDxf', 'id:nested-abc_part_1.dxf'])
        expect(state.deleted).toContainEqual(['nestDxf', 'id:nested-abc_alt-b_part_1.dxf'])
        expect(state.deleted).toContainEqual(['nestSvg', 'id:nested-abc_part_1.svg'])
        expect(jobs[0].purgedAt).toEqual(NOW)
        expect(report.jobs).toBe(1)
        // Le filet de sécurité ne re-supprime rien (déjà partis) — les docs
        // .files factices restent listés mais le delete est idempotent côté
        // appelant ; ici chaque blob n'a été supprimé qu'une fois par passe.
    })

    it('exempts a vault job entirely (any enc blob) and skips recent jobs', async () => {
        const jobs = [
            job({ _id: 'j-vault', slug: 'nested-vault' }),
            job({ _id: 'j-fresh', slug: 'nested-fresh', updatedAt: FRESH, dxf_files: [], svg_files: [], alternatives: [] }),
        ]
        state.db = fakeDb({
            nesting_jobs: jobs,
            strip_nesting_job_queue: [],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            'nestDxf.files': [blob('nested-vault_part_1.dxf', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' })],
            'nestSvg.files': [blob('nested-vault_part_1.svg', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' })],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toEqual([])
        expect(jobs[0].purgedAt).toBeUndefined()
        expect(jobs[1].purgedAt).toBeUndefined()
        expect(report.jobs).toBe(0)
    })
})

describe('runPurgeOnce — géométrie des docs fichiers', () => {
    it('$unset polygonParts + purgedAt on old plaintext docs only', async () => {
        const files = [
            { _id: 'f1', slug: 'a.dxf', ownerId: 'u1', uploadAt: OLD, polygonParts: [{ id: 0 }] },
            { _id: 'f2', slug: 'b.dxf', ownerId: 'u1', uploadAt: OLD, encPolygonParts: { data: 'x' } },
            { _id: 'f3', slug: 'c.dxf', ownerId: 'demo', uploadAt: OLD, polygonParts: [{ id: 0 }] },
            { _id: 'f4', slug: 'd.dxf', ownerId: 'u1', uploadAt: FRESH, polygonParts: [{ id: 0 }] },
        ]
        state.db = fakeDb({
            user_dxf_files: files,
            strip_user_dxf_files: [],
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(files[0].polygonParts).toBeUndefined()
        expect(files[0].purgedAt).toEqual(NOW)
        expect(files[1].encPolygonParts).toBeDefined()
        expect(files[1].purgedAt).toBeUndefined()
        expect(files[2].polygonParts).toBeDefined() // démo exemptée
        expect(files[3].polygonParts).toBeDefined() // trop récent
        expect(report.fileDocs).toBe(1)
    })
})

describe('runPurgeOnce — artefacts éphémères de jobs', () => {
    it('unsets localPayload/liveLayout on stale jobs (vault included)', async () => {
        const jobs = [
            { _id: 'j1', slug: 's1', ownerId: 'u1', status: 'awaiting_local', updatedAt: OLD, localPayload: { instance: {} } },
            { _id: 'j2', slug: 's2', ownerId: 'u1', status: 'processing', updatedAt: OLD, liveLayout: { sheets: [] } },
            { _id: 'j3', slug: 's3', ownerId: 'u1', status: 'done', updatedAt: FRESH, localPayload: { instance: {} } },
        ]
        state.db = fakeDb({
            nesting_jobs: jobs,
            strip_nesting_job_queue: [],
            user_dxf_files: [],
            strip_user_dxf_files: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].localPayload).toBeUndefined()
        expect(jobs[1].liveLayout).toBeUndefined()
        expect(jobs[2].localPayload).toBeDefined() // trop récent
        expect(report.artifacts).toBe(2)
    })

    it('is idempotent — a second run finds nothing', async () => {
        state.db = fakeDb({
            nesting_jobs: [
                { _id: 'j1', slug: 's1', ownerId: 'u1', status: 'done', updatedAt: OLD, localPayload: {} },
            ],
            strip_nesting_job_queue: [],
            user_dxf_files: [
                { _id: 'f1', slug: 'a.dxf', ownerId: 'u1', uploadAt: OLD, polygonParts: [] },
            ],
        })
        const first = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(first.artifacts + first.fileDocs + first.jobs).toBeGreaterThan(0)
        const second = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(second).toMatchObject({ jobs: 0, blobs: 0, fileDocs: 0, artifacts: 0 })
    })
})
