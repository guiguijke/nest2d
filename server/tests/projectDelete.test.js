import { beforeEach, describe, expect, it, vi } from 'vitest'

// Suppression de projet en cascade (server/features/project/delete.js) :
// db factice en mémoire, buckets GridFS factices qui enregistrent leurs
// deletes (le delete par bucket emporte files+chunks — jamais de delete
// brut sur .files, cf. purge.test.js).
const state = vi.hoisted(() => ({ db: null, buckets: {} }))

vi.mock('../../server/db/mongo', () => ({
    connectDB: async () => state.db,
    getBucket: async (name) => (state.buckets[name] ??= fakeBucket(name, [])),
}))

vi.mock('../../server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { DOMAINS } from '~~/server/core/domains'
import { deleteProjectCascade } from '~~/server/features/project/delete'
import logger from '../../server/utils/logger'
import { fakeDb } from './helpers/fakeMongo'

const blob = (filename, id = `id:${filename}`) => ({ _id: id, filename })

// Bucket GridFS minimal : find par filename (les blobs n'ont pas de
// projectSlug — suppression PAR NOM), delete par _id avec retrait effectif
// (une seconde passe ne trouve plus rien). `failOn` simule un delete GridFS
// en échec (le warn de la cascade ne doit pas interrompre le reste).
function fakeBucket(name, docs = [], { failOn = [] } = {}) {
    const deleted = []
    return {
        name,
        docs,
        deleted,
        find(filter) {
            const matched = docs.filter((d) => d.filename === filter.filename)
            return { toArray: async () => matched }
        },
        async delete(id) {
            if (failOn.includes(id)) throw new Error(`gridfs gone: ${id}`)
            deleted.push(id)
            const i = docs.findIndex((d) => d._id === id)
            if (i !== -1) docs.splice(i, 1)
        },
    }
}

const remaining = async (coll) => state.db.collection(coll).find({}).toArray()

beforeEach(() => {
    vi.clearAllMocks()
    state.db = null
    state.buckets = {}
})

describe('deleteProjectCascade — cascade complète (bin)', () => {
    it('supprime blobs (toutes versions), docs fichiers, jobs et projet', async () => {
        state.db = fakeDb({
            projects: [
                { slug: 'proj-1', name: 'P1', ownerId: 'u1' },
                { slug: 'proj-2', name: 'P2', ownerId: 'u1' },
            ],
            user_dxf_files: [
                { slug: 'f-a.dxf', name: 'a', svgFileSlug: 'prev-a.svg', ownerId: 'u1', projectSlug: 'proj-1' },
                { slug: 'f-b.dxf', name: 'b', svgFileSlug: 'prev-b.svg', ownerId: 'u1', projectSlug: 'proj-1' },
            ],
            nesting_jobs: [
                {
                    slug: 'nested-1',
                    ownerId: 'u1',
                    projectSlug: 'proj-1',
                    status: 'done',
                    dxf_files: ['nested-1_part_1.dxf'],
                    svg_files: ['nested-1_part_1.svg'],
                    alternatives: [
                        { dxf_files: ['nested-1_alt-b_part_1.dxf'], svg_files: ['nested-1_alt-b_part_1.svg'] },
                    ],
                },
            ],
        })
        state.buckets = {
            nestDxf: fakeBucket('nestDxf', [blob('nested-1_part_1.dxf'), blob('nested-1_alt-b_part_1.dxf')]),
            nestSvg: fakeBucket('nestSvg', [blob('nested-1_part_1.svg'), blob('nested-1_alt-b_part_1.svg')]),
            // Deux versions de f-a.dxf : chaque version doit partir.
            userDxf: fakeBucket('userDxf', [
                blob('f-a.dxf', 'id:f-a.dxf#v1'),
                blob('f-a.dxf', 'id:f-a.dxf#v2'),
                blob('f-b.dxf'),
            ]),
            validDxf: fakeBucket('validDxf', [blob('f-a.dxf'), blob('f-b.dxf')]),
            userDxfFilesSvg: fakeBucket('userDxfFilesSvg', [blob('prev-a.svg'), blob('prev-b.svg')]),
        }

        const result = await deleteProjectCascade(DOMAINS.bin, 'u1', 'proj-1')

        expect(result).toEqual({ files: 2, jobs: 1, blobs: 11 })
        // Chaque version de chaque blob, dans le bon bucket.
        expect(state.buckets.nestDxf.deleted).toEqual(['id:nested-1_part_1.dxf', 'id:nested-1_alt-b_part_1.dxf'])
        expect(state.buckets.nestSvg.deleted).toEqual(['id:nested-1_part_1.svg', 'id:nested-1_alt-b_part_1.svg'])
        expect(state.buckets.userDxf.deleted).toEqual(['id:f-a.dxf#v1', 'id:f-a.dxf#v2', 'id:f-b.dxf'])
        expect(state.buckets.validDxf.deleted).toEqual(['id:f-a.dxf', 'id:f-b.dxf'])
        expect(state.buckets.userDxfFilesSvg.deleted).toEqual(['id:prev-a.svg', 'id:prev-b.svg'])
        // Docs effacés, projet voisin intact.
        expect(await remaining('user_dxf_files')).toEqual([])
        expect(await remaining('nesting_jobs')).toEqual([])
        expect(await remaining('projects')).toEqual([expect.objectContaining({ slug: 'proj-2' })])
        // Filtres enregistrés : scopés projet + propriétaire.
        expect(state.db.collection('user_dxf_files').calls.deleteMany).toEqual([{ projectSlug: 'proj-1', ownerId: 'u1' }])
        expect(state.db.collection('nesting_jobs').calls.deleteMany).toEqual([{ projectSlug: 'proj-1', ownerId: 'u1' }])
        expect(state.db.collection('projects').calls.deleteOne).toEqual([{ slug: 'proj-1', ownerId: 'u1' }])
        expect(logger.info).toHaveBeenCalled()
    })
})

describe('deleteProjectCascade — garde-fous', () => {
    it('404 si le projet est inexistant', async () => {
        state.db = fakeDb({ projects: [] })
        await expect(deleteProjectCascade(DOMAINS.bin, 'u1', 'nope')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('404 si le projet appartient à un autre utilisateur (existence jamais révélée)', async () => {
        state.db = fakeDb({ projects: [{ slug: 'proj-1', ownerId: 'u2' }] })
        await expect(deleteProjectCascade(DOMAINS.bin, 'u1', 'proj-1')).rejects.toMatchObject({ statusCode: 404 })
        expect(await remaining('projects')).toHaveLength(1)
        expect(state.db.collection('projects').calls.deleteOne).toEqual([])
    })

    it('403 sur un projet démo possédé, 404 sur la démo partagée', async () => {
        state.db = fakeDb({
            projects: [
                { slug: 'demo-owned', ownerId: 'u1', isDemo: true },
                // La démo partagée a un ownerId technique : pour tout
                // utilisateur elle est « inexistante » (404), jamais 403.
                { slug: 'demo', ownerId: 'demo', isDemo: true },
            ],
        })
        await expect(deleteProjectCascade(DOMAINS.bin, 'u1', 'demo-owned')).rejects.toMatchObject({ statusCode: 403 })
        await expect(deleteProjectCascade(DOMAINS.bin, 'u1', 'demo')).rejects.toMatchObject({ statusCode: 404 })
        expect(await remaining('projects')).toHaveLength(2)
    })

    it.each(['pending', 'processing', 'awaiting_local'])('409 jobs_in_progress avec un job %s', async (status) => {
        state.db = fakeDb({
            projects: [{ slug: 'proj-1', ownerId: 'u1' }],
            nesting_jobs: [{ slug: 'j1', ownerId: 'u1', projectSlug: 'proj-1', status }],
        })
        await expect(deleteProjectCascade(DOMAINS.bin, 'u1', 'proj-1')).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: 'jobs_in_progress',
        })
        // Rien n'a été touché : le projet reste supprimable une fois le
        // calcul terminé.
        expect(await remaining('projects')).toHaveLength(1)
        expect(await remaining('nesting_jobs')).toHaveLength(1)
        expect(state.db.collection('projects').calls.deleteOne).toEqual([])
    })
})

describe('deleteProjectCascade — projet local (J-090)', () => {
    it('zéro blob côté serveur, jobs supprimés', async () => {
        state.db = fakeDb({
            projects: [{ slug: 'loc-1', ownerId: 'u1', local: true }],
            nesting_jobs: [
                { slug: 'j-done', ownerId: 'u1', projectSlug: 'loc-1', status: 'done', dxf_files: [], svg_files: [], alternatives: [] },
                { slug: 'j-failed', ownerId: 'u1', projectSlug: 'loc-1', status: 'failed' },
            ],
        })
        // Aucun bucket seedé : les résolutions auto-vivifiées restent vides.
        const result = await deleteProjectCascade(DOMAINS.bin, 'u1', 'loc-1')
        expect(result).toEqual({ files: 0, jobs: 2, blobs: 0 })
        expect(await remaining('projects')).toEqual([])
        expect(await remaining('nesting_jobs')).toEqual([])
    })
})

describe('deleteProjectCascade — idempotence', () => {
    it('blob manquant ou delete en échec : warn, la cascade continue, rappel = 404', async () => {
        state.db = fakeDb({
            projects: [{ slug: 'proj-1', ownerId: 'u1' }],
            user_dxf_files: [{ slug: 'f-a.dxf', name: 'a', ownerId: 'u1', projectSlug: 'proj-1' }],
            nesting_jobs: [
                // Le job liste un blob résultat absent du bucket : rien à
                // supprimer, aucune erreur.
                { slug: 'j1', ownerId: 'u1', projectSlug: 'proj-1', status: 'done', dxf_files: ['ghost_part_1.dxf'], svg_files: [], alternatives: [] },
            ],
        })
        state.buckets = {
            userDxf: fakeBucket('userDxf', [blob('f-a.dxf')], { failOn: ['id:f-a.dxf'] }),
        }

        const result = await deleteProjectCascade(DOMAINS.bin, 'u1', 'proj-1')
        expect(result).toEqual({ files: 1, jobs: 1, blobs: 0 })
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('f-a.dxf'))
        expect(await remaining('projects')).toEqual([])

        // Rappel sur un projet déjà supprimé : 404, jamais de crash.
        await expect(deleteProjectCascade(DOMAINS.bin, 'u1', 'proj-1')).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('deleteProjectCascade — domaine strip', () => {
    it('résultats dans stripNestDxf, sources dans stripUserDxf, nestDxf (bin) intact', async () => {
        state.db = fakeDb({
            strip_projects: [{ slug: 'sp-1', ownerId: 'u1' }],
            strip_user_dxf_files: [{ slug: 's-a.dxf', name: 'a', svgFileSlug: 's-prev.svg', ownerId: 'u1', stripSlug: 'sp-1' }],
            strip_nesting_job_queue: [
                { slug: 'strip-nested-1', ownerId: 'u1', stripSlug: 'sp-1', status: 'done', dxf_files: ['strip-nested-1_part_1.dxf'], svg_files: ['strip-nested-1_part_1.svg'], alternatives: [] },
            ],
        })
        state.buckets = {
            stripNestDxf: fakeBucket('stripNestDxf', [blob('strip-nested-1_part_1.dxf')]),
            nestSvg: fakeBucket('nestSvg', [blob('strip-nested-1_part_1.svg')]),
            stripUserDxf: fakeBucket('stripUserDxf', [blob('s-a.dxf')]),
            validDxf: fakeBucket('validDxf', [blob('s-a.dxf')]),
            userDxfFilesSvg: fakeBucket('userDxfFilesSvg', [blob('s-prev.svg')]),
            // Un blob du MÊME nom dans le bucket bin ne doit pas partir.
            nestDxf: fakeBucket('nestDxf', [blob('strip-nested-1_part_1.dxf')]),
        }

        const result = await deleteProjectCascade(DOMAINS.strip, 'u1', 'sp-1')

        expect(result).toEqual({ files: 1, jobs: 1, blobs: 5 })
        expect(state.buckets.stripNestDxf.deleted).toEqual(['id:strip-nested-1_part_1.dxf'])
        expect(state.buckets.nestSvg.deleted).toEqual(['id:strip-nested-1_part_1.svg'])
        expect(state.buckets.stripUserDxf.deleted).toEqual(['id:s-a.dxf'])
        expect(state.buckets.validDxf.deleted).toEqual(['id:s-a.dxf'])
        expect(state.buckets.userDxfFilesSvg.deleted).toEqual(['id:s-prev.svg'])
        expect(state.buckets.nestDxf.deleted).toEqual([])
        expect(state.buckets.nestDxf.docs).toHaveLength(1)
        expect(await remaining('strip_projects')).toEqual([])
        expect(await remaining('strip_user_dxf_files')).toEqual([])
        expect(await remaining('strip_nesting_job_queue')).toEqual([])
    })
})
