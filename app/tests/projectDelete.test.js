import { beforeEach, describe, expect, it, vi } from 'vitest'

// Suppression d'un projet depuis la liste (home + aside) :
//  - DELETE /api/project/[slug] au bon slug, retrait de la liste partagée
//  - purge IndexedDB (J-090) SEULEMENT si project.local, jamais avant le 200
//  - 409 jobs_in_progress → clé d'erreur dédiée, aucune purge
//  - projet démo → jamais supprimable (le bouton est masqué côté composant)
//  - suppression du projet en cours de consultation → navigateTo('/home')
//
// Pas de harness DOM côté app (vitest environment 'node', pas de
// @vue/test-utils) : la logique vit dans composables/projects.js et le
// composant reste fin. $fetch / navigateTo sont des globales Nuxt auto-
// importées au build — mockées ici sur globalThis. Même pattern de mock par
// chemin relatif que localImport.test.js.
const state = vi.hoisted(() => ({
    purgedFiles: [],
    purgedResults: [],
}))

vi.mock('../composables/localFilesStore', () => ({
    purgeProjectFiles: vi.fn(async (slug) => {
        state.purgedFiles.push(slug)
    }),
}))

vi.mock('../composables/localResultsStore', () => ({
    purgeProject: vi.fn(async (slug) => {
        state.purgedResults.push(slug)
    }),
}))

import { globalStore } from '../composables/index'
import {
    canDeleteProject,
    deleteConfirmMessageKey,
    deleteProject,
} from '../composables/projects'

const cloudProject = { slug: 'alpha', name: 'Alpha' }
const localProject = { slug: 'beta', name: 'Beta', local: true }
const demoProject = { slug: 'demo', name: 'Demo', isDemo: true }

function projectSlugs() {
    // readonly() unwrap les refs : le getter rend directement le tableau.
    return (globalStore.getters.projectsList || []).map((p) => p.slug)
}

beforeEach(() => {
    state.purgedFiles = []
    state.purgedResults = []
    globalThis.$fetch = vi.fn(async () => ({ ok: true, deleted: 1 }))
    globalThis.navigateTo = vi.fn(async () => {})
    globalStore.actions.setProjects([cloudProject, localProject, demoProject])
})

describe('deleteProject', () => {
    it('calls DELETE on the project route and removes it from the shared list', async () => {
        const result = await deleteProject(cloudProject, {})

        expect(result).toEqual({ ok: true })
        expect(globalThis.$fetch).toHaveBeenCalledTimes(1)
        expect(globalThis.$fetch).toHaveBeenCalledWith('/api/project/alpha', { method: 'DELETE' })
        expect(projectSlugs()).toEqual(['beta', 'demo'])
    })

    it('does not purge IndexedDB for a cloud project', async () => {
        await deleteProject(cloudProject, {})

        expect(state.purgedFiles).toEqual([])
        expect(state.purgedResults).toEqual([])
    })

    it('purges IndexedDB for a 100% private project (J-090), after the 200', async () => {
        const result = await deleteProject(localProject, {})

        expect(result).toEqual({ ok: true })
        expect(globalThis.$fetch).toHaveBeenCalledWith('/api/project/beta', { method: 'DELETE' })
        expect(state.purgedFiles).toEqual(['beta'])
        expect(state.purgedResults).toEqual(['beta'])
        expect(projectSlugs()).toEqual(['alpha', 'demo'])
    })

    it('409 jobs_in_progress → dedicated error key, no purge, list untouched', async () => {
        globalThis.$fetch = vi.fn(async () => {
            // eslint-disable-next-line no-throw-literal
            throw { data: { statusMessage: 'jobs_in_progress' } }
        })

        const result = await deleteProject(localProject, {})

        expect(result).toEqual({ ok: false, errorKey: 'project.deleteErrorActive' })
        expect(state.purgedFiles).toEqual([])
        expect(state.purgedResults).toEqual([])
        expect(projectSlugs()).toEqual(['alpha', 'beta', 'demo'])
        expect(globalThis.navigateTo).not.toHaveBeenCalled()
    })

    it('any other failure → generic error key, list untouched', async () => {
        globalThis.$fetch = vi.fn(async () => {
            throw new Error('network down')
        })

        const result = await deleteProject(cloudProject, {})

        expect(result).toEqual({ ok: false, errorKey: 'project.deleteError' })
        expect(projectSlugs()).toEqual(['alpha', 'beta', 'demo'])
    })

    it('navigates to /home when the deleted project is the one being viewed', async () => {
        await deleteProject(cloudProject, { currentSlug: 'alpha' })

        expect(globalThis.navigateTo).toHaveBeenCalledWith('/home')
    })

    it('stays put when deleting another project than the one viewed', async () => {
        await deleteProject(cloudProject, { currentSlug: 'beta' })

        expect(globalThis.navigateTo).not.toHaveBeenCalled()
    })

    it('stays put when deleting from a list (no current slug)', async () => {
        await deleteProject(cloudProject, {})

        expect(globalThis.navigateTo).not.toHaveBeenCalled()
    })
})

describe('canDeleteProject', () => {
    it('hides the delete button for the shared demo project (403 server-side)', () => {
        expect(canDeleteProject(demoProject)).toBe(false)
        expect(canDeleteProject(cloudProject)).toBe(true)
        expect(canDeleteProject(localProject)).toBe(true)
        expect(canDeleteProject(null)).toBe(false)
    })
})

describe('deleteConfirmMessageKey', () => {
    it('warns about browser storage only for 100% private projects', () => {
        expect(deleteConfirmMessageKey(cloudProject)).toBe('project.deleteConfirmCloud')
        expect(deleteConfirmMessageKey(localProject)).toBe('project.deleteConfirmLocal')
    })
})
