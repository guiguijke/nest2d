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
/** J-082 : DXF combiné d'une tôle (multi-sources, jumeau de build_part). */
export async function geoExportDxfSheet(slugs, sourcesBytes, spec) {
    const r = await call('export_dxf_sheet', {
        slugs,
        sources: sourcesBytes.map((b) => Array.from(b)),
        json: JSON.stringify(spec),
    })
    return r.ok ? r.result : r
}
export async function geoMemoryPages() {
    const r = await call('memory_pages', {})
    return r.ok ? parseInt(r.result, 10) : 0
}

/**
 * QA (PR3) : calcule côté navigateur les artefacts d'un résultat résolu
 * (SVG coloré par tôle + rapport) via le PONT localBridge (J-082), pour
 * comparaison client/serveur. `payload` = le localPayload enrichi (parts,
 * engineConfig…) rapporté par local-payload. Best-effort : renvoie null si
 * les données manquent (jamais une rupture du flux).
 */
export async function computeClientArtifacts(result, payload) {
    try {
        const { buildAlternativeArtifacts, toServerShapeAlternatives } = await import('./localBridge')
        const arts = await buildAlternativeArtifacts(result, payload)
        if (!arts) return null
        const alts = toServerShapeAlternatives(result, payload, arts)
        if (!alts.length) return null
        // Forme historique attendue par local-result : sheets + report par alt.
        return alts.map((alt, i) => ({
            sheets: alt.svgs || [],
            report: alt.report || null,
            containers: arts[i]?.containers || [],
        }))
    } catch {
        return null
    }
}
