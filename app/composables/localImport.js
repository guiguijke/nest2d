/**
 * J-090 — import 100 % navigateur des fichiers d'un projet « 100 % privé ».
 *
 * Le fichier est lu en mémoire, parsé par le bundle géométrie WASM (parité
 * golden avec le pipeline serveur, verrou CI), puis stocké dans IndexedDB :
 * géométrie (parts + handles), bytes DXF canoniques mm (l'export DXF copie
 * les entités par handle depuis ces bytes) et un aperçu SVG (data URI).
 * AUCUN byte ne quitte la machine — DWG refusé (conversion serveur, D-PRV-2).
 */
import { geoImportFile, geoCanonicalDxf } from './geometryClient'
import { makeLocalFileSlug } from './localFilesStore'
import { MAX_UPLOAD_FILE_BYTES } from '~~/shared/constants/upload.constants'

// Miroir EXACT de workers/common/worker_common/colors.py — ne pas diverger
// (le rendu liste/live/résultat partage cette palette).
const PART_PALETTE = [
    '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777',
    '#0D9488', '#EA580C', '#4F46E5', '#65A30D', '#0891B2', '#BE185D',
    '#16A34A', '#9333EA', '#0284C7', '#C026D3', '#CA8A04', '#E11D48',
    '#0F766E', '#9F1239', '#3F6212', '#1D4ED8', '#B45309', '#6D28D9',
]
const FILL_OPACITY_PREVIEW = 0.18

// Miroir du fileprocessing (MAX_ENTITY_LIMIT, défaut 999) — au-delà, le
// fichier est refusé côté client comme il le serait côté serveur.
const MAX_ENTITY_LIMIT = 999

const ACCEPTED_EXTENSIONS = ['.dxf', '.svg']

/** pick_colors Python : sac mélangé par cycles — des pièces d'un même
 * fichier ont des couleurs distinctes. crypto RNG (jamais Math.random). */
function pickColors(count) {
    const out = []
    while (out.length < count) {
        const bag = [...PART_PALETTE]
        for (let i = bag.length - 1; i > 0; i--) {
            const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
            ;[bag[i], bag[j]] = [bag[j], bag[i]]
        }
        out.push(...bag)
    }
    return out.slice(0, count)
}

/** Aperçu SVG (data URI) des pièces d'un fichier : rangée horizontale,
 * chaque pièce normalisée à son bbox. Coords moteur y-up → SVG y-down :
 * flip vertical obligatoire (piège #20b). */
function buildPreviewSvg(parts) {
    const GAP_RATIO = 0.08
    const entries = parts.map((p) => {
        const xs = p.coordinates.map((c) => c[0])
        const ys = p.coordinates.map((c) => c[1])
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs)
        const maxY = Math.max(...ys)
        return { p, minX, minY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) }
    })
    const maxH = Math.max(1e-6, ...entries.map((e) => e.h))
    const gap = maxH * GAP_RATIO
    const totalW = entries.reduce((acc, e) => acc + e.w, 0) + gap * Math.max(0, entries.length - 1)

    let cursor = 0
    const paths = []
    for (const e of entries) {
        const ty = (maxH - e.h) / 2 // centrage vertical dans la rangée
        const ringToD = (ring) =>
            ring
                .map((c, i) => {
                    const x = cursor + (c[0] - e.minX)
                    const y = ty + (e.h - (c[1] - e.minY)) // flip y
                    return `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`
                })
                .join('') + 'Z'
        const d = [e.p.coordinates, ...(e.p.holes || [])].map(ringToD).join(' ')
        paths.push(
            `<path d="${d}" fill="${e.p.color}" fill-opacity="${FILL_OPACITY_PREVIEW}" fill-rule="evenodd" stroke="${e.p.color}" stroke-width="${(maxH / 200).toFixed(3)}"/>`,
        )
        cursor += e.w + gap
    }
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(3)} ${maxH.toFixed(3)}">` +
        paths.join('') +
        '</svg>'
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Importe UN File (DXF/SVG) d'un projet local : parse wasm → couleurs →
 * bytes canoniques → preview → IndexedDB. Renvoie le record stocké.
 * Lève des Error à clé i18n (localImport.*) pour l'UI.
 */
export async function importLocalFile(file, projectSlug) {
    const name = file.name || 'part.dxf'
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    if (ext === '.dwg') {
        throw new Error('localImport.dwgRejected')
    }
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        throw new Error('localImport.unsupportedType')
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
        throw new Error('upload.tooLarge')
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (ext === '.svg') {
        const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 65536))
        if (/<!ENTITY\b/i.test(head)) {
            throw new Error('localImport.parseError')
        }
    }
    let imported
    try {
        imported = await geoImportFile(bytes)
    } catch {
        throw new Error('localImport.parseError')
    }
    if (!imported || !Array.isArray(imported.parts)) {
        throw new Error('localImport.parseError')
    }
    if ((imported.entity_count ?? 0) > MAX_ENTITY_LIMIT) {
        throw new Error('localImport.tooManyEntities')
    }
    if (imported.parts.length === 0) {
        throw new Error('localImport.noParts')
    }

    // Bytes canoniques mm (contrat d'export : entités copiées par handle).
    let canonical
    try {
        canonical = await geoCanonicalDxf(bytes)
    } catch {
        throw new Error('localImport.parseError')
    }

    const colors = pickColors(imported.parts.length)
    const parts = imported.parts.map((p, i) => ({
        coordinates: p.coordinates,
        holes: p.holes || [],
        width: p.width,
        height: p.height,
        handles: p.handles || [],
        color: colors[i],
    }))

    const slug = makeLocalFileSlug(name)

    const record = {
        slug,
        projectSlug,
        name,
        addedAt: new Date().toISOString(),
        dxfBytes: canonical.slice().buffer,
        parts,
        sourceUnits: imported.source_units ?? 0,
        entityCount: imported.entity_count ?? 0,
        warnings: imported.warnings || [],
        previewSvg: buildPreviewSvg(parts),
    }
    const { saveLocalFile } = await import('./localFilesStore')
    await saveLocalFile(record)
    return record
}

/** Forme UI attendue par ProjectFiles/FileDone (miroir du mapper serveur) —
 * géométrie complète omise (rechargée depuis IndexedDB au nest). */
export function localRecordToUiFile(record) {
    // La visionneuse DXF (FileModal) fetch l'URL — blob: depuis les bytes
    // locaux (jamais de requête réseau). null en SSR/test (pas d'URL API).
    let dxfUrl = null
    try {
        dxfUrl = record.dxfBytes
            ? URL.createObjectURL(new Blob([record.dxfBytes], { type: 'image/vnd.dxf' }))
            : null
    } catch {
        dxfUrl = null
    }
    return {
        slug: record.slug,
        name: record.name,
        svgUrl: record.previewSvg || null,
        dxfUrl,
        processingStatus: 'done',
        expired: false,
        local: true,
        parts: (record.parts || []).map((p) => ({
            width: Math.round(p.width * 10) / 10,
            height: Math.round(p.height * 10) / 10,
            color: p.color,
        })),
    }
}
