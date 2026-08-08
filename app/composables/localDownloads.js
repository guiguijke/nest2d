/**
 * PR5 (Phase 5, J-082) : téléchargements 100 % navigateur depuis le record
 * IndexedDB — contenus PERSISTÉS au solve (aucune régénération, aucun
 * réseau : relecture et téléchargements hors-ligne). Parité des noms avec le
 * chemin serveur : DXF `{slug}_alt{r}_part_{n}.dxf`, ZIP `nesting-{slug}.zip`
 * contenant les DXF de la meilleure alternative (comme la route zip serveur).
 */
import { zipSync, strToU8 } from 'fflate'

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

/** SVG coloré d'une tôle d'une alternative du record. */
export function downloadLocalSvg(record, altId = 0, sheetIndex = 0, filename = null) {
    const alt = (record?.alternatives || [])[altId]
    const svg = alt?.svgs?.[sheetIndex]
    if (typeof svg !== 'string') throw new Error('svg_unavailable')
    download(text(svg, 'image/svg+xml'),
        filename || `${record.slug}_alt${altId}_part_${sheetIndex + 1}.svg`)
}

/** DXF combiné d'une tôle d'une alternative du record. */
export function downloadLocalDxf(record, altId = 0, sheetIndex = 0) {
    const alt = (record?.alternatives || [])[altId]
    const dxf = alt?.dxfs?.[sheetIndex]
    if (!dxf?.content) throw new Error('dxf_unavailable')
    download(text(dxf.content, 'image/vnd.dxf'), dxf.fileName || `${record.slug}.dxf`)
}

/** ZIP de la meilleure alternative (DXF combinés par tôle) — mêmes fichiers
 * et même nom d'archive que la route zip serveur (dxf_files de la best). */
export function downloadLocalZip(record, filename = null) {
    const best = (record?.alternatives || [])[0]
    const files = {}
    for (const dxf of best?.dxfs || []) {
        if (dxf?.content) files[dxf.fileName] = dxf.content
    }
    if (!Object.keys(files).length) throw new Error('zip_empty')
    const data = {}
    for (const [name, content] of Object.entries(files)) {
        data[name] = strToU8(content)
    }
    const zipped = zipSync(data, { level: 6 })
    download(new Blob([zipped], { type: 'application/zip' }),
        filename || `nesting-${record.slug}.zip`)
}

/** Téléchargement principal (bouton carte/modal) : DXF seul en mono-tôle,
 * ZIP en multi-tôles — même comportement que les boutons serveur. */
export function downloadLocalResult(record, altId = 0) {
    const alt = (record?.alternatives || [])[altId]
    if (!alt) throw new Error('result_unavailable')
    if ((alt.layoutCount ?? (alt.dxfs?.length || 0)) > 1) {
        downloadLocalZip(record)
    } else {
        downloadLocalDxf(record, altId, 0)
    }
}
