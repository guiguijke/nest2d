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

function getWorker() {
    if (engineWorker) return engineWorker
    engineWorker = new Worker('/workers/engine.worker.js', { type: 'module' })
    engineWorker.onmessage = (event) => {
        const { jobSlug, ...rest } = event.data || {}
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
        engineWorker?.terminate()
        engineWorker = null
    }
    return engineWorker
}

function runInWorker(jobSlug, payload) {
    return new Promise((resolve) => {
        pending.set(jobSlug, resolve)
        getWorker().postMessage({
            jobSlug,
            instance: payload.instance,
            engineConfig: payload.engineConfig,
            seed: payload.engineConfig?.prng_seed ?? '0',
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
    await $fetch(`/api/results/${jobSlug}/local-result`, {
        method: 'POST',
        body: { alternatives: outcome.result.alternatives },
    })
    return { ok: true }
}
