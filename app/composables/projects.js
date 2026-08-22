/**
 * Suppression d'un projet depuis la liste (home + aside).
 *
 * Logique extraite de UserProjectItem.vue pour rester testable en
 * environnement node (pas de harness DOM côté app — vitest.config.js,
 * environment 'node'). Le composant reste fin : bouton + dialogue +
 * affichage d'erreur.
 *
 * Contrat backend : DELETE /api/project/[slug]
 *   200 { ok, deleted } · 404 inconnu / pas à soi · 403 démo ·
 *   409 statusMessage 'jobs_in_progress' (un calcul tourne).
 *
 * J-090 : un projet « 100 % privé » (local === true) a ses fichiers et
 * résultats en IndexedDB — purge navigateur APRÈS le 200 serveur, sinon
 * des orphelins resteraient sur le poste (et un échec serveur ne doit
 * jamais détruire les données locales).
 *
 * Imports dynamiques RELATIFS ('./localFilesStore') : la convention des
 * composables app (cf. localImport.js → './geometryClient') — l'alias '~'
 * pointe sur la racine du repo côté vitest mais sur app/ côté Nuxt, seuls
 * les chemins relatifs résolvent dans les deux mondes (et vi.mock par
 * chemin relatif intercepte le même module).
 */
import { unref } from 'vue'
import { API_ROUTES } from './apiRoutes'
import { globalStore } from './index'
import { titleFromFileName } from '../utils/projectTitle'

/**
 * Overlay IndexedDB filenames onto local projects so the sidebar/home show
 * the first file's name WITHOUT sending it to the server.
 */
export async function overlayLocalProjectTitles(projects) {
    if (!Array.isArray(projects) || !projects.some((p) => p?.local)) return projects
    try {
        const { listLocalFiles } = await import('./localFilesStore')
        const files = await listLocalFiles()
        const firstByProject = new Map()
        for (const rec of files) {
            if (!firstByProject.has(rec.projectSlug)) firstByProject.set(rec.projectSlug, rec.name)
        }
        return projects.map((p) => {
            if (!p?.local) return p
            const fromFile = titleFromFileName(firstByProject.get(p.slug))
            return fromFile ? { ...p, name: fromFile } : p
        })
    } catch {
        return projects
    }
}

/** Le projet démo partagé n'est jamais supprimable (403 côté serveur). */
export function canDeleteProject(project) {
    return Boolean(project) && !project.isDemo
}

/**
 * Clé i18n du message de confirmation : cloud (fichiers/résultats/rapports
 * serveur) vs 100 % privé (aussi le stockage de ce navigateur, J-090).
 */
export function deleteConfirmMessageKey(project) {
    return project?.local ? 'project.deleteConfirmLocal' : 'project.deleteConfirmCloud'
}

/** Retire le projet de la liste partagée (home + aside restent en synchro). */
export function removeProjectFromStore(slug) {
    const list = unref(globalStore.getters.projectsList)
    if (!Array.isArray(list)) return
    globalStore.actions.setProjects(list.filter((item) => item.slug !== slug))
}

/**
 * Supprime le projet côté serveur, purge le stockage navigateur si projet
 * local, retire l'entrée de la liste et quitte la page si on est dessus.
 *
 * @param {object} project — { slug, local?, isDemo? }
 * @param {{ currentSlug?: string }} options — slug de la page projet
 *   éventuellement affichée (route.params.slug), pour le navigateTo('/home').
 * @returns {Promise<{ ok: true } | { ok: false, errorKey: string }>}
 *   errorKey = 'project.deleteErrorActive' (409, un calcul tourne) ou
 *   'project.deleteError' (tout autre échec) — à traduire par t(errorKey).
 */
export async function deleteProject(project, { currentSlug } = {}) {
    try {
        await $fetch(API_ROUTES.PROJECT(project.slug), { method: 'DELETE' })
    } catch (err) {
        const code = err?.data?.statusMessage
        return {
            ok: false,
            errorKey: code === 'jobs_in_progress'
                ? 'project.deleteErrorActive'
                : 'project.deleteError',
        }
    }

    // J-090 — purge IndexedDB après le 200 uniquement.
    if (project.local) {
        const { purgeProjectFiles } = await import('./localFilesStore')
        const { purgeProject } = await import('./localResultsStore')
        await purgeProjectFiles(project.slug)
        await purgeProject(project.slug)
    }

    removeProjectFromStore(project.slug)

    // Supprimé alors qu'on consulte la page du projet → retour dashboard.
    if (currentSlug && currentSlug === project.slug) {
        await navigateTo('/home')
    }

    return { ok: true }
}
