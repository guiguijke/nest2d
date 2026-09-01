/**
 * Post-pass BPP « remplissage des bandes résiduelles » (D-MOT-19) —
 * miroir exact de workers/nesting/core/residual.py (docs/PLAN-bpp-impl.md).
 *
 * En multi-tôles, le constructif empile les petites pièces libres sur la
 * DERNIÈRE tôle (croissance de bbox minimale) et le recuit ne backfill
 * pas (remnant moyen : chaque déplacement individuel est non améliorant).
 * Ce pass pose au lattice (`smallLattice`, déjà calibré) les pièces
 * LIBRES de la tôle la moins remplie dans les bandes vides (4 côtés
 * clippés à l'AABB + coin haut-droit, inset space) des tôles plus
 * remplies — chute réutilisable propre sur la dernière.
 *
 * Contrats (identiques au Python) : déterministe ; hôtes (pièces à trous)
 * et pièces nichées immobiles ; compte global invariant ; rollback par
 * batch, exception → layouts restaurés ; < 2 layouts → no-op.
 *
 * Validation JS (pas de shapely) : bbox de chaque pose ⊆ tôle + ringDist
 * ≥ space contre toutes les pièces du layout. ringDist (sommets↔arêtes)
 * est plus lâche que STRtree sur les concaves L/U — acceptable v1
 * (corpus fan + carré) ; le Python reste la gate du banc.
 */
import {
    bbox,
    rotateRing,
    rotatedBbox,
    ringDist,
    smallLattice,
    LATTICE_SIMPLIFY_MM,
} from './structureClient'
// Cycle ESM sûr avec localBridge (qui importe fillResidualBands) : les
// deux modules ne s'utilisent qu'À L'EXÉCUTION de fonctions, jamais à
// l'init — les déclarations hoistées résolvent le cycle.
import { sheetDims } from './localBridge'

const EPS = 1e-6
const N_ITER = 4

function itemCoords(item) {
    return item.coords || item.coordinates || []
}

function partRotations(part, payload) {
    if (part.rotations?.length) return part.rotations
    // Payload navigateur : les rotations vivent souvent sur
    // instance.items[].allowed_orientations — les recopier (P-m.1 : jamais
    // de liste vide au lattice, P-1 en dépend).
    const inst = payload?.instance?.items?.find?.((it) => Number(it.id) === Number(part.id))
    if (inst?.allowed_orientations?.length) return inst.allowed_orientations
    return [0, 90, 180, 270]
}

function placedRing(part, rot, tx, ty) {
    return rotateRing(itemCoords(part), Number(rot) || 0)
        .map(([x, y]) => [x + tx, y + ty])
}

export function layoutAabb(layout, partsById) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    for (const pi of layout.placed_items || []) {
        const part = partsById.get(String(pi.item_id))
        if (!part) continue
        const t = pi.transformation || {}
        const bb = rotatedBbox(bbox(itemCoords(part)), Number(t.rotation) || 0)
        const [tx, ty] = t.translation || [0, 0]
        minx = Math.min(minx, tx + bb[0])
        miny = Math.min(miny, ty + bb[1])
        maxx = Math.max(maxx, tx + bb[2])
        // Constat 2026-09-01 : `tx + bb[3]` ici (coquille) gonflait maxy
        // avec l'abscisse des fans de la bande droite (≈996 + 19.8 > tôle)
        // — la bande haut redevenait dégénérée après un fill de droite et
        // n'était JAMAIS remplie : coin TR vide + arrêt « en escalier »
        // (miroir exact de layout_aabb Python : ty + bb[3]).
        maxy = Math.max(maxy, ty + bb[3])
    }
    if (minx === Infinity) return null
    return [minx, miny, maxx, maxy]
}

export function residualBands(used, sheetW, sheetH, space) {
    const [minx, miny, maxx, maxy] = used
    const defs = [
        ['corner', [maxx + space, maxy + space, sheetW - space, sheetH - space], 'y'],
        ['right', [maxx + space, miny, sheetW - space, maxy], 'x'],
        ['top', [minx, maxy + space, maxx, sheetH - space], 'y'],
        ['left', [space, miny, minx - space, maxy], 'x'],
        ['bottom', [minx, space, maxx, miny - space], 'y'],
    ]
    const out = []
    for (const [name, rect, axis] of defs) {
        const w = rect[2] - rect[0]
        const h = rect[3] - rect[1]
        if (w > EPS && h > EPS) out.push({ name, rect, axis, area: w * h })
    }
    out.sort((a, b) => (b.area - a.area) || (a.name < b.name ? -1 : 1))
    return out
}

function ringAreaAbs(coords) {
    let s = 0
    for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % coords.length]
        s += x1 * y2 - x2 * y1
    }
    return Math.abs(s) / 2
}

function fillRatio(layout, partsById, sheetDimsOf) {
    const [w, h] = sheetDimsOf(layout)
    if (!w || !h) return 0
    let area = 0
    for (const pi of layout.placed_items || []) {
        const part = partsById.get(String(pi.item_id))
        if (part) area += ringAreaAbs(itemCoords(part))
    }
    return area / (w * h)
}

function freePis(layout, partsById) {
    // Pièces LIBRES : sans trous ET dont le centroïde n'est dans aucun
    // trou d'un hôte du MÊME layout (miroir nested_hole).
    const entries = (layout.placed_items || []).map((pi, idx) => {
        const part = partsById.get(String(pi.item_id))
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        return { idx, pi, part, rot: Number(t.rotation) || 0, tx, ty }
    })
    const holes = []
    for (const e of entries) {
        for (const h of (e.part?.holes || [])) {
            holes.push(rotateRing(h, e.rot).map(([x, y]) => [x + e.tx, y + e.ty]))
        }
    }
    const pointInRing = (pt, ring) => {
        // ray-casting pair/impair (anneaux fermés ou ouverts indifférent)
        let inside = false
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i]
            const [xj, yj] = ring[j]
            if ((yi > pt[1]) !== (yj > pt[1])
                && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
                inside = !inside
            }
        }
        return inside
    }
    const centroid = (ring) => {
        let x = 0, y = 0
        for (const [px, py] of ring) { x += px; y += py }
        return ring.length ? [x / ring.length, y / ring.length] : [0, 0]
    }
    return entries
        .filter((e) => {
            if (!e.part || (e.part.holes || []).length) return false
            const ring = rotateRing(itemCoords(e.part), e.rot)
                .map(([x, y]) => [x + e.tx, y + e.ty])
            const c = centroid(ring)
            return !holes.some((h) => pointInRing(c, h))
        })
        .map((e) => e.pi)
}

function pickClass(free, partsById, bandW, bandH, payload) {
    const counts = {}
    for (const pi of free) counts[pi.item_id] = (counts[pi.item_id] || 0) + 1
    let best = null
    for (const clsId of Object.keys(counts).sort((a, b) => a - b)) {
        const part = partsById.get(String(clsId))
        if (!part) continue
        const bb = bbox(itemCoords(part))
        const fits = partRotations(part, payload).some((r) => {
            const rb = rotatedBbox(bb, Number(r) || 0)
            return (rb[2] - rb[0] <= bandW + EPS) && (rb[3] - rb[1] <= bandH + EPS)
        })
        if (fits && (best === null || counts[clsId] > counts[best])) best = clsId
    }
    return best
}

function validateBatch(newPis, layout, partsById, sheetW, sheetH, space) {
    // Ceinture du BATCH (miroir _validate_batch Python) : seules les
    // pièces AJOUTÉES sont jugées — bbox ⊆ tôle + ringDist ≥ space contre
    // TOUT le layout. Les paires préexistantes ne sont pas re-jugées (un
    // défaut amont ne doit pas paralyser le pass) ; retirer des pièces de
    // la source ne peut jamais créer de violation.
    const all = []
    for (const pi of layout.placed_items || []) {
        const part = partsById.get(String(pi.item_id))
        if (!part) continue
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        all.push({ pi, ring: placedRing(part, t.rotation, tx, ty) })
    }
    // Marge 2×SIMPLIFY_MM : le moteur garantit l'espacement sur les
    // anneaux SIMPLIFIÉS — en ring brut les layouts préexistants tombent
    // ~0,005 mm sous space (miroir du simplify Python).
    const lim = space - 2 * LATTICE_SIMPLIFY_MM - EPS
    for (const pi of newPis) {
        const part = partsById.get(String(pi.item_id))
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        const ring = placedRing(part, t.rotation, tx, ty)
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
        for (const [x, y] of ring) {
            if (x < minx) minx = x
            if (y < miny) miny = y
            if (x > maxx) maxx = x
            if (y > maxy) maxy = y
        }
        if (minx < -EPS || miny < -EPS || maxx > sheetW + EPS || maxy > sheetH + EPS) {
            return false
        }
        for (const { pi: other, ring: otherRing } of all) {
            if (other === pi) continue
            if (ringDist(ring, otherRing) < lim) return false
        }
    }
    return true
}

function fillOneBatch(layouts, dstI, srcI, partsById, sheetDimsOf, space, payload) {
    const dst = layouts[dstI]
    const src = layouts[srcI]
    const [sw, sh] = sheetDimsOf(dst)
    const used = layoutAabb(dst, partsById)
    if (!used) return 0
    const free = freePis(src, partsById)
    if (!free.length) return 0

    for (const band of residualBands(used, sw, sh, space)) {
        const [x0, y0, x1, y1] = band.rect
        const clsId = pickClass(free, partsById, x1 - x0, y1 - y0, payload)
        if (clsId === null) continue
        const part = partsById.get(String(clsId))
        const small = {
            id: clsId,
            coords: itemCoords(part),
            rotations: partRotations(part, payload),
        }
        const donors = free.filter((pi) => String(pi.item_id) === String(clsId))
        const lat = smallLattice(small, space, band.rect, { want: donors.length, axis: band.axis })
        if (!lat || lat.length < 2) continue
        const take = Math.min(lat.length, donors.length)
        const usedSrc = layoutAabb(src, partsById)
        const cx = usedSrc ? (usedSrc[0] + usedSrc[2]) / 2 : sw / 2
        const cy = usedSrc ? (usedSrc[1] + usedSrc[3]) / 2 : sh / 2
        const order = donors.slice().sort((a, b) => {
            const ta = a.transformation?.translation || [0, 0]
            const tb = b.transformation?.translation || [0, 0]
            const da = (ta[0] - cx) ** 2 + (ta[1] - cy) ** 2
            const db = (tb[0] - cx) ** 2 + (tb[1] - cy) ** 2
            return db - da
        })
        const batch = order.slice(0, take).map((pi, k) => [pi, lat[k]])
        const saved = batch.map(([pi]) => ({ pi, tr: { ...pi.transformation } }))
        for (const [pi, lp] of batch) {
            pi.transformation = {
                rotation: lp.transformation.rotation,
                translation: [...lp.transformation.translation],
            }
            const si = src.placed_items.indexOf(pi)
            if (si >= 0) src.placed_items.splice(si, 1)
            dst.placed_items.push(pi)
        }
        if (validateBatch(batch.map(([pi]) => pi), dst, partsById, sw, sh, space)) {
            return take
        }
        for (const { pi, tr } of saved) {
            const di = dst.placed_items.indexOf(pi)
            if (di >= 0) dst.placed_items.splice(di, 1)
            pi.transformation = tr
            src.placed_items.push(pi)
        }
    }
    return 0
}

/**
 * @param {Array} parts comme applyHoleFill ({id, coords, holes, ...})
 * @param {Array} layouts [{container_id, placed_items}] — MUTÉS en place
 * @param {number} space
 * @param {object} payload payload local (problem, instance, engineConfig)
 * @returns {number} pièces déplacées (0 = no-op)
 */
export function fillResidualBands(parts, layouts, space, payload) {
    if (!layouts || layouts.length < 2) return 0
    const partsById = new Map(parts.map((p) => [String(p.id), p]))
    for (const l of layouts) {
        for (const pi of l.placed_items || []) {
            if (!partsById.has(String(pi.item_id))) return 0
        }
    }
    space = Math.max(0, Number(space) || 0)
    const sheetDimsOf = (layout) => sheetDims(payload, layout.container_id ?? 0) || [0, 0]
    const snapshot = JSON.parse(JSON.stringify(layouts))
    try {
        let moved = 0
        for (let round = 0; round < N_ITER; round++) {
            const ratios = layouts.map((l) => fillRatio(l, partsById, sheetDimsOf))
            let last = 0
            for (let i = 1; i < layouts.length; i++) {
                if (ratios[i] <= ratios[last]) last = i // tie → plus grand index
            }
            const order = layouts.map((_, i) => i)
                .filter((i) => i !== last)
                .sort((a, b) => (ratios[b] - ratios[a]) || (a - b))
            let progress = false
            for (const i of order) {
                while (true) {
                    const n = fillOneBatch(layouts, i, last, partsById,
                        sheetDimsOf, space, payload)
                    if (!n) break
                    moved += n
                    progress = true
                }
            }
            const kept = layouts.filter((l) => (l.placed_items || []).length)
            if (kept.length !== layouts.length) {
                layouts.length = 0
                layouts.push(...kept)
            }
            if (layouts.length < 2 || !progress) break
        }
        return moved
    } catch (e) {
        // Filet : alternative intacte (contrat applyHoleFill).
        layouts.length = 0
        layouts.push(...JSON.parse(JSON.stringify(snapshot)))
        console.warn('residual-band pass failed, layouts restored', e)
        return 0
    }
}
