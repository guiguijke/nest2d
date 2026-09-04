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
 *   `projectSlug` is immutable once set — a page B subscribe must not steal
 *   a job that belongs to A (live leak on navigation).
 * - `progressFor(projectSlug)` : progression réactive du projet (frame live,
 *   compteur, phase zones) — continue de vivre même page démontée.
 * - `cancelJob(slug)` : POST /cancel + cancelPool PRÉFIXE (zones comprises).
 *
 * Le runner est injectable pour les tests (défaut : runLocalJobPrivate).
 */
import { reactive, readonly } from 'vue'
import { frameIsBetter } from '../utils/liveJob'

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

/** Meilleure frame live — définition partagée avec LiveNestingView
 * (utils/liveJob.js, R-6 audit 2026-08-31) : fenêtre de corridor phase 2
 * SPP, remnant/bins en BPP, fraîcheur à égalité parfaite en BPP. L'ancien
 * filtre en égalité stricte court-circuitait la vue et refigeait le live
 * (« 1 maj et c'est tout », régression du fix B.4). */
function liveFrameBetter(a, b) {
    return frameIsBetter(a, b)
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
                // Keep the BEST feasible snapshot, not the last walk's
                // working state (a worse live frame used to replace the
                // compact −X champion and unmount LiveNestingView).
                if (!j.frame || liveFrameBetter(evt, j.frame)) j.frame = evt
            },
        })
        job.result = res || null
        job.ok = !!res?.ok
        job.error = res?.ok ? null : (res?.error || 'crash')
        // Z1 (vérif 2026-09-05) : le payload unfit (leviers du refus
        // capacité / partiel) remonte à la page — scalaires légers, gardés
        // après l'éviction des champs lourds.
        job.unfit = res?.ok ? null : (res?.unfit || null)
        job.phase = res?.ok ? 'done' : (res?.error === 'cancelled' ? 'cancelled' : 'error')
    } catch (e) {
        job.ok = false
        job.error = 'crash'
        job.phase = 'error'
    } finally {
        job.finishedAt = Date.now()
        state.running -= 1
        scheduleEviction(jobSlug)
        pump()
    }
}

// R-8 (audit 2026-08-31 §R-7) : le résultat complet vit dans IndexedDB
// (localResultsStore) — le registre ne retenait par ailleurs JAMAIS rien :
// chaque job done gardait alternatives (SVG + DXF texte, plusieurs Mo) et
// frame en RAM pour toute la session. Après un délai de grâce (le modal lit
// result/liveLayout juste après done), on ne conserve que les scalaires
// (statut de liste, badge projet, message d'erreur).
const HEAVY_RETAIN_MS = 120_000
function scheduleEviction(jobSlug) {
    setTimeout(() => {
        const j = state.jobs[jobSlug]
        if (!j) return
        if (j.phase === 'done' || j.phase === 'error' || j.phase === 'cancelled') {
            j.result = null
            j.frame = null
            j.itemMap = null
            j.zone = null
        }
    }, HEAVY_RETAIN_MS)
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
        return readonly(existing)
    }
    // Re-file d'un job terminé en ERREUR (R-5, audit 2026-08-31 §R-5) : sans
    // reset de phase, l'entrée restait hors du garde ci-dessus → chaque
    // ensureJob la re-pushait → DOUBLE run du même slug (2× local-payload,
    // pool écrasé par pools.set). Un job 'cancelled' reste terminal : le
    // serveur l'a déjà finalisé + refundé, on ne le relance jamais.
    if (existing) {
        existing.phase = 'queued'
        existing.result = null
        existing.frame = null
        existing.evals = null
        existing.zone = null
        existing.error = null
        existing.unfit = null
        existing.ok = null
        existing.finishedAt = null
        existing.startedAt = Date.now()
        existing.itemMap = job?.itemMap || existing.itemMap
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

const ACTIVE_PHASES = new Set(['queued', 'running'])

/** True while this project has a local solve queued or running. */
export function hasActiveJob(projectSlug) {
    if (!projectSlug) return false
    return Object.values(state.jobs).some(
        (j) => j.projectSlug === projectSlug && ACTIVE_PHASES.has(j.phase),
    )
}

/** Active local solves (for the project-list badge). */
export function activeJobs() {
    return Object.values(state.jobs)
        .filter((j) => ACTIVE_PHASES.has(j.phase))
        .map((j) => readonly(j))
}

export function solverState() {
    return readonly(state)
}
