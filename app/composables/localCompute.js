/**
 * Phase 2 (flag-gated internal QA — NOT a privacy feature): drives a local
 * (browser) solve for a job the Python worker prepared. DXF/SVG parsing and
 * the instance building stay SERVER-side; only the SOLVE runs in the
 * browser. Everything here is inert when the flag is off.
 *
 * Flow: fetch the prepared payload -> run the engine Web Worker -> POST the
 * alternatives to local-result (or report failure to local-fail, which
 * refunds the consumed quota — same semantics as worker_common/refund.py).
 */

export function isLocalComputeEnabled() {
    const v = useRuntimeConfig().public.localComputeEnabled
    return v === true || v === 'true'
}

// One engine worker per tab, reused across local jobs (the WASM module
// stays loaded — the spike measured ~1.6 ms compile, the reuse is free).
let engineWorker = null
const pending = new Map()
// J-084 : callbacks de frames live (vue live navigateur), par job.
const liveHandlers = new Map()

function getWorker() {
    if (engineWorker) return engineWorker
    engineWorker = new Worker('/workers/engine.worker.js', { type: 'module' })
    engineWorker.onmessage = (event) => {
        const { jobSlug, live, ...rest } = event.data || {}
        // Frame intermédiaire (J-084) : routée au handler live SANS régler
        // la promesse — le solve n'est pas terminé.
        if (live) {
            liveHandlers.get(jobSlug)?.(live)
            return
        }
        liveHandlers.delete(jobSlug)
        const settle = pending.get(jobSlug)
        if (settle) {
            pending.delete(jobSlug)
            settle(rest)
        }
    }
    engineWorker.onerror = (event) => {
        // A worker-level crash rejects every pending job (no page crash).
        for (const [, settle] of pending) settle({ ok: false, error: event.message || 'worker error' })
        pending.clear()
        liveHandlers.clear()
        engineWorker?.terminate()
        engineWorker = null
    }
    return engineWorker
}

/** Frames de la tôle pour la vue live : SPP = bande unique, BPP = bboxes
 * des bins. LiveNestingView dessine `sheets[0]` et filtre via fitsSheet. */
function liveSheets(payload) {
    const instance = payload?.instance || {}
    if (Array.isArray(instance.bins) && instance.bins.length) {
        return instance.bins.map((b) => {
            let w = 0
            let h = 0
            for (const [x, y] of b?.shape?.data?.outer || []) {
                w = Math.max(w, x)
                h = Math.max(h, y)
            }
            return [w, h]
        })
    }
    return [[
        Number(payload?.engineConfig?.max_strip_width) || 0,
        Number(instance.strip_height) || 0,
    ]]
}

export function runInWorker(jobSlug, payload, { onLive } = {}) {
    return new Promise((resolve) => {
        pending.set(jobSlug, resolve)
        const sheets = liveSheets(payload)
        const isSpp = !Array.isArray(payload?.instance?.bins)
        if (onLive) {
            liveHandlers.set(jobSlug, (evt) => onLive({ ...evt, sheets, isSpp }))
        }
        getWorker().postMessage({
            jobSlug,
            instance: payload.instance,
            engineConfig: payload.engineConfig,
            seed: payload.engineConfig?.prng_seed ?? '0',
            live: Boolean(onLive),
        })
    })
}

/**
 * Runs one prepared job locally end-to-end. Returns { ok, error? }.
 * Idempotence guard: the caller must invoke it once per job slug.
 */
export async function runLocalJob(jobSlug) {
    const payload = await $fetch(`/api/results/${jobSlug}/local-payload`)
    const outcome = await runInWorker(jobSlug, payload)
    if (!outcome.ok) {
        await $fetch(`/api/results/${jobSlug}/local-fail`, {
            method: 'POST',
            body: { error: outcome.error === 'memory_cap' ? 'memory_cap' : String(outcome.error) },
        })
        return { ok: false, error: outcome.error, memory: outcome.memory }
    }
    const body = { alternatives: outcome.result.alternatives }
    // PR4 (QA, flag-gaté) : le navigateur calcule aussi les artefacts
    // (SVG/rapport) via le bundle géométrie, en champs additifs — le contrat
    // local-result reste inchangé (le serveur ignore l'inconnu).
    if (isLocalComputeEnabled()) {
        try {
            const geo = await import('./geometryClient')
            const arts = await geo.computeClientArtifacts(outcome.result, payload)
            if (arts) body.clientArtifacts = arts
        } catch {
            // jamais une rupture du flux de solve
        }
    }
    await $fetch(`/api/results/${jobSlug}/local-result`, { method: 'POST', body })
    return { ok: true }
}
