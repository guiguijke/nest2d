/**
 * Phase 2 (flag-gated QA): runs the nesting WASM engine OFF the main thread.
 * Protocol (JSON messages):
 *   in : { instance, engineConfig, seed, live? }  (engine payload from server)
 *   out: { ok: true, result, memory } | { ok: false, error, memory }
 *        + frames intermédiaires (J-084, vue live) : { live: <event> }
 *   in : { id, op: 'merge', merge } (J-093, pool multi-walks) — fusion des
 *        alternatives de N walks par le moteur lui-même (export wasm
 *        merge_alternatives ; AUCUN rang n'est recalculé en JS).
 *   out: { id, ok: true, result: <string JSON brute> } — le parse est côté
 *        appelant — | { id, ok: false, error }
 * Sans `op`, le comportement est strictement celui d'origine (runInWorker).
 * The module is loaded once and reused across jobs.
 */
import init, { run_nesting, run_nesting_live, wasm_memory_pages } from '/engine/nest_wasm.js'

let ready = null

// Soft guardrail (spike: 35 MB on the big jobs; Chrome caps ~2-4 GB).
// 1 GB matches the spike's NO-GO threshold — beyond that we bail cleanly.
const MEMORY_CAP_PAGES = (1024 * 1024 * 1024) / 65536

self.onmessage = async (event) => {
    const { id, jobSlug, op, merge, instance, engineConfig, seed, live } = event.data || {}
    // J-093 : fusion des alternatives du pool de walks. Import dynamique
    // volontaire : un bundle wasm antérieur à J-093 ne déclare pas l'export
    // — un import statique casserait le LINK du module et donc le chemin de
    // solve existant ; ici l'absence devient une erreur propre côté appelant.
    if (op === 'merge') {
        try {
            ready = ready || init()
            await ready
            const mod = await import('/engine/nest_wasm.js')
            if (typeof mod.merge_alternatives !== 'function') {
                self.postMessage({ id, jobSlug, ok: false, error: 'merge_alternatives_unavailable' })
                return
            }
            const merged = mod.merge_alternatives(JSON.stringify(merge || {}))
            self.postMessage({ id, jobSlug, ok: true, result: merged })
        } catch (err) {
            self.postMessage({ id, jobSlug, ok: false, error: String(err && err.message ? err.message : err) })
        }
        return
    }
    try {
        ready = ready || init()
        await ready
        const pagesBefore = wasm_memory_pages()
        const result = live
            // J-084 : le moteur route ses événements (progress/layout/evals,
            // ~2 Hz côté Rust) vers le thread principal — la page anime la
            // vue live pendant le solve. postMessage est asynchrone : le
            // solve (bloquant) n'attend jamais l'UI.
            ? run_nesting_live(
                JSON.stringify(instance),
                JSON.stringify(engineConfig),
                BigInt(seed),
                (line) => {
                    try {
                        const evt = JSON.parse(line)
                        if (evt.type === 'layout') {
                            // Snapshots de placements pour la vue live.
                            self.postMessage({ jobSlug, live: evt })
                        } else if (evt.type === 'evals' || evt.type === 'heartbeat') {
                            // Compteur de combinaisons (SPP: evals, BPP:
                            // iterations SA, normalisé en `n`) — le pool
                            // banque par walk et somme (piège #10).
                            self.postMessage({ jobSlug, evals: { n: evt.evals ?? evt.iterations ?? 0 } })
                        }
                    } catch {
                        // événement non-JSON : ignoré, jamais une rupture
                    }
                },
              )
            : run_nesting(JSON.stringify(instance), JSON.stringify(engineConfig), BigInt(seed))
        const pagesAfter = wasm_memory_pages()
        if (pagesAfter > MEMORY_CAP_PAGES) {
            self.postMessage({ ok: false, jobSlug, error: 'memory_cap', memory: { pagesBefore, pagesAfter } })
            return
        }
        self.postMessage({ ok: true, jobSlug, result: JSON.parse(result), memory: { pagesBefore, pagesAfter } })
    } catch (err) {
        self.postMessage({ ok: false, jobSlug, error: String(err && err.message ? err.message : err) })
    }
}
