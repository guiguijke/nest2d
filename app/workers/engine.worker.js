/**
 * Phase 2 (flag-gated QA): runs the nesting WASM engine OFF the main thread.
 * Protocol (JSON messages):
 *   in : { instance, engineConfig, seed }  (engine payload from the server)
 *   out: { ok: true, result } | { ok: false, error, memory }
 * The module is loaded once and reused across jobs.
 */
import init, { run_nesting, wasm_memory_pages } from '/engine/nest_wasm.js'

let ready = null

// Soft guardrail (spike: 35 MB on the big jobs; Chrome caps ~2-4 GB).
// 1 GB matches the spike's NO-GO threshold — beyond that we bail cleanly.
const MEMORY_CAP_PAGES = (1024 * 1024 * 1024) / 65536

self.onmessage = async (event) => {
    const { jobSlug, instance, engineConfig, seed } = event.data || {}
    try {
        ready = ready || init()
        await ready
        const pagesBefore = wasm_memory_pages()
        const result = run_nesting(JSON.stringify(instance), JSON.stringify(engineConfig), BigInt(seed))
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
