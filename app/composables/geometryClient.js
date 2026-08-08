/**
 * PR4 (flag-gated internal QA — invisible pour l'utilisateur) : pilote le
 * bundle géométrie WASM côté navigateur, en lazy-loading. Rien n'est chargé
 * tant que le flag est OFF ou qu'aucun job local ne démarre. Un seul worker
 * par onglet, réutilisé (le WASM reste chargé — réutilisation gratuite).
 *
 * Le chemin client est un substitut EXACT du chemin serveur : mêmes sorties
 * (verrou déterminisme natif↔wasm tol. 0 + exports_check natif vs Python).
 */
import { isLocalComputeEnabled } from './localCompute'

let worker = null
let seq = 0
const pending = new Map()

function getWorker() {
    if (worker) return worker
    worker = new Worker('/workers/geometry.worker.js', { type: 'module' })
    worker.onmessage = (event) => {
        const { id, ...rest } = event.data || {}
        const settle = pending.get(id)
        if (settle) {
            pending.delete(id)
            settle(rest)
        }
    }
    worker.onerror = (event) => {
        // crash worker = reject propre de toutes les requêtes en attente,
        // pas de crash de page (pattern localCompute.js).
        for (const [, settle] of pending) settle({ ok: false, error: event.message || 'geometry worker error' })
        pending.clear()
        worker?.terminate()
        worker = null
    }
    return worker
}

function call(op, args) {
    if (!isLocalComputeEnabled()) {
        return Promise.resolve({ ok: false, error: 'local compute disabled' })
    }
    return new Promise((resolve) => {
        const id = ++seq
        pending.set(id, resolve)
        getWorker().postMessage({ id, op, ...args })
    })
}

const parse = (r) => (r.ok ? JSON.parse(r.result) : r)

export async function geoImportFile(bytes, tol = 0.01) {
    return parse(await call('import_file', { bytes: Array.from(bytes), tol }))
}
export async function geoImportSvg(bytes, tol = 0.01) {
    return parse(await call('import_svg', { bytes: Array.from(bytes), tol }))
}
export async function geoOpenHoles(outer, holes, spaceMm) {
    return parse(await call('open_holes', { json: JSON.stringify({ outer, holes, space_mm: spaceMm }) }))
}
export async function geoExportSvgSheet(spec) {
    const r = await call('export_svg_sheet', { json: JSON.stringify(spec) })
    return r.ok ? r.result : r
}
export async function geoComputeReport(spec) {
    return parse(await call('compute_report', { json: JSON.stringify(spec) }))
}
export async function geoExportDxf(sourceBytes, spec) {
    const r = await call('export_dxf', { source: Array.from(sourceBytes), json: JSON.stringify(spec) })
    return r.ok ? r.result : r
}
export async function geoMemoryPages() {
    const r = await call('memory_pages', {})
    return r.ok ? parseInt(r.result, 10) : 0
}

/**
 * QA (PR3) : calcule côté navigateur les artefacts d'un résultat résolu
 * (SVG coloré par alternative + rapport), pour comparaison client/serveur.
 * Best-effort : renvoie null si le résultat ne porte pas les données voulues
 * (jamais une rupture du flux). Champs additifs — contrat local-result intact.
 */
export async function computeClientArtifacts(result) {
    try {
        const alternatives = result?.alternatives
        if (!Array.isArray(alternatives) || alternatives.length === 0) return null
        const out = []
        for (const alt of alternatives) {
            const containers = alt.containers || []
            const items = alt.items || {}
            if (!containers.length) continue
            const sheets = []
            for (const c of containers) {
                const svg = await geoExportSvgSheet({
                    transforms: c.transforms || [],
                    items,
                    bin_width: c.bin_width,
                    bin_height: c.bin_height,
                })
                sheets.push(typeof svg === 'string' ? svg : null)
            }
            const report = await geoComputeReport({
                items: Object.values(items),
                containers,
                space: alt.space ?? 0,
            })
            out.push({ sheets, report: report && !report.error ? report : null })
        }
        return out.length ? out : null
    } catch {
        return null
    }
}
