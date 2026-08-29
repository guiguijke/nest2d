/**
 * Registre GLOBAL des solves locaux (mode THIS DEVICE) — singleton au niveau
 * app, propriétaire de tous les jobs en vol. Pourquoi un singleton et pas la
 * page projet : naviguer entre projets ne doit JAMAIS casser ni relancer un
 * calcul (constat user 2026-08-28 : « changer de projet → bug complet ») —
 * même leçon que le piège #30 (watch hors composant). La page s'abonne, ne
 * possède plus rien :
 *
 * - `ensureJob(job, { projectSlug, maxConcurrent })` : idempotent (refresh /
 *   re-navigation = no-op), file d'attente plafonnée (gratuit 1, Pro
 *   plusieurs — le cap vient du TIER côté serveur, jamais deviné ici).
 * - `progressFor(projectSlug)` : progression réactive du projet (frame live,
 *   compteur, phase zones) — continue de vivre même page démontée.
 * - `cancelJob(slug)` : POST /cancel + cancelPool PRÉFIXE (zones comprises).
 *
 * Le runner est injectable pour les tests (défaut : runLocalJobPrivate).
 */
import { reactive, readonly } from 'vue'

const state = reactive({
    /** slug -> { slug, projectSlug, phase, frame, evals, zone, walks,
     * startedAt, finishedAt, ok, error } */
    jobs: {},
    queue: [],
    running: 0,
    maxConcurrent: 1,
})

let runner = null
let canceller = null

/** Injection pour les tests ; en prod les vrais modules. */
export function configureSolver({ run, cancel } = {}) {
    if (run) runner = run
    if (cancel) canceller = cancel
}

async function realRunner(jobSlug, opts) {
    const { runLocalJobPrivate } = await import('./localJobPrivate')
    return runLocalJobPrivate(jobSlug, opts)
}

async function realCanceller(jobSlug) {
    const { cancelPool } = await import('./localPool')
    await $fetch(`/api/results/${jobSlug}/cancel`, { method: 'POST' }).catch(() => {})
    cancelPool(jobSlug)
}

function entry(jobSlug, projectSlug, itemMap) {
    if (!state.jobs[jobSlug]) {
        state.jobs[jobSlug] = {
            slug: jobSlug,
            projectSlug: projectSlug || null,
            itemMap: itemMap || null,
            result: null,
            phase: 'queued',
            frame: null,
            evals: null,
            zone: null,
            walks: 1,
            startedAt: Date.now(),
            finishedAt: null,
            ok: null,
            error: null,
        }
    }
    return state.jobs[jobSlug]
}

function pump() {
    while (state.running < Math.max(1, state.maxConcurrent) && state.queue.length) {
        const { jobSlug, projectSlug, itemMap } = state.queue.shift()
        // le job a pu être annulé pendant qu'il attendait
        if (state.jobs[jobSlug]?.phase === 'cancelled') continue
        launch(jobSlug, projectSlug, itemMap)
    }
}

async function launch(jobSlug, projectSlug, itemMap) {
    const job = state.jobs[jobSlug]
    if (!job || job.phase === 'cancelled') return
    job.phase = 'running'
    state.running += 1
    try {
        const run = runner || realRunner
        const res = await run(jobSlug, {
            projectSlug,
            onLive: (evt) => {
                const j = state.jobs[jobSlug]
                if (!j) return
                if (evt.type === 'evals') { j.evals = evt.evals; return }
                if (evt.type === 'zone') { j.zone = evt; return }
                if (evt.walks) j.walks = evt.walks
                if (evt.itemMap) j.itemMap = evt.itemMap
                j.frame = evt
            },
        })
        job.result = res || null
        job.ok = !!res?.ok
        job.error = res?.ok ? null : (res?.error || 'crash')
        job.phase = res?.ok ? 'done' : (res?.error === 'cancelled' ? 'cancelled' : 'error')
    } catch (e) {
        job.ok = false
        job.error = 'crash'
        job.phase = 'error'
    } finally {
        job.finishedAt = Date.now()
        state.running -= 1
        pump()
    }
}

/**
 * Déclare/qu'un job doit être résolu localement. Idempotent : un job déjà
 * running/queued/done n'est PAS relancé (refresh, re-navigation). Le cap de
 * parallélisme (tier) vient de l'appelant qui lit le profil serveur.
 */
export function ensureJob(job, { projectSlug = null, maxConcurrent = 1 } = {}) {
    state.maxConcurrent = Math.max(1, Math.trunc(Number(maxConcurrent)) || 1)
    const jobSlug = job?.slug
    if (!jobSlug) return null
    const existing = state.jobs[jobSlug]
    if (existing && ['queued', 'running', 'done'].includes(existing.phase)) {
        existing.projectSlug = projectSlug || existing.projectSlug
        return readonly(existing)
    }
    entry(jobSlug, projectSlug, job?.itemMap)
    state.queue.push({ jobSlug, projectSlug, itemMap: job?.itemMap })
    pump()
    return readonly(state.jobs[jobSlug])
}

/** Annule un job (serveur + pools préfixe zones) et le retire de la file. */
export async function cancelJob(jobSlug) {
    const job = state.jobs[jobSlug]
    if (job && job.phase !== 'done' && job.phase !== 'cancelled') {
        job.phase = 'cancelled'
    }
    state.queue = state.queue.filter((q) => q.jobSlug !== jobSlug)
    const cancel = canceller || realCanceller
    await cancel(jobSlug)
}

/** Progression réactive du projet courant (dernier job par date). */
export function progressFor(projectSlug) {
    const jobs = Object.values(state.jobs).filter(
        (j) => j.projectSlug === projectSlug)
    if (!jobs.length) return null
    jobs.sort((a, b) => b.startedAt - a.startedAt)
    return readonly(jobs[0])
}

export function solverState() {
    return readonly(state)
}
