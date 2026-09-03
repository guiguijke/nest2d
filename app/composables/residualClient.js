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

/** Miroir de residual._pair_violates : d > 0 → rejet si d < space − ε
 * (planché ; les anneaux du payload JS sont DÉJÀ simplifiés à la
 * construction — même géométrie que le simplify Python, la double marge
 * 2×SIMPLIFY avalait space tout entier à space 0,1, D5) ; d == 0 → rejet
 * seulement si vrai chevauchement d'aire (contact permis, §8.1). */
export function pairViolates(ringA, ringB, space) {
    const d = ringDist(ringA, ringB)
    if (d > 0) {
        return d < Math.max(space - EPS, 1e-9)
    }
    return ringsOverlap(ringA, ringB)
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

export function fillOneBatch(layouts, dstI, srcI, partsById, sheetDimsOf, space, payload, freeArg = null, bands = null) {
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
        const minPoses = bands ? 1 : 2
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
            occupancy.push(placedRing(part2, t2.rotation, tx2, ty2))
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
            committed++
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
// D6 (audit 2026-09-03) : sentinelle — le catch de compaction ne doit
// avaler QUE le rollback délibéré, JAMAIS une TypeError (c'est ainsi que
// le bug `const moved` est resté invisible).
export const COMPACT_ROLLBACK = Symbol('compact-rollback')

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
        // Audit 2026-09-02 F1/F2 : les libres remplissent d'abord les POCHES
        // des colonnes partielles PUIS les bandes classiques. (Soir, « trou
        // haut-gauche ») GRAVITÉ −X : poches et bandes consommées par x0
        // croissant, recalculées après chaque batch — l'ancien tri par aire
        // envoyait tout dans la bande droite et laissait la bande haute
        // au-dessus de la grille d'hélices vide (miroir exact du Python).
        const pocketBands = freeRects
            .map((r, i) => ({ name: `pocket${i}`, rect: r, axis: 'x' }))
            .sort((a, b) => (a.rect[0] - b.rect[0]) || a.name.localeCompare(b.name))
        let pocketsLeft = pocketBands.length > 0
        let bands = pocketsLeft ? pocketBands : null
        // Phase 2 : libres détachées puis re-posées en lattice derrière la
        // grille des hélices (bandes autour de l'ancre = AABB des non-libres).
        const savedPoses = new Map(free.map((pi) => [pi, { ...pi.transformation }]))
        const placedHas = (pi) => (last.placed_items || []).some((x) => x === pi)
        last.placed_items = (last.placed_items || []).filter((pi) => !freeSet.has(pi))
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
                // Poches épuisées (ou absentes) : bascule unique vers les
                // bandes classiques, puis arrêt au premier échec.
                if (pocketsLeft) {
                    pocketsLeft = false
                    bands = null
                    continue
                }
                break
            }
            moved += n
            if (!pocketsLeft) bands = null // recalcul −X au tour suivant
        }
        // Libres non replacées (capacité < donneuses) : retour à la pose
        // d'origine — validé contre le layout final, les nouvelles colonnes
        // ont pu recouvrir leur ancienne position.
        const restore = free.filter((pi) => !placedHas(pi))
        for (const pi of restore) {
            pi.transformation = savedPoses.get(pi)
            ;(last.placed_items || (last.placed_items = [])).push(pi)
        }
        if (restore.length && !validateBatch(restore, last, partsById, sw, sh, space)) {
            throw COMPACT_ROLLBACK
        }
        return moved
    } catch (e) {
        if (e !== COMPACT_ROLLBACK) throw e
        // A2 : restauration COMPLÈTE de la tôle (hôtes + libres à leur
        // pose d'origine) — l'ancien rollback ne remettait que la liste
        // post-re-grid : les hôtes re-grillés recouvraient les libres
        // d'origine. moved = 0 : ce pass n'a rien produit.
        last.placed_items = JSON.parse(JSON.stringify(fullSnapshot))
        if (stats) stats.compactRollback = true
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
        for (let round = 0; round < N_ITER; round++) {
            stats.residualRounds = round + 1
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
        // Compaction de la tôle la moins remplie (la donneuse) : le moteur
        // BPP ne la compacte pas dans la direction d'optimisation — sans
        // ça la « chute » est un amas dispersé à front dentelé (constat
        // user 2026-09-02 « pas optimisé −X »). Miroir de
        // residual._compact_last_sheet.
        // Uniquement s'il reste PLUSIEURS tôles : une tôle unique = la
        // donneuse a été vidée et retirée, rien à compacter (contrat T8).
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
