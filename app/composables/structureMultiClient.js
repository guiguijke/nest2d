/**
 * Constructeur de grille multi-tôles — miroir EXACT de
 * workers/nesting/core/structure_multi.py (plan 2026-09-05 §2.2b) :
 * l'alternative « Grille » homogène sur toutes ses tôles (hôtes au pas
 * `w + s` partout, petites en lattice analytique), construite SANS
 * moteur. Parité chiffrée verrouillée par tests (comptes par tôle,
 * AABB à 1e-6).
 *
 * Async : `geoPinwheelCapacity` est un appel wasm (mêmes rotations que
 * le Python, code Rust partagé).
 */
import { detectStructuralCase, smallLattice, layoutFitsSheet } from './structureClient'
import {
    residualBands, layoutAabb, validateBatch, compactLastSheet,
} from './residualClient'

function shoelaceArea(coords) {
    let s = 0
    for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % coords.length]
        s += x1 * y2 - x2 * y1
    }
    return Math.abs(s) / 2
}

export function hostGridCapacity(rectBBox, sheetW, sheetH, space) {
    const [rx0, ry0, rx1, ry1] = rectBBox
    const w = rx1 - rx0
    const h = ry1 - ry0
    const s = Math.max(0, Number(space) || 0)
    if (w <= 0 || h <= 0 || sheetW <= 0 || sheetH <= 0) return 0
    const px = w + s
    const py = h + s
    const cols = Math.floor((sheetW - 2 * s - w) / px) + 1
    const rows = Math.floor((sheetH - 2 * s - h) / py) + 1
    if (cols < 1 || rows < 1) return 0
    return cols * rows
}

function hostGridPoses(rect, count, sheetW, sheetH, space) {
    const [rx0, ry0, rx1, ry1] = rect.bbox
    const w = rx1 - rx0
    const h = ry1 - ry0
    const s = Math.max(0, Number(space) || 0)
    const px = w + s
    const py = h + s
    const cols = Math.max(1, Math.floor((sheetW - 2 * s - w) / px) + 1)
    const ox = s - rx0
    const oy = s - ry0
    const poses = []
    for (let k = 0; k < Math.trunc(count); k++) {
        const r = Math.floor(k / cols)
        const c = k % cols
        poses.push({
            item_id: rect.id,
            transformation: { rotation: 0, translation: [ox + c * px, oy + r * py] },
        })
    }
    return poses
}

async function holeFillPoses(hostPose, hostItem, small, space, want, pinwheelCapacity) {
    if (want <= 0) return []
    const [tx, ty] = hostPose.transformation.translation
    const poses = []
    const allowed = [...new Set((small.rotations?.length ? small.rotations : [0])
        .map((r) => ((Number(r) % 360) + 360) % 360))]
    for (const ring of (hostItem.holes || [])) {
        if (!ring || ring.length < 3) continue
        const res = await pinwheelCapacity(ring, small.coords, space, allowed)
        // geoPinwheelCapacity renvoie { rotations: [...] } (JSON du Rust),
        // {ok:false,error} en échec — JAMAIS un tableau nu (l'ancien
        // rots.length sur l'objet = undefined → 0 niche silencieuse,
        // constat e2e space 2).
        const rots = Array.isArray(res) ? res : (res?.rotations || [])
        if (!rots.length) continue
        const n = Math.min(rots.length, want - poses.length)
        if (n <= 0) continue
        const cx = ring.reduce((s2, p) => s2 + p[0], 0) / ring.length
        const cy = ring.reduce((s2, p) => s2 + p[1], 0) / ring.length
        for (let i = 0; i < n; i++) {
            poses.push({
                item_id: small.id,
                transformation: { rotation: Number(rots[i]), translation: [tx + cx, ty + cy] },
            })
        }
        if (poses.length >= want) break
    }
    return poses
}

function bandFillPoses(small, bands, space, want) {
    const poses = []
    for (const band of bands) {
        if (poses.length >= want) break
        const got = smallLattice(small, space, band.rect, {
            want: want - poses.length, axis: band.axis === 'y' ? 'y' : 'x',
        })
        if (got) poses.push(...got)
    }
    return poses
}

function scatterPoses(small, count, x0, sheetW, sheetH, space, minX = null) {
    const coords = small.coords
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
    for (const [x, y] of coords) {
        if (x < bx0) bx0 = x
        if (x > bx1) bx1 = x
        if (y < by0) by0 = y
        if (y > by1) by1 = y
    }
    const w = bx1 - bx0
    const h = by1 - by0
    const s = Math.max(0, Number(space) || 0)
    const oy = s - by0
    const perCol = h + s > 0 ? Math.floor((sheetH - 2 * s - h) / (h + s)) + 1 : 0
    if (perCol < 1) return null
    const poses = []
    let col = 0
    let x = x0
    while (poses.length < count) {
        if (x + w > sheetW - s + 1e-6) return null
        for (let k = 0; k < perCol && poses.length < count; k++) {
            poses.push({
                item_id: small.id,
                transformation: { rotation: 0, translation: [x, oy + k * (h + s)] },
            })
        }
        col += 1
        x = x0 - col * (w + s)
        if (x < s - 1e-6) return null
        if (minX != null && x < minX - 1e-6) return null
    }
    return poses
}

const MINI_PAYLOAD = { instance: { items: [] } }

/**
 * Miroir de build_grid_layouts_multi. `inputItems` : vue ORIGINALE
 * [{id, demand, coords, holes, rotations}] ; `geomOf(id)` -> {coords,
 * rotations} ; `sheets` : [{width, height, count}]. Retourne
 * [{container_id, placed_items}] couvrant TOUTE la demande, ou null
 * (erreurs tracées dans stats.errors).
 */
export async function buildGridLayoutsMulti(inputItems, geomOf, sheets, space, stats = {}, deps = {}) {
    const pinwheelCapacity = deps.pinwheelCapacity
        || (async (...a) => (await import('./geometryClient')).geoPinwheelCapacity(...a))
    if (!Array.isArray(stats.errors)) stats.errors = []
    // `count` (payload worker) ou `demand` (vue de test) — normaliser
    // une fois (detect exige « demand », miroir Python).
    const solveItems = inputItems.map((it) => ({
        id: it.id, demand: Math.trunc(it.demand ?? it.count ?? 0) || 0,
    }))
    const totalArea = solveItems.reduce(
        (s2, it) => s2 + shoelaceArea(geomOf(it.id).coords) * it.demand, 0)
    const caseInfo = detectStructuralCase(solveItems, geomOf, totalArea)
    if (!caseInfo) return null
    const rect = caseInfo.rect
    const small = caseInfo.small
    // Clés STRING : residualClient (layoutAabb/validateBatch) indexe par
    // String(item_id) — miroir des Maps de fillResidualBands.
    const itemsById = new Map(inputItems.map((it) => [String(it.id), it]))
    const rectItem = itemsById.get(String(rect.id))
    let hostsLeft = Math.trunc(rect.demand) || 0
    let smallsLeft = Math.trunc(small.demand) || 0
    const slots = []
    for (const [fmtId, sh] of (sheets || []).entries()) {
        const n = Math.trunc(Number(sh?.count) || 0)
        for (let k = 0; k < n; k++) {
            slots.push([fmtId, Number(sh.width) || 0, Number(sh.height) || 0])
        }
    }
    if (!slots.length) {
        stats.errors.push({ stage: 'grid-multi', message: 'aucune tôle déclarée' })
        return null
    }

    const layouts = []
    for (let k = 0; k < slots.length; k++) {
        const [fmtId, w, h] = slots[k]
        const isLast = k === slots.length - 1
        if (isLast) {
            if (hostsLeft > 0 || smallsLeft > 0) {
                const poses = await buildLastSheet(rect, rectItem, small, w, h, space,
                    hostsLeft, smallsLeft, stats, pinwheelCapacity)
                if (poses === null) return null
                layouts.push({ container_id: fmtId, placed_items: poses })
                hostsLeft = 0
                smallsLeft = 0
            }
            break
        }
        if (hostsLeft <= 0 && smallsLeft <= 0) break
        const cap = hostGridCapacity(rect.bbox, w, h, space)
        const nHosts = Math.min(hostsLeft, cap)
        const hostPoses = hostGridPoses(rect, nHosts, w, h, space)
        const smallPoses = []
        for (const hp of hostPoses) {
            if (smallsLeft - smallPoses.length <= 0) break
            const got = await holeFillPoses(hp, rectItem, small, space,
                smallsLeft - smallPoses.length, pinwheelCapacity)
            smallPoses.push(...got)
        }
        const s2 = Math.max(0, Number(space) || 0)
        if (hostPoses.length && smallsLeft - smallPoses.length > 0) {
            const used = layoutAabb({ placed_items: hostPoses }, itemsById)
            const bands = residualBands(used, w, h, s2)
            const got = bandFillPoses(small, bands, space, smallsLeft - smallPoses.length)
            smallPoses.push(...got)
        } else if (!hostPoses.length && smallsLeft > 0) {
            const got = bandFillPoses(small,
                [{ name: 'full', rect: [s2, s2, w - s2, h - s2], axis: 'x' }], space, smallsLeft)
            smallPoses.push(...got)
        }
        if (hostPoses.length && !validateBatch(
            hostPoses, { container_id: fmtId, placed_items: [] }, itemsById, w, h, space)) {
            stats.errors.push({ stage: 'grid-multi', message: `grille hôtes invalide (tôle ${k + 1})` })
            return null
        }
        if (smallPoses.length && !validateBatch(
            smallPoses, { container_id: fmtId, placed_items: hostPoses }, itemsById, w, h, space)) {
            stats.errors.push({ stage: 'grid-multi', message: `small lattice invalide (tôle ${k + 1})` })
            return null
        }
        layouts.push({ container_id: fmtId, placed_items: [...hostPoses, ...smallPoses] })
        hostsLeft -= nHosts
        smallsLeft -= smallPoses.length
    }

    if (hostsLeft > 0 || smallsLeft > 0) {
        stats.errors.push({
            stage: 'grid-multi',
            message: `stock insuffisant : reste ${hostsLeft} hôtes + ${smallsLeft} petites — pas d'alternative grille (jamais une grille partielle)`,
        })
        return null
    }
    const total = solveItems.reduce((s2, it) => s2 + it.demand, 0)
    const placedTotal = layouts.reduce((s2, l) => s2 + l.placed_items.length, 0)
    if (placedTotal !== total) {
        stats.errors.push({ stage: 'grid-multi', message: `compte ${placedTotal} != demande ${total}` })
        return null
    }
    for (let k = 0; k < layouts.length; k++) {
        if (!layoutFitsSheet(layouts[k], geomOf, slots[k][1], slots[k][2])) {
            stats.errors.push({ stage: 'grid-multi', message: `pièce hors tôle (tôle ${k + 1})` })
            return null
        }
    }
    return layouts
}

async function buildLastSheet(rect, rectItem, small, w, h, space, hostsLeft, smallsLeft, stats, pinwheelCapacity) {
    const s = Math.max(0, Number(space) || 0)
    if (hostsLeft <= 0) {
        if (smallsLeft <= 0) return []
        const got = bandFillPoses(small,
            [{ name: 'full', rect: [s, s, w - s, h - s], axis: 'x' }], space, smallsLeft)
        if (got.length < smallsLeft) {
            stats.errors.push({
                stage: 'grid-multi',
                message: `dernière tôle sans hôte : ${got.length}/${smallsLeft} petites — stock insuffisant`,
            })
            return null
        }
        return got
    }
    const [rx0, ry0, rx1, ry1] = rect.bbox
    const pitchY = (ry1 - ry0) + s
    const perCol = Math.floor((h - 2 * s - (ry1 - ry0)) / pitchY) + 1
    if (perCol < 1) {
        stats.errors.push({ stage: 'grid-multi', message: 'hôte ne tient pas sur la dernière tôle' })
        return null
    }
    const cols = Math.ceil(hostsLeft / perCol)
    const pitchX = (rx1 - rx0) + s
    if (s + cols * pitchX > w + 1e-6) {
        stats.errors.push({ stage: 'grid-multi', message: 'colonnes d\'hôtes hors dernière tôle' })
        return null
    }
    const hostPoses = []
    for (let k = 0; k < hostsLeft; k++) {
        const c = Math.floor(k / perCol)
        const r = k % perCol
        hostPoses.push({
            item_id: rect.id,
            transformation: { rotation: 0, translation: [s - rx0 + c * pitchX, s - ry0 + r * pitchY] },
        })
    }
    const nested = []
    for (const hp of hostPoses) {
        if (smallsLeft - nested.length <= 0) break
        const got = await holeFillPoses(hp, rectItem, small, space, smallsLeft - nested.length, pinwheelCapacity)
        nested.push(...got)
    }
    const freeLeft = smallsLeft - nested.length
    let freePoses = []
    if (freeLeft > 0) {
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity
        for (const [x, y] of small.coords) {
            if (x < bx0) bx0 = x
            if (x > bx1) bx1 = x
            if (y < by0) by0 = y
            if (y > by1) by1 = y
        }
        const sw_ = bx1 - bx0
        // Le scatter vit à DROITE du bloc hôtes (+ space) : les colonnes
        // descendent vers la gauche mais ne peuvent JAMAIS traverser le
        // bloc (constat e2e : sans borne, 632 libres débordaient sur les
        // colonnes d'hôtes).
        const minX = s + cols * pitchX + s
        const x0 = Math.max(w - s - sw_, minX)
        freePoses = scatterPoses(small, freeLeft, x0, w, h, space, minX)
        if (freePoses === null) {
            stats.errors.push({
                stage: 'grid-multi',
                message: 'petites restantes sans pose légale initiale (dernière tôle)',
            })
            return null
        }
    }
    const itemsById = new Map([[String(rectItem.id), rectItem], [String(small.id), small]])
    if (!validateBatch(
        [...nested, ...freePoses],
        { container_id: 0, placed_items: hostPoses }, itemsById, w, h, space)) {
        console.error('[grid-multi] état initial dernière tôle invalide :',
            'hosts', hostPoses.length, 'nested', nested.length,
            'free', freePoses.length, 'space', space)
        stats.errors.push({ stage: 'grid-multi', message: 'état initial dernière tôle invalide' })
        return null
    }
    if (freePoses.length) {
        const layout = { container_id: 0, placed_items: [...hostPoses, ...nested, ...freePoses] }
        const cstats = {}
        const moved = compactLastSheet([layout], 0, itemsById,
            () => [w, h], space, MINI_PAYLOAD, cstats, true)
        if (cstats.compactRollback) {
            stats.errors.push({
                stage: 'grid-multi',
                message: `compaction dernière tôle roulée back (${cstats.compactRollbackReason})`,
            })
            return null
        }
        if (!moved) {
            stats.errors.push({
                stage: 'grid-multi',
                message: 'libres non compactées derrière l\'ancre (style non atteint)',
            })
            return null
        }
        return layout.placed_items
    }
    return [...hostPoses, ...nested]
}
