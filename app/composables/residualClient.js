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
    ringCentroid,
    ringDist,
    smallLattice,
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

// ---------------------------------------------------------------------------
// A1/D5 (audit 2026-09-03) : miroir de residual._pair_violates — à space 0
// (et dès que space ≤ marge de simplify) `dist < lim` planché ne rejette
// plus rien. Politique §8.1 : contact PERMIS, chevauchement d'aire REJETÉ.
// Sans shapely, un chevauchement d'aire > 0 se détecte par : croisement
// PROPRE d'arêtes, recouvrement COLINÉAIRE (poses dupliquées), ou sommet
// strictement intérieur (containment). Le contact légal (jumeaux pinwheel
// à distance 0) ne croise rien et ne plonge aucun sommet.
// ---------------------------------------------------------------------------
const OVERLAP_EPS_MM2 = 0.01
const STRICT_INSIDE_MM = 0.01

function segPointDistLocal(px, py, ax, ay, bx, by) {
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 === 0) return Math.hypot(px - ax, py - ay)
    let t = ((px - ax) * dx + (py - ay) * dy) / l2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pointInRingLocal(pt, ring) {
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

function vertexStrictlyInside(ring, other) {
    for (const [x, y] of ring) {
        if (!pointInRingLocal([x, y], other)) continue
        let dmin = Infinity
        for (let i = 0; i < other.length; i++) {
            const [ax, ay] = other[i]
            const [bx, by] = other[(i + 1) % other.length]
            dmin = Math.min(dmin, segPointDistLocal(x, y, ax, ay, bx, by))
        }
        if (dmin > STRICT_INSIDE_MM) return true
    }
    return false
}

/** Vrai chevauchement d'aire entre deux anneaux (frontières qui se
 * croisent proprement, se recouvrent en colinéaire, ou sommet plongé). */
export function ringsOverlap(ringA, ringB) {
    const orient = (px, py, qx, qy, rx, ry) =>
        (qx - px) * (ry - py) - (qy - py) * (rx - px)
    const n1 = ringA.length
    const n2 = ringB.length
    for (let i = 0; i < n1; i++) {
        const ax = ringA[i][0]; const ay = ringA[i][1]
        const bx = ringA[(i + 1) % n1][0]; const by = ringA[(i + 1) % n1][1]
        for (let j = 0; j < n2; j++) {
            const cx = ringB[j][0]; const cy = ringB[j][1]
            const dx = ringB[(j + 1) % n2][0]; const dy = ringB[(j + 1) % n2][1]
            const o1 = orient(ax, ay, bx, by, cx, cy)
            const o2 = orient(ax, ay, bx, by, dx, dy)
            const o3 = orient(cx, cy, dx, dy, ax, ay)
            const o4 = orient(cx, cy, dx, dy, bx, by)
            // Croisement propre : les deux segments se coupent en leur
            // intérieur (strictement) → aire d'intersection > 0.
            if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))
                && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
        }
    }
    // Poses dupliquées / recouvrements bord-à-bord / containment : aucun
    // croisement STRICT d'arêtes, mais des points INTÉRIEURS de l'un sont
    // strictement dans l'autre. On échantillonne centroïde + sommets +
    // MILIEUX d'arêtes : deux carrés décalés de 50 mm n'ont aucun sommet
    // strictement intérieur (les sommets sont SUR le bord de l'autre) mais
    // le milieu de l'arête plongée, si. Un contact légal ne plonge rien
    // (ses points tombent SUR la frontière, jamais dedans).
    return samplePoints(ringA).some((pt) => pointStrictlyInside(pt, ringB))
        || samplePoints(ringB).some((pt) => pointStrictlyInside(pt, ringA))
}

/** Centroïde + sommets + milieux d'arêtes (points stables d'un anneau). */
function samplePoints(ring) {
    const pts = [ringCentroidLocal(ring)]
    for (let i = 0; i < ring.length; i++) {
        pts.push(ring[i])
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        pts.push([(x1 + x2) / 2, (y1 + y2) / 2])
    }
    return pts
}

function ringCentroidLocal(ring) {
    // centroïde d'AIRE (miroir shapely) — la moyenne des sommets diffère
    // près d'un bord de trou (D11).
    let a = 0; let cx = 0; let cy = 0
    const n = ring.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % n]
        const f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    }
    if (a === 0) {
        let sx = 0; let sy = 0
        for (const [x, y] of ring) { sx += x; sy += y }
        return ring.length ? [sx / ring.length, sy / ring.length] : [0, 0]
    }
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]
}

function pointStrictlyInside(pt, ring) {
    if (!pointInRingLocal(pt, ring)) return false
    let dmin = Infinity
    for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i]
        const [bx, by] = ring[(i + 1) % ring.length]
        dmin = Math.min(dmin, segPointDistLocal(pt[0], pt[1], ax, ay, bx, by))
    }
    return dmin > STRICT_INSIDE_MM
}

/** Miroir exact de residual._pair_violates (V4/V5, vérif 2026-09-04) :
 * space > 0 → TOUTE paire à d < space − ε est une violation, y compris
 * le contact bord à bord à d == 0 sans aire (régression du 03/09) ;
 * space ≤ ε → contact PERMIS, seul le chevauchement d'aire
 * (ringsOverlap : croisements + points strictement intérieurs) est
 * rejeté — parité exacte avec le Python à space 0 (V5 : l'ancien
 * plancher 1e-9 rejetait le contact que Python permet, chute navigateur
 * 371 contre 562 serveur). */
export function pairViolates(ringA, ringB, space) {
    const d = ringDist(ringA, ringB)
    if (space > EPS) {
        if (d < space - EPS) return true
        // W4 (vérif 2026-09-04) : containment à d > 0 aussi à space > 0 —
        // un anneau INCLUS dans un autre (fan sur le corps d'un hôte, à
        // ≥ space du bord externe et des trous) mesure une distance de
        // frontière ≥ space mais chevauche le matériau. Python (shapely,
        // d = 0 par construction de la distance au polygone À TROUS)
        // le rejette. Miroir exact du test Python.
        if (d > 0) return containedOverlap(ringA, ringB)
        return false
    }
    if (d > 0) {
        return containedOverlap(ringA, ringB)
    }
    return ringsOverlap(ringA, ringB)
}

/** V9/W4 : un anneau INCLUS dans l'autre (bbox inclue, centroïde
 * strictement intérieur) chevauche le matériau — distance de frontière
 * positive pourtant. */
function containedOverlap(ringA, ringB) {
    const bbA = bbox(ringA)
    const bbB = bbox(ringB)
    const aInB = bbA[0] >= bbB[0] && bbA[1] >= bbB[1] && bbA[2] <= bbB[2] && bbA[3] <= bbB[3]
    const bInA = bbB[0] >= bbA[0] && bbB[1] >= bbA[1] && bbB[2] <= bbA[2] && bbB[3] <= bbA[3]
    if (aInB === bInA) return false
    const inner = aInB ? ringA : ringB
    const outer = aInB ? ringB : ringA
    return pointStrictlyInside(ringCentroidLocal(inner), outer)
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

export function freePis(layout, partsById) {
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
    // D11 (audit 2026-09-03) : centroïde d'AIRE (ringCentroid) — la
    // moyenne des sommets diverge du shapely .centroid près d'un bord de
    // trou et classe différemment libre/nichée (parité serveur).
    return entries
        .filter((e) => {
            if (!e.part || (e.part.holes || []).length) return false
            const ring = rotateRing(itemCoords(e.part), e.rot)
                .map(([x, y]) => [x + e.tx, y + e.ty])
            const c = ringCentroid(ring)
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

/** V9 (vérif 2026-09-04) : anneaux d'OCCUPATION d'une pièce = anneau
 * externe + PAROIS DES TROUS (une fan à 0,5 mm de la paroi d'un trou
 * mesurait sa distance à l'anneau EXTERNE de l'hôte — à travers le
 * matériau — et passait). Miroir du _placed_poly Python (polygone avec
 * trous : shapely mesure à la frontière complète). */
export function occupancyRings(part, rot, tx, ty) {
    const rings = [placedRing(part, rot, tx, ty)]
    for (const h of part?.holes || []) {
        rings.push(rotateRing(h, Number(rot) || 0)
            .map(([x, y]) => [x + tx, y + ty]))
    }
    return rings
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
        for (const ring of occupancyRings(part, t.rotation, tx, ty)) {
            all.push({ pi, ring })
        }
    }
    // V9 : doublon = même (item_id, rotation, translation) à 1e-6 — deux
    // L concaves superposés échappent à la détection géométrique.
    const seenKeys = new Set(all.map(({ pi }) => {
        const t = pi.transformation || {}
        return `${pi.item_id}|${(Number(t.rotation) || 0).toFixed(4)}`
            + `|${(t.translation?.[0] ?? 0).toFixed(3)}|${(t.translation?.[1] ?? 0).toFixed(3)}`
    }))
    // D5/A1 (audit 2026-09-03) : le seuil vit dans pairViolates — à
    // space ≤ marge de simplify l'ancien `dist < lim` planché ne rejetait
    // plus rien ; désormais d == 0 rejette les VRAIS chevauchements
    // (croisement/colinéarité/containment) et PERMET le contact (§8.1).
    // Les nouvelles entre elles sont jugées aussi (elles sont peu
    // nombreuses — linéaire suffit).
    const newRings = []
    for (const pi of newPis) {
        const part = partsById.get(String(pi.item_id))
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        const key = `${pi.item_id}|${(Number(t.rotation) || 0).toFixed(4)}`
            + `|${(tx).toFixed(3)}|${(ty).toFixed(3)}`
        if (seenKeys.has(key)) return false
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
            if (pairViolates(ring, otherRing, space)) return false
        }
        for (const otherRing of newRings) {
            if (pairViolates(ring, otherRing, space)) return false
        }
        newRings.push(ring)
    }
    return true
}

export function fillOneBatch(layouts, dstI, srcI, partsById, sheetDimsOf, space, payload, freeArg = null, bands = null, minPosesArg = null) {
    const dst = layouts[dstI]
    const src = layouts[srcI]
    const [sw, sh] = sheetDimsOf(dst)
    const used = layoutAabb(dst, partsById)
    if (!used) return 0
    // `freeArg` surcharge la liste des donneuses (compaction : donneuses
    // détachées, src == dst) — miroir du paramètre `free` Python.
    // `bands` surcharge les zones (poches du re-grid AVANT les bandes
    // classiques — audit 2026-09-02 F1).
    const free = freeArg || freePis(src, partsById)
    if (!free.length) return 0

    for (const band of (bands || residualBands(used, sw, sh, space))) {
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
        // Batches d'une pose : UNIQUEMENT en zones explicites (poches de
        // la compaction — audit F2a). Les bandes classiques gardent le
        // seuil 2 (miroir Python, contrat T4).
        // A8 : seuil 1 UNIQUEMENT en zones explicites ; minPosesArg
        // explicite (W3 : bandes classiques en gravité −X) garde le
        // seuil passé.
        const minPoses = minPosesArg != null ? minPosesArg : (bands ? 1 : 2)
        if (!lat || lat.length < minPoses) continue
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
        // A7 (audit 2026-09-03) : plus de retry take>>1 — il rejouait les
        // MÊMES premières poses (lat[0] fautive = bande perdue). Chaque
        // pose est validée individuellement contre l'occupancy de dst
        // (préexistant, en cross-sheet les donneuses n'y sont jamais) ;
        // les poses commitées s'ajoutent au fil de l'eau (nouvelles-vs-
        // nouvelles, piège #51). Une pose fautive n'en coûte qu'elle-même.
        const occupancy = []
        for (const pi of dst.placed_items || []) {
            const part2 = partsById.get(String(pi.item_id))
            if (!part2) continue
            const t2 = pi.transformation || {}
            const [tx2, ty2] = t2.translation || [0, 0]
            occupancy.push(...occupancyRings(part2, t2.rotation, tx2, ty2))
        }
        const newRings = []
        let committed = 0
        for (let k = 0; k < Math.min(order.length, lat.length); k++) {
            const pi = order[k]
            const lp = lat[k].transformation
            const [ltx, lty] = lp.translation || [0, 0]
            const ring = placedRing(part, lp.rotation, ltx, lty)
            let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
            for (const [x, y] of ring) {
                if (x < minx) minx = x
                if (y < miny) miny = y
                if (x > maxx) maxx = x
                if (y > maxy) maxy = y
            }
            if (minx < -EPS || miny < -EPS || maxx > sw + EPS || maxy > sh + EPS) {
                continue
            }
            if (occupancy.some((otherRing) => pairViolates(ring, otherRing, space))) {
                continue
            }
            if (newRings.some((otherRing) => pairViolates(ring, otherRing, space))) {
                continue
            }
            const oldTr = pi.transformation || {}
            pi.transformation = {
                rotation: lp.rotation,
                translation: [...(lp.translation || [0, 0])],
            }
            if (src !== dst) {
                const si = src.placed_items.indexOf(pi) // identité (===)
                if (si >= 0) src.placed_items.splice(si, 1)
            }
            dst.placed_items.push(pi)
            newRings.push(ring)
            // V18 : seules les transformations RÉELLEMENT modifiées
            // comptent (miroir Python).
            const ox = oldTr.translation?.[0] ?? 0
            const oy = oldTr.translation?.[1] ?? 0
            const orot = Number(oldTr.rotation) || 0
            if (Math.abs((Number(lp.rotation) || 0) - orot) > 1e-9
                || Math.abs((lp.translation?.[0] ?? 0) - ox) > 1e-9
                || Math.abs((lp.translation?.[1] ?? 0) - oy) > 1e-9) {
                committed++
            }
        }
        if (committed) return committed
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
/** Classe la tôle en unités RIGIDES (miroir de
 * residual._helix_units_and_free) : une hélice = hôte (item à trous) +
 * fans dont le centroïde est dans un de SES trous ; classification
 * identique à freePis (même centroïde, même point-in-ring). */
export function helixUnitsAndFree(layout, partsById) {
    const entries = (layout.placed_items || []).map((pi) => {
        const part = partsById.get(String(pi.item_id))
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        return { pi, part, rot: Number(t.rotation) || 0, tx, ty }
    })
    const hostHoles = [] // {hostPi, ring}
    for (const e of entries) {
        for (const h of (e.part?.holes || [])) {
            hostHoles.push({
                hostPi: e.pi,
                ring: rotateRing(h, e.rot).map(([x, y]) => [x + e.tx, y + e.ty]),
            })
        }
    }
    const pointInRing = (pt, ring) => {
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
    // D11 : centroïde d'aire, même classification que freePis/Python.
    const units = []
    const free = []
    const unitOf = new Map()
    for (const e of entries) {
        if (!e.part) continue
        if ((e.part.holes || []).length) {
            if (!unitOf.has(e.pi)) {
                const u = { host: e.pi, fans: [] }
                unitOf.set(e.pi, u)
                units.push(u)
            }
            continue
        }
        const ring = rotateRing(itemCoords(e.part), e.rot)
            .map(([x, y]) => [x + e.tx, y + e.ty])
        const c = ringCentroid(ring)
        const host = hostHoles.find((h) => pointInRing(c, h.ring))
        if (host) {
            let u = unitOf.get(host.hostPi)
            if (!u) {
                u = { host: host.hostPi, fans: [] }
                unitOf.set(host.hostPi, u)
                units.push(u)
            }
            u.fans.push(e.pi)
        } else {
            free.push(e.pi)
        }
    }
    return { units, free }
}

/** Phase 1 de la compaction (miroir de residual._regrid_helices) :
 * hélices re-grillées en colonnes depuis le bord gauche par smallLattice
 * (rotations permises, validation exacte) ; fans nichées en
 * transformation RIGIDE (elles vivent dans le polygone externe de leur
 * hôte → distance aux autres unités = celle des hôtes). Tout-ou-rien :
 * si une classe ne tient pas entièrement, aucun hôte ne bouge.
 * Retourne {moved, freeRects} : rects libres des colonnes PARTIELLES de
 * la grille — poches internes à l'AABB, invisibles de residualBands
 * (bandes = extérieures seulement) ; remplies par la compaction avant
 * les bandes classiques (audit 2026-09-02 F1). */
export function regridHelices(layout, units, partsById, sw, sh, space, payload) {
    const byCls = new Map()
    for (const u of units) {
        const k = String(u.host.item_id)
        if (!byCls.has(k)) byCls.set(k, [])
        byCls.get(k).push(u)
    }
    const saved = units.map((u) => ({
        host: { ...u.host.transformation },
        fans: u.fans.map((f) => ({ ...f.transformation })),
    }))
    const restoreAll = () => {
        units.forEach((u, i) => {
            u.host.transformation = saved[i].host
            u.fans.forEach((f, j) => { f.transformation = saved[i].fans[j] })
        })
    }
    let xFrom = space
    let moved = 0
    const freeRects = []
    for (const cls of [...byCls.keys()].sort((a, b) => byCls.get(b).length - byCls.get(a).length || (Number(a) - Number(b)))) {
        const group = byCls.get(cls)
        const part = partsById.get(cls)
        if (!part) continue
        const lat = smallLattice(
            { id: Number(cls), coords: itemCoords(part), rotations: partRotations(part, payload) },
            space, [xFrom, space, sw - space, sh - space], { want: group.length, axis: 'x' })
        if (!lat || lat.length < group.length) {
            restoreAll()
            return { moved: 0, freeRects: [] }
        }
        // Poches des colonnes partielles (miroir Python) : poses d'une
        // même colonne = même abscisse de centroïde (arrondie au millième).
        // Seule la DERNIÈRE colonne (x max) peut être incomplète sans
        // chevaucher ses voisines ; rect clippé au maxx des autres.
        const poseBb = lat.map((lp) => {
            const t = lp.transformation
            return {
                bb: rotatedBbox(bbox(itemCoords(part)), Number(t.rotation) || 0),
                tx: t.translation[0], ty: t.translation[1],
            }
        })
        // D14 (audit 2026-09-03) : clé de colonne par TOLÉRANCE 1e-6 — un
        // round au millième peut séparer deux x quasi égaux selon le bruit
        // flottant (miroir Python _col_key).
        const cols = new Map()
        poseBb.forEach((p, k) => {
            const key = Math.round((p.tx + 1e-9) * 1e6) / 1e6
            if (!cols.has(key)) cols.set(key, [])
            cols.get(key).push(k)
        })
        const cap = Math.max(...[...cols.values()].map((v) => v.length))
        const lastKey = [...cols.keys()].sort((a, b) => a - b).pop()
        const idxs = cols.get(lastKey)
        if (idxs.length < cap) {
            const x0 = Math.min(...idxs.map((k) => poseBb[k].tx + poseBb[k].bb[0]))
            const x1 = Math.max(...idxs.map((k) => poseBb[k].tx + poseBb[k].bb[2]))
            const top = Math.max(...idxs.map((k) => poseBb[k].ty + poseBb[k].bb[3]))
            let othersMaxx = 0
            // P1 (audit 2026-09-03) : poche CLIPPÉE au sommet des colonnes
            // PLEINES — l'ancienne poche montait jusqu'au bord de tôle :
            // remplie, l'AABB atteignait y≈990 et la bande haute au-dessus
            // des colonnes pleines dégénérait (~10 mm, jamais remplie).
            let fullTop = 0
            for (const [key, ks] of cols) {
                if (key === lastKey) continue
                othersMaxx = Math.max(othersMaxx,
                    ...ks.map((k) => poseBb[k].tx + poseBb[k].bb[2]))
                fullTop = Math.max(fullTop,
                    ...ks.map((k) => poseBb[k].ty + poseBb[k].bb[3]))
            }
            const pocket = [Math.max(x0, othersMaxx + space), top + space, x1,
                Math.min(sh - space, fullTop)]
            if (pocket[2] - pocket[0] > EPS && pocket[3] - pocket[1] > EPS) {
                freeRects.push(pocket)
            }
        }
        const order = group.slice().sort((a, b) => {
            const ta = a.host.transformation.translation
            const tb = b.host.transformation.translation
            return (ta[0] - tb[0]) || (ta[1] - tb[1])
        })
        let clsMaxX = 0
        order.forEach((u, k) => {
            const lp = lat[k].transformation
            const old = u.host.transformation
            const dr = (Number(lp.rotation) || 0) - (Number(old.rotation) || 0)
            const rad = (dr * Math.PI) / 180
            const [ox, oy] = old.translation || [0, 0]
            const [nx, ny] = lp.translation || [0, 0]
            // D16 (audit 2026-09-03) : moved ne compte que les
            // transformations RÉELLEMENT modifiées (au 2e appel, moved
            // valait 505 sans rien bouger).
            const hostChanged = Math.abs(dr) > 1e-9
                || Math.abs(nx - ox) > 1e-9 || Math.abs(ny - oy) > 1e-9
            u.host.transformation = { rotation: lp.rotation, translation: [nx, ny] }
            for (const f of u.fans) {
                const ft = f.transformation
                const [fx, fy] = ft.translation || [0, 0]
                const dx = fx - ox
                const dy = fy - oy
                f.transformation = {
                    rotation: (Number(ft.rotation) || 0) + dr,
                    translation: [nx + Math.cos(rad) * dx - Math.sin(rad) * dy,
                                  ny + Math.sin(rad) * dx + Math.cos(rad) * dy],
                }
                if (hostChanged) moved++
            }
            const bb = rotatedBbox(bbox(itemCoords(part)), Number(lp.rotation) || 0)
            clsMaxX = Math.max(clsMaxX, nx + bb[2])
            if (hostChanged) moved++
        })
        xFrom = clsMaxX + space
    }
    return { moved, freeRects }
}

/**
 * Compaction de la tôle donneuse (miroir de residual._compact_last_sheet,
 * constat user 2026-09-02 « pas optimisé −X ») : le moteur BPP ne compacte
 * pas la dernière tôle (coût = tôles + remnant, pas la direction par
 * tôle). Les pièces LIBRES sont détachées puis re-posées en lattice
 * compact DERRIÈRE le bloc ancré (hôtes + nichées) — les colonnes
 * poussent depuis l'ancre, la chute redevient un rectangle unique.
 * Tout-ou-rien : des libres non replacées qui ne rentrent plus à leur
 * pose d'origine restaurent l'état d'avant (no-op).
 */
// V7 (vérif 2026-09-04) : critère UNIFIÉ avec Python — largeur tournée
// ET position (ancrage −X des hôtes, libres derrière l'ancre).
function sheetNeedsCompaction(layout, units, free, partsById, space) {
    const tol = 4 * space + 1.0
    let hostsCol = true
    let hostsLeft = true
    let anchorMaxx = 0
    if (units.length) {
        const xs = units.map((u) => Number(u.host.transformation?.translation?.[0] || 0))
        const hostW = Math.max(...units.map((u) => {
            const part2 = partsById.get(String(u.host.item_id))
            const bb = rotatedBbox(bbox(itemCoords(part2)), Number(u.host.transformation?.rotation) || 0)
            return bb[2] - bb[0]
        }))
        hostsCol = (Math.max(...xs) - Math.min(...xs)) <= hostW + tol
        hostsLeft = Math.min(...xs) <= space + tol
        for (const u of units) {
            const part2 = partsById.get(String(u.host.item_id))
            const bb = rotatedBbox(bbox(itemCoords(part2)), Number(u.host.transformation?.rotation) || 0)
            anchorMaxx = Math.max(anchorMaxx, (u.host.transformation?.translation?.[0] || 0) + bb[2])
        }
    }
    let freesCol = true
    let freesLeft = true
    if (free.length) {
        const geo = free.map((pi) => {
            const part2 = partsById.get(String(pi.item_id))
            const bb = rotatedBbox(bbox(itemCoords(part2)), Number(pi.transformation?.rotation) || 0)
            const x0 = pi.transformation?.translation?.[0] || 0
            return [x0, x0 + bb[2], bb[2] - bb[0]]
        })
        const minW = Math.min(...geo.map((g) => g[2]))
        freesCol = (Math.max(...geo.map((g) => g[1])) - Math.min(...geo.map((g) => g[0])))
            <= 2 * minW + tol
        freesLeft = Math.min(...geo.map((g) => g[0])) <= anchorMaxx + space + tol
    }
    return !(hostsCol && hostsLeft && freesCol && freesLeft)
}

// V3 (étape 3.1) : relais des libres derrière l'ancre — partagé donneuse/
// receveuses. Lève COMPACT_ROLLBACK si la restauration échoue.
function relayFreesBehindAnchor(layouts, sheetI, free, pocketRects,
    partsById, sheetDimsOf, space, payload) {
    const last = layouts[sheetI]
    const [sw, sh] = sheetDimsOf(last)
    const pocketBands = pocketRects
        .map((r, i) => ({ name: `pocket${i}`, rect: r, axis: 'x' }))
        .sort((a, b) => (a.rect[0] - b.rect[0]) || a.name.localeCompare(b.name))
    let pocketsLeft = pocketBands.length > 0
    let bands = pocketsLeft ? pocketBands : null
    const savedPoses = new Map(free.map((pi) => [pi, { ...pi.transformation }]))
    const placedHas = (pi) => (last.placed_items || []).some((x) => x === pi)
    last.placed_items = (last.placed_items || []).filter(
        (pi) => !free.includes(pi))
    let moved = 0
    while (true) {
        const remaining = free.filter((pi) => !placedHas(pi))
        if (!remaining.length) break
        if (!bands) {
            // Bandes classiques recalculées à chaque tour, gravité −X.
            const used2 = layoutAabb(last, partsById)
            const bl = used2 ? residualBands(used2, sw, sh, space) : []
            bl.sort((a, b) => (a.rect[0] - b.rect[0]) || (b.area - a.area))
            bands = bl
        }
        const n = fillOneBatch(layouts, sheetI, sheetI, partsById,
            sheetDimsOf, space, payload, remaining, bands)
        if (!n) {
            if (pocketsLeft) {
                pocketsLeft = false
                bands = null
                continue
            }
            break
        }
        moved += n
        if (!pocketsLeft) bands = null
    }
    const restore = free.filter((pi) => !placedHas(pi))
    for (const pi of restore) {
        pi.transformation = savedPoses.get(pi)
        ;(last.placed_items || (last.placed_items = [])).push(pi)
    }
    if (restore.length && !validateBatch(restore, last, partsById, sw, sh, space)) {
        throw COMPACT_ROLLBACK
    }
    return moved
}

// W3 : validation de RETOUR des candidates non posées — pose d'origine
// = état d'entrée, on ne re-juge que le chevauchement contre le NOUVEL
// état (miroir residual._validate_return Python).
function validateReturn(pis, layout, partsById, space) {
    const excl = new Set(pis)
    const occ = []
    for (const pi of layout.placed_items || []) {
        if (excl.has(pi)) continue
        const part = partsById.get(String(pi.item_id))
        if (!part) continue
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        occ.push(placedRing(part, t.rotation, tx, ty))
    }
    for (const pi of pis) {
        const part = partsById.get(String(pi.item_id))
        if (!part) continue
        const t = pi.transformation || {}
        const [tx, ty] = t.translation || [0, 0]
        const ring = placedRing(part, t.rotation, tx, ty)
        if (occ.some((other) => pairViolates(ring, other, space))) return false
    }
    return true
}

// W3 (vérif 2026-09-04, plan correctif 2 étape B) : relay de candidates
// (receveuse + donneuse) dans les bandes de l'ancre de la receveuse —
// ne restaure RIEN (l'appelant répartit les non-posées à leur tôle
// d'origine). min_poses=2 (bandes classiques, contrat A8).
function relayCandidatesInBands(layouts, recvI, candidates, partsById, sheetDimsOf, space, payload) {
    const recv = layouts[recvI]
    const [sw, sh] = sheetDimsOf(recv)
    let moved = 0
    let remaining = candidates.slice()
    const placedHas = (pi) => (recv.placed_items || []).some((x) => x === pi)
    while (remaining.length) {
        const used = layoutAabb(recv, partsById)
        if (!used) break
        const bl = residualBands(used, sw, sh, space)
        bl.sort((a, b) => (a.rect[0] - b.rect[0]) || (b.area - a.area))
        const n = fillOneBatch(layouts, recvI, recvI, partsById, sheetDimsOf,
            space, payload, remaining, bl, 2)
        if (!n) break
        moved += n
        remaining = remaining.filter((pi) => !placedHas(pi))
    }
    return { moved, remaining }
}

// W3 : remplissage inter-tôles + compaction receveuse FUSIONNÉS —
// candidates = libres de la receveuse + libres de la DONNEUSE, AVANT la
// compaction donneuse. Acceptation : count_receveuse_after ≥ before ;
// non-posées → tôle d'origine validées ; sinon restauration des 2 tôles.
function mergeFillCompactReceivers(layouts, donorI, partsById, sheetDimsOf, space, payload, stats = null) {
    if (!layouts || !layouts.length || donorI >= layouts.length) return 0
    const donor = layouts[donorI]
    let movedTotal = 0
    let mergedSheets = 0
    for (let recvI = 0; recvI < layouts.length; recvI++) {
        if (recvI === donorI) continue
        const recv = layouts[recvI]
        const { units, free: recvFree } = helixUnitsAndFree(recv, partsById)
        const donorFree = freePis(donor, partsById)
        const candidates = recvFree.concat(donorFree)
        if (!candidates.length) continue
        const recvBeforeCount = (recv.placed_items || []).length
        const snapRecv = JSON.parse(JSON.stringify(recv.placed_items || []))
        const snapDonor = JSON.parse(JSON.stringify(donor.placed_items || []))
        const recvFreeSet = new Set(recvFree)
        try {
            for (const pi of candidates) {
                recv.placed_items = (recv.placed_items || []).filter((x) => x !== pi)
                donor.placed_items = (donor.placed_items || []).filter((x) => x !== pi)
            }
            const { moved, remaining } = relayCandidatesInBands(
                layouts, recvI, candidates, partsById, sheetDimsOf, space, payload)
            const backRecv = remaining.filter((pi) => recvFreeSet.has(pi))
            const backDonor = remaining.filter((pi) => !recvFreeSet.has(pi))
            const snapRecvById = new Map(snapRecv.map((x) => [JSON.stringify([x.item_id, x.transformation]), x]))
            for (const pi of backRecv) {
                recv.placed_items.push(pi)
            }
            for (const pi of backDonor) {
                donor.placed_items.push(pi)
            }
            // validation des restaurations : les poses d'origine sont
            // légales par construction SAUF si les nouvelles colonnes les
            // recouvrent — batch validate par groupe.
            // W3 : validation de RETOUR — on ne re-juge ni les bornes ni
            // la légalité d'origine, seulement le chevauchement contre le
            // nouvel état (miroir _validate_return Python).
            if (backRecv.length && !validateReturn(backRecv, recv, partsById, space)) {
                throw COMPACT_ROLLBACK
            }
            if (backDonor.length && !validateReturn(backDonor, donor, partsById, space)) {
                throw COMPACT_ROLLBACK
            }
            if ((recv.placed_items || []).length < recvBeforeCount) {
                throw COMPACT_ROLLBACK
            }
            if (moved) {
                movedTotal += moved
                mergedSheets++
            }
        } catch (e) {
            if (e !== COMPACT_ROLLBACK && !(e && e.__compactFront)) throw e
            recv.placed_items = JSON.parse(JSON.stringify(snapRecv))
            donor.placed_items = JSON.parse(JSON.stringify(snapDonor))
        }
    }
    if (stats) stats.mergedReceivers = mergedSheets
    return movedTotal
}

// V3 (étape 3.1) : compaction des tôles RECEVEUSES — le moteur first-fit
// y remplit les bandes en désordre ; ancre = hôtes + nichées, libres =
// tout le reste re-posé derrière. Acceptation : front ≤ avant + 0,5 mm.
function compactReceivers(layouts, partsById, sheetDimsOf, space, payload, stats = null) {
    let movedTotal = 0
    let compacted = 0
    for (let sheetI = 0; sheetI < layouts.length; sheetI++) {
        const last = layouts[sheetI]
        const { units, free } = helixUnitsAndFree(last, partsById)
        if (!free.length) continue
        if (!sheetNeedsCompaction(last, units, free, partsById, space)) continue
        const before = layoutAabb(last, partsById)
        if (!before) continue
        const beforeCount = (last.placed_items || []).length
        const snapshot = JSON.parse(JSON.stringify(last.placed_items || []))
        try {
            const moved = relayFreesBehindAnchor(layouts, sheetI, free, [],
                partsById, sheetDimsOf, space, payload)
            const after = layoutAabb(last, partsById)
            const afterCount = (last.placed_items || []).length
            // W1 (vérif 2026-09-04) + §5.1 : invariant « jamais pire que
            // l'état d'entrée » — compte ET front (miroir Python).
            if ((after && after[2] > before[2] + 0.5) || afterCount < beforeCount) {
                last.placed_items = JSON.parse(JSON.stringify(snapshot))
                continue
            }
            if (moved) {
                movedTotal += moved
                compacted++
            }
        } catch (e) {
            if (e !== COMPACT_ROLLBACK) throw e
            last.placed_items = JSON.parse(JSON.stringify(snapshot))
        }
    }
    if (stats) stats.compactReceivers = compacted
    return movedTotal
}

// D6 (audit 2026-09-03) : sentinelle — le catch de compaction ne doit
// avaler QUE le rollback délibéré, JAMAIS une TypeError (c'est ainsi que
// le bug `const moved` est resté invisible).
export const COMPACT_ROLLBACK = Symbol('compact-rollback')

// W2 : rollback pour refus de FRONT (distinct de la restauration
// invalidée) — même contrat de sentinelle, raison différenciée.
function compactRollbackFront() {
    const e = new Error('compact rollback: front')
    e.__compactFront = true
    return e
}

// A2/A6 (audit 2026-09-03, bloquant) : snapshot complet AVANT le re-grid
// — l'ancien était pris APRÈS, un rollback restaurait les hôtes
// re-grillés SUR les libres d'origine. Sur échec : restauration COMPLÈTE,
// moved = 0, stats.compactRollback = true. Jamais moved > 0 après
// rollback.
export function compactLastSheet(layouts, sheetI, partsById, sheetDimsOf, space, payload, stats = null) {
    const last = layouts[sheetI]
    const [sw, sh] = sheetDimsOf(last)
    const { units, free } = helixUnitsAndFree(last, partsById)
    if (!units.length && !free.length) return 0
    if (!sheetNeedsCompaction(last, units, free, partsById, space)) return 0
    // W2 (vérif 2026-09-04) + §5.1 : front de RÉFÉRENCE = état d'entrée.
    const frontBefore = layoutAabb(last, partsById)
    const fullSnapshot = JSON.parse(JSON.stringify(last.placed_items || []))
    try {
        // Phase 1 : hélices re-grillées en colonnes depuis le bord gauche
        // (transformation rigide des fans nichées) — les poches des colonnes
        // partielles sont retournées pour la phase 2.
        let { moved, freeRects } = regridHelices(last, units, partsById, sw, sh, space, payload)
        if (!free.length) return moved
        const freeSet = new Set(free)
        const hasAnchor = (last.placed_items || []).some((pi) => !freeSet.has(pi))
        if (!hasAnchor) return moved
        moved += relayFreesBehindAnchor(layouts, sheetI, free, freeRects,
            partsById, sheetDimsOf, space, payload)
        // W2 : acceptation sur le front — l'état d'entrée était meilleur
        // → restauration complète avec raison 'front'.
        const frontAfter = layoutAabb(last, partsById)
        if (frontBefore && frontAfter && frontAfter[2] > frontBefore[2] + 0.5) {
            throw compactRollbackFront()
        }
        return moved
    } catch (e) {
        if (e !== COMPACT_ROLLBACK && !(e && e.__compactFront)) throw e
        // A2 : restauration COMPLÈTE de la tôle (hôtes + libres à leur
        // pose d'origine) — l'ancien rollback ne remettait que la liste
        // post-re-grid : les hôtes re-grillés recouvraient les libres
        // d'origine. moved = 0 : ce pass n'a rien produit.
        last.placed_items = JSON.parse(JSON.stringify(fullSnapshot))
        if (stats) {
            stats.compactRollback = true
            stats.compactRollbackReason = (e && e.__compactFront) ? 'front' : 'restore'
        }
        return 0
    }
}

/** D3 (audit 2026-09-03, miroir _has_non_quarter_rotation) :
 * rotatedBbox/rotateRing ne savent calculer que les quarts de tour —
 * toute rotation placée ou permise ≢ 0 mod 90 rend la validation JS
 * aveugle (anneaux faux → poses chevauchantes ACCEPTÉES, navigateur
 * seulement). L'UI autorise rotationCount 1..360 (45°, 30°…) : no-op
 * prudent + erreur tracée. */
export function hasNonQuarterRotation(parts, layouts, payload) {
    const isQuarter = (deg) => {
        const m = Math.abs(deg) % 90
        return m < 1e-6 || 90 - m < 1e-6
    }
    for (const part of parts || []) {
        for (const r of partRotations(part, payload)) {
            if (!isQuarter(Number(r) || 0)) return true
        }
    }
    for (const l of layouts || []) {
        for (const pi of l.placed_items || []) {
            if (!isQuarter(Number(pi.transformation?.rotation) || 0)) return true
        }
    }
    return false
}

export function fillResidualBands(parts, layouts, space, payload, stats = null) {
    // A5 (audit 2026-09-03) : `stats` (additif) reçoit residualMoved /
    // residualRounds / compactRollback / errors — le post-pass ne peut
    // plus échouer SILENCIEUSEMENT (miroir fill_residual_bands Python).
    if (!stats) stats = {}
    if (!layouts || layouts.length < 2) return 0
    const partsById = new Map(parts.map((p) => [String(p.id), p]))
    for (const l of layouts) {
        for (const pi of l.placed_items || []) {
            if (!partsById.has(String(pi.item_id))) return 0
        }
    }
    space = Math.max(0, Number(space) || 0)
    if (hasNonQuarterRotation(parts, layouts, payload)) {
        if (!Array.isArray(stats.errors)) stats.errors = []
        stats.errors.push({
            stage: 'residual',
            message: 'rotations non quart de tour : pass ignoré (bbox tournée non calculable, D3)',
        })
        console.error('[local] residual-band pass skipped: non-quarter rotations')
        return 0
    }
    const sheetDimsOf = (layout) => sheetDims(payload, layout.container_id ?? 0) || [0, 0]
    const snapshot = JSON.parse(JSON.stringify(layouts))
    try {
        let moved = 0
        stats.residualRounds = 1
        const ratios = layouts.map((l) => fillRatio(l, partsById, sheetDimsOf))
        let donorI = 0
        for (let i = 1; i < layouts.length; i++) {
            if (ratios[i] <= ratios[donorI]) donorI = i // tie → plus grand index
        }
        // W3 (plan correctif 2, étape B) : remplissage + receveuse
        // FUSIONNÉS, candidates = receveuse + donneuse, AVANT la
        // compaction donneuse.
        moved += mergeFillCompactReceivers(layouts, donorI, partsById,
            sheetDimsOf, space, payload, stats)
        const kept = layouts.filter((l) => (l.placed_items || []).length)
        if (kept.length !== layouts.length) {
            layouts.length = 0
            layouts.push(...kept)
        }
        // Compaction de la tôle la moins remplie (la donneuse) — le moteur
        // BPP ne la compacte pas dans la direction d'optimisation (constat
        // user 2026-09-02 « pas optimisé −X »). Uniquement s'il reste
        // PLUSIEURS tôles (contrat T8). Miroir Python.
        if (layouts.length >= 2) {
            const ratios2 = layouts.map((l) => fillRatio(l, partsById, sheetDimsOf))
            let last2 = 0
            for (let i = 1; i < layouts.length; i++) {
                if (ratios2[i] <= ratios2[last2]) last2 = i
            }
            moved += compactLastSheet(layouts, last2, partsById, sheetDimsOf, space, payload, stats)
        }
        stats.residualMoved = moved
        return moved
    } catch (e) {
        // Filet : alternative intacte (contrat applyHoleFill) — mais plus
        // en silence (A5) : erreur tracée + compteur.
        layouts.length = 0
        layouts.push(...JSON.parse(JSON.stringify(snapshot)))
        stats.residualMoved = 0
        if (!Array.isArray(stats.errors)) stats.errors = []
        stats.errors.push({ stage: 'residual', message: String(e && e.message || e) })
        console.error('residual-band pass failed, layouts restored', e)
        return 0
    }
}
