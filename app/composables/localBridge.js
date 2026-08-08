/**
 * J-082 : pont sortie moteur local → artefacts. Convertit la sortie BRUTE du
 * moteur WASM (solution jagua : placed_items item_id + transformation) et le
 * payload enrichi (parts : coords/holes/couleur/handles/file_slug, écrit par
 * le worker — mêmes données que la finalisation serveur) en :
 *   - specs du bundle géométrie (SVG coloré / rapport / DXF),
 *   - alternatives à la forme SERVEUR pour l'UI (report vérifié mesuré,
 *     offcut, strategy, density…).
 *
 * Équivalents serveur : parse_result_containers (placement.py) pour le
 * mapping item_id → pièce source, _finalize_alternative (core/main.py) pour
 * la forme du report. Parité : mêmes données d'entrée (input_items) et même
 * bundle que exports_check ⇒ artefacts identiques au chemin serveur.
 *
 * Pièges respectés : jagua 0.7.x exporte les rotations en DEGRÉS (tout
 * l'aval est en radians, cf placement.py) ; les ids moteur sont sérialisés
 * en string pour les maps JS (l'instance les porte en nombre).
 */
import { geoExportSvgSheet, geoComputeReport, geoExportDxfSheet } from './geometryClient'

const degToRad = (deg) => (deg * Math.PI) / 180

/** SPP : solution.layout (singulier) ; BPP : solution.layouts. */
export function normalizeLayouts(solution) {
    if (!solution) return []
    if (Array.isArray(solution.layouts)) return solution.layouts
    if (solution.layout) return [solution.layout]
    return []
}

/** Dimensions (mm) de la tôle d'un layout, comme bin_dims côté worker. */
export function sheetDims(payload, containerId) {
    const instance = payload?.instance || {}
    if (Array.isArray(instance.bins) && instance.bins.length) {
        // container_id = index du type de tôle dans instance.bins ; repli sur
        // la première (même garde que parse_result_containers).
        const bin = instance.bins[containerId] || instance.bins[0]
        const outer = bin?.shape?.data?.outer || []
        let w = 0
        let h = 0
        for (const [x, y] of outer) {
            w = Math.max(w, x)
            h = Math.max(h, y)
        }
        return [w, h]
    }
    // SPP : la tôle = la bande (max_strip_width × strip_height).
    return [
        Number(payload?.engineConfig?.max_strip_width) || 0,
        Number(instance.strip_height) || 0,
    ]
}

/** Transforms d'un layout (forme Placement du bundle : angle en RADIANS). */
export function layoutTransforms(layout, partsById) {
    return (layout.placed_items || []).map((pi) => {
        const part = partsById.get(String(pi.item_id)) || {}
        return {
            item_id: String(pi.item_id),
            file_slug: part.file_slug || '',
            handles: part.handles || [],
            color: part.color || null,
            angle: degToRad(pi.transformation?.rotation ?? 0),
            x: pi.transformation?.translation?.[0] ?? 0,
            y: pi.transformation?.translation?.[1] ?? 0,
        }
    })
}

/**
 * Construit les specs géométrie (SVG + rapport) de toutes les alternatives
 * d'un résultat moteur, puis les appels bundle correspondants.
 * Renvoie [{ sheets: [svg…], report, containers }] dans l'ordre des
 * alternatives ; null si le résultat est inutilisable (jamais de throw).
 */
export async function buildAlternativeArtifacts(result, payload) {
    try {
        const alternatives = result?.alternatives || []
        const parts = payload?.parts || []
        if (!alternatives.length || !parts.length) return null
        const partsById = new Map(parts.map((p) => [String(p.id), p]))
        // svg::Item {coords, holes, color} par id ; report::Item {id, coords, holes}.
        const svgItems = {}
        const reportItems = []
        for (const p of parts) {
            svgItems[String(p.id)] = {
                coords: p.coords,
                holes: p.holes || [],
                color: p.color || null,
            }
            reportItems.push({ id: String(p.id), coords: p.coords, holes: p.holes || [] })
        }
        const space = Number(payload?.engineConfig?.min_item_separation) || 0

        const out = []
        for (const alt of alternatives) {
            const layouts = normalizeLayouts(alt.solution)
            if (!layouts.length) {
                out.push(null)
                continue
            }
            const containers = []
            const sheets = []
            for (const layout of layouts) {
                const containerId = layout.container_id ?? 0
                const [binWidth, binHeight] = sheetDims(payload, containerId)
                const transforms = layoutTransforms(layout, partsById)
                containers.push({ bin_width: binWidth, bin_height: binHeight, transforms })
                const svg = await geoExportSvgSheet({
                    transforms,
                    items: svgItems,
                    bin_width: binWidth,
                    bin_height: binHeight,
                })
                sheets.push(typeof svg === 'string' ? svg : null)
            }
            const report = await geoComputeReport({
                items: reportItems,
                containers,
                space,
            })
            out.push({
                sheets,
                containers,
                report: report && !report.error ? report : null,
            })
        }
        return out
    } catch {
        return null
    }
}

/**
 * Alternatives à la forme SERVEUR (celle que ResultModal/SSE consomment) :
 * report = verify étalé + champs additifs (miroir de _finalize_alternative).
 * `iterations`/`vcores` : le navigateur est mono-walk (1 vcore).
 */
export function toServerShapeAlternatives(result, payload, artifacts) {
    const alternatives = result?.alternatives || []
    const out = []
    for (let i = 0; i < alternatives.length; i++) {
        const alt = alternatives[i]
        const art = artifacts?.[i]
        const layouts = normalizeLayouts(alt.solution)
        if (!layouts.length || !art) continue
        const reportBundle = art.report || {}
        const perSheet = reportBundle.per_sheet || []
        const totals = reportBundle.totals || null
        const verify = reportBundle.verify || {}
        // Offcut global = le meilleur rectangle libre des tôles (le serveur
        // calcule sur tous les containers ; par tôle ici, sémantique
        // « au moins » identique — jamais surestimé).
        let bestOffcut = null
        for (const s of perSheet) {
            if (s.offcut && (!bestOffcut || (s.offcut.areaMm2 ?? 0) > (bestOffcut.areaMm2 ?? 0))) {
                bestOffcut = s.offcut
            }
        }
        out.push({
            seed: alt.seed ?? null,
            strategy: alt.bias || 'balanced',
            density: alt.solution?.density ?? alt.density ?? null,
            usedSheetShare: null, // additif ; le modal retombe sur la density
            offcut: bestOffcut
                ? { width: bestOffcut.widthMm, height: bestOffcut.heightMm, area: bestOffcut.areaMm2 }
                : null,
            cost: alt.cost ?? alt.solution?.cost ?? null,
            layoutCount: layouts.length,
            svgs: art.sheets || [],
            report: {
                ...verify,
                partsAreaMm2: totals?.partsAreaMm2 ?? null,
                sheetAreaMm2: totals?.sheetAreaMm2 ?? null,
                iterations: alt.evaluations ?? alt.iterations ?? null,
                vcores: 1,
                sheets: perSheet,
                totals,
                offcut: bestOffcut,
            },
        })
    }
    return out
}

/**
 * DXF COMBINÉ d'une tôle — jumeau de build_part (core/main.py) : UN fichier
 * par tôle (container), toutes sources confondues, entités copiées PAR
 * HANDLE depuis chaque source. `sources` : { file_slug: Uint8Array } (bytes
 * validDxf, toujours mm — piège #31). Renvoie { fileName, content } ou null
 * si aucune source disponible (l'aperçu/rapport survivent à un DXF manqué).
 *
 * Nommage serveur : `{slug}_part_{container_id}.dxf`, container_id = index
 * 1-based du layout (parse_result_containers).
 */
export async function buildSheetDxf(jobSlug, layoutIndex, container, payload, sources) {
    const space = Number(payload?.engineConfig?.min_item_separation) || 0
    const outputUnit = payload?.outputUnit || 'mm'
    const addOutShape = Boolean(payload?.addOutShape)

    // Slugs réellement présents dans les transforms de la tôle ET dont on a
    // les bytes — une source manquante est sautée (dégradation sûre).
    const wanted = new Set()
    for (const t of container?.transforms || []) {
        if (t.file_slug) wanted.add(t.file_slug)
    }
    const slugs = [...wanted].filter((s) => sources?.[s])
    if (!slugs.length) return null

    try {
        const dxf = await geoExportDxfSheet(slugs, slugs.map((s) => sources[s]), {
            transforms: container.transforms,
            space,
            add_out_shape: addOutShape,
            bin_width: container.bin_width,
            bin_height: container.bin_height,
            output_unit: outputUnit,
        })
        if (typeof dxf !== 'string') return null
        return {
            fileName: `${jobSlug}_part_${layoutIndex}.dxf`,
            content: dxf,
        }
    } catch {
        return null
    }
}
