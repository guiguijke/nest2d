/**
 * PR5 (Phase 5) : téléchargements 100 % navigateur — DXF (geoExportDxf),
 * SVG tôle (geoExportSvgSheet), rapport, et ZIP (fflate) — AUCUN passage
 * serveur. Matérialise le claim « la géométrie ne quitte pas le navigateur ».
 * Les artefacts produits sont identiques au chemin serveur (diff CI PR4).
 */
import { zipSync, strToU8 } from 'fflate'
import { geoExportDxf, geoExportSvgSheet, geoComputeReport } from './geometryClient'

function download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const text = (s, type = 'text/plain') => new Blob([s], { type })

/** Construit les artefacts d'une alternative résolue, côté navigateur. */
export async function buildArtifacts(result, sources = {}) {
    const alternatives = result?.alternatives || []
    const out = []
    for (const alt of alternatives) {
        const containers = alt.containers || []
        const items = alt.items || {}
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
    return out
}

/** Télécharge le DXF d'une source (bytes en mémoire), sans serveur. */
export async function downloadDxf(sourceBytes, spec, filename = 'nestorcut.dxf') {
    const dxf = await geoExportDxf(sourceBytes, spec)
    if (typeof dxf !== 'string') throw new Error(dxf?.error || 'dxf_failed')
    download(text(dxf, 'image/vnd.dxf'), filename)
}

/** Télécharge le SVG coloré d'une alternative, sans serveur. */
export async function downloadSvg(spec, filename = 'nestorcut-sheet.svg') {
    const svg = await geoExportSvgSheet(spec)
    if (typeof svg !== 'string') throw new Error(svg?.error || 'svg_failed')
    download(text(svg, 'image/svg+xml'), filename)
}

/** ZIP (fflate, store/deflate) des artefacts, généré et téléchargé en local. */
export function downloadZip(files, filename = 'nestorcut-results.zip') {
    const data = {}
    for (const [name, content] of Object.entries(files)) {
        if (content != null) data[name] = strToU8(content)
    }
    const zipped = zipSync(data, { level: 6 })
    download(new Blob([zipped], { type: 'application/zip' }), filename)
}
