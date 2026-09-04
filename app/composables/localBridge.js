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
import { ringCentroid } from './structureClient'

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
// ---- J-085 post-pass hole-fill (miroir de workers/nesting/core/holefill.py) ----
const _pin = (p, ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]; const [xj, yj] = ring[j]
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}
const _placedPoly = (coords, rotDeg, tx, ty) => {
    const r = (rotDeg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r)
    return coords.map(([x, y]) => [c * x - s * y + tx, s * x + c * y + ty])
}
// D11 (audit 2026-09-03) : centroïde d'AIRE (miroir shapely .centroid) —
// la moyenne des sommets diverge près d'un bord de trou.
const _centroid = (ring) => ringCentroid(ring)
const _ptSeg = (p, a, b) => {
    const abx = b[0] - a[0]; const aby = b[1] - a[1]
    const l2 = abx * abx + aby * aby
    let t = l2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const qx = a[0] + t * abx; const qy = a[1] + t * aby
    return Math.hypot(p[0] - qx, p[1] - qy)
}
// distance min poly→anneau (sommet↔segment croisés)
const _polyRingDist = (poly, ring) => {
    let best = Infinity
    for (const p of poly) {
        for (let i = 0; i < ring.length - 1; i++) best = Math.min(best, _ptSeg(p, ring[i], ring[i + 1]))
    }
    return best
}
const _polyPolyDist = (a, b) => {
    let best = Infinity
    for (const p of a) for (let i = 0; i < b.length - 1; i++) best = Math.min(best, _ptSeg(p, b[i], b[i + 1]))
    for (const p of b) for (let i = 0; i < a.length - 1; i++) best = Math.min(best, _ptSeg(p, a[i], a[i + 1]))
    return best
}
const PINWHEEL = [0, 90, 180, 270]
const CAPACITY = 4
const PACK_GRID = 8
const PACK_BUDGET_MS = 400
const _SPACE_EPS = 1e-6

function _itemCoords(item) {
    return item?.coords || item?.coordinates || []
}

function _jsPinwheelCapacity(holeRing, fillerCoords, space, allowed) {
    const rots = PINWHEEL.filter((r) => !allowed || allowed.includes(r))
    const c = _centroid(holeRing)
    const valid = []
    const placed = []
    for (const rot of rots) {
        const cand = _placedPoly(fillerCoords, rot, c[0], c[1])
        if (!cand.every((v) => _pin(v, holeRing)) || _polyRingDist(cand, holeRing) < space - _SPACE_EPS) continue
        if (placed.some((q) => _polyPolyDist(cand, q) + _SPACE_EPS < space)) continue
        valid.push(rot)
        placed.push(cand)
    }
    return valid
}

/** Maximise l'aire de fillers dans un trou. Repli pinwheel si le glouton
 * n'améliore pas ou si `deadlineMs` est dépassé. */
export function packHole(holeRing, candidates, space, deadlineMs) {
    const margin = Math.max(0, Number(space) || 0)
    const c = _centroid(holeRing)
    const timedOut = () => deadlineMs != null && Date.now() > deadlineMs

    const tryPose = (coords, rot, tx, ty, placed) => {
        const cand = _placedPoly(coords, rot, tx, ty)
        if (!cand.every((v) => _pin(v, holeRing))) return null
        if (margin > 0 && _polyRingDist(cand, holeRing) < margin - _SPACE_EPS) return null
        if (placed.some((q) => _polyPolyDist(cand, q) + _SPACE_EPS < margin)) return null
        return cand
    }

    let best = []
    let bestArea = 0
    for (const cand of candidates || []) {
        if ((cand.remaining || 0) <= 0) continue
        const rots = _jsPinwheelCapacity(holeRing, cand.coords, margin, cand.rotations)
        const n = Math.min(rots.length, cand.remaining)
        if (n <= 0) continue
        const area = n * cand.area
        if (area > bestArea) {
            bestArea = area
            best = rots.slice(0, n).map((rot) => ({
                fillId: cand.id, rot, lx: c[0], ly: c[1], area: cand.area,
            }))
        }
    }
    if (timedOut()) return best
    // Un seul type de filler + pinwheel déjà utile : le glouton grille
    // n'améliore pas (cas x4) et coûte trop sur N hôtes.
    const activeTypes = (candidates || []).filter((c) => (c.remaining || 0) > 0)
    if (activeTypes.length <= 1 && best.length > 0) return best

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of holeRing) {
        if (p[0] < minX) minX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] > maxY) maxY = p[1]
    }
    const positions = () => {
        const out = [[c[0], c[1]]]
        if (maxX > minX && maxY > minY) {
            for (let i = 0; i < PACK_GRID; i++) {
                for (let j = 0; j < PACK_GRID; j++) {
                    out.push([
                        minX + (i + 0.5) * (maxX - minX) / PACK_GRID,
                        minY + (j + 0.5) * (maxY - minY) / PACK_GRID,
                    ])
                }
            }
        }
        return out
    }

    const stock = Object.fromEntries((candidates || []).map((x) => [x.id, x.remaining || 0]))
    const order = [...(candidates || [])].sort((a, b) => b.area - a.area)
    const greedy = []
    const greedyPolys = []
    const pts = positions()
    let progressed = true
    while (progressed && !timedOut()) {
        progressed = false
        for (const cand of order) {
            if ((stock[cand.id] || 0) <= 0) continue
            const rots = cand.rotations?.length ? cand.rotations : PINWHEEL
            let placedOne = false
            for (const rot of rots) {
                for (const [tx, ty] of pts) {
                    const poly = tryPose(cand.coords, rot, tx, ty, greedyPolys)
                    if (!poly) continue
                    greedy.push({ fillId: cand.id, rot, lx: tx, ly: ty, area: cand.area })
                    greedyPolys.push(poly)
                    stock[cand.id] -= 1
                    placedOne = true
                    progressed = true
                    break
                }
                if (placedOne || timedOut()) break
            }
            if (timedOut()) break
        }
    }
    const greedyArea = greedy.reduce((n, p) => n + p.area, 0)
    return greedyArea > bestArea + 1e-9 ? greedy : best
}

function _fillCandidates(fillItems, stock) {
    const out = []
    for (const it of fillItems) {
        const rem = stock[it.id] || 0
        if (rem <= 0) continue
        const coords = _itemCoords(it)
        out.push({
            id: it.id,
            coords,
            rotations: it.rotations?.length ? it.rotations : PINWHEEL,
            remaining: rem,
            area: _partArea(it),
        })
    }
    return out
}

function _planLegacyFullPinwheel(inputItems, space) {
    const hosts = inputItems.filter((i) => (i.holes || []).length)
    const fills = inputItems.filter((i) => !(i.holes || []).length)
    if (hosts.length !== 1 || fills.length !== 1) return null
    const host = hosts[0]
    const fill = fills[0]
    const allowed = (fill.rotations || PINWHEEL).filter((r) => PINWHEEL.includes(r))
    const ringRotations = (host.holes || []).map((ring) =>
        _jsPinwheelCapacity(ring, _itemCoords(fill), space, allowed),
    )
    const capacity = ringRotations.reduce((n, rr) => n + rr.length, 0)
    const full = ringRotations.length > 0 && ringRotations.every((rr) => rr.length === allowed.length)
    if (!capacity || !full) return null
    const hostQty = host.count || 1
    const fillQty = fill.count || 0
    const slots = []
    let remaining = fillQty
    for (let h = 0; h < hostQty; h++) {
        const k = Math.min(capacity, remaining)
        slots.push(k)
        remaining -= k
    }
    const area = _partArea(fill)
    const packs = slots.map((k) => {
        const poses = []
        let left = k
        for (let ri = 0; ri < (host.holes || []).length && left > 0; ri++) {
            const [cx, cy] = _centroid(host.holes[ri])
            for (const rot of ringRotations[ri] || []) {
                if (left <= 0) break
                poses.push({ fillId: fill.id, rot, lx: cx, ly: cy, area })
                left -= 1
            }
        }
        return { hostId: host.id, fills: poses }
    })
    return packs.some((p) => p.fills.length) ? packs : null
}

function _planGeneric(inputItems, space, deadlineMs) {
    const hosts = inputItems.filter((i) => (i.holes || []).length)
    const fills = inputItems.filter((i) => !(i.holes || []).length)
    if (!hosts.length || !fills.length) return null
    const stock = Object.fromEntries(fills.map((i) => [i.id, i.count || 0]))
    const packs = []
    for (const host of hosts) {
        for (let n = 0; n < (host.count || 0); n++) {
            const poses = []
            for (const ring of host.holes || []) {
                if (deadlineMs != null && Date.now() > deadlineMs) break
                const cands = _fillCandidates(fills, stock)
                if (!cands.length) break
                const seen = new Set()
                const uniq = []
                for (const c of cands) {
                    if (seen.has(c.id)) continue
                    seen.add(c.id)
                    uniq.push(c)
                }
                for (const pose of packHole(ring, uniq, space, deadlineMs)) {
                    if ((stock[pose.fillId] || 0) <= 0) continue
                    stock[pose.fillId] -= 1
                    poses.push(pose)
                }
            }
            packs.push({ hostId: host.id, fills: poses })
        }
    }
    return packs.some((p) => p.fills.length) ? packs : null
}

function _packsArea(packs) {
    return (packs || []).reduce((n, p) => n + (p.fills || []).reduce((a, f) => a + (f.area || 0), 0), 0)
}

/** Plan de remplissage (packs) ou null. Repli J-085 si le générique lève /
 * est plus pauvre / dépasse le budget. */
export function planHoleFills(inputItems, space, budgetMs = PACK_BUDGET_MS) {
    if (!inputItems?.length) return null
    const deadline = Date.now() + Math.max(50, budgetMs)
    let generic = null
    try {
        generic = _planGeneric(inputItems, space, deadline)
    } catch {
        generic = null
    }
    let legacy = null
    try {
        legacy = _planLegacyFullPinwheel(inputItems, space)
    } catch {
        legacy = null
    }
    if (_packsArea(legacy) > _packsArea(generic) + 1e-9) return legacy
    return generic || legacy
}

export function reduceForSolve(inputItems, jaguarItems, packs, space = 0) {
    const used = {}
    const closed = new Set()
    for (const pack of packs || []) {
        if (pack.fills?.length) closed.add(pack.hostId)
        for (const f of pack.fills || []) used[f.fillId] = (used[f.fillId] || 0) + 1
    }
    const reduced = []
    const idMap = []
    for (let i = 0; i < inputItems.length; i++) {
        const it = inputItems[i]
        const ji = jaguarItems[i]
        const d = (ji.demand || 0) - (used[it.id] || 0)
        if (d <= 0) continue
        const entry = { ...ji, demand: d, id: reduced.length }
        if (closed.has(it.id)) {
            entry.shape = { type: 'simple_polygon', data: it.coords }
        }
        reduced.push(entry)
        idMap.push(it.id)
    }
    const hostIds = new Set((packs || []).map((p) => p.hostId))
    const fillIds = new Set((packs || []).flatMap((p) => (p.fills || []).map((f) => f.fillId)))
    if (hostIds.size === 1 && fillIds.size === 1) {
        const hid = [...hostIds][0]
        const fid = [...fillIds][0]
        const host = inputItems.find((i) => i.id === hid)
        const fill = inputItems.find((i) => i.id === fid)
        const allowed = fill?.rotations?.length ? fill.rotations : PINWHEEL
        const ringRotations = (host?.holes || []).map((ring) =>
            _jsPinwheelCapacity(ring, _itemCoords(fill), space, allowed),
        )
        return {
            meta: {
                host: hid,
                fill: fid,
                slots: (packs || []).map((p) => (p.fills || []).length),
                ringRotations,
                idMap,
            },
            reduced,
        }
    }
    return { meta: { packs, idMap }, reduced }
}

export function expandPacks(parts, packs, layouts) {
    const unused = [...(packs || [])]
    for (const layout of layouts) {
        const added = []
        for (const pi of layout.placed_items || []) {
            const idx = unused.findIndex((p) => p.hostId === pi.item_id || String(p.hostId) === String(pi.item_id))
            if (idx < 0) continue
            const pack = unused.splice(idx, 1)[0]
            const t = pi.transformation || {}
            const hrot = t.rotation ?? 0
            const hx = t.translation?.[0] ?? 0
            const hy = t.translation?.[1] ?? 0
            const r = (hrot * Math.PI) / 180
            const cosR = Math.cos(r)
            const sinR = Math.sin(r)
            for (const f of pack.fills || []) {
                const wx = cosR * f.lx - sinR * f.ly + hx
                const wy = sinR * f.lx + cosR * f.ly + hy
                added.push({
                    item_id: Number(f.fillId),
                    transformation: { rotation: hrot + f.rot, translation: [wx, wy] },
                })
            }
        }
        layout.placed_items = [...(layout.placed_items || []), ...added]
    }
    return layouts
}

/** Recomplète chaque trou en pinwheel après le solve (rien ne le défait).
 * Mutate les transforms des layouts ; déterministe. Miroir de holefill.py.
 * Validation = promesse exacte du moteur (piège #3) : marge `space` à la
 * paroi du trou et entre fillers (l'inflation ±space/2 des deux côtés). */
export function applyHoleFill(parts, layouts, space) {
    // D3 (audit 2026-09-03) : garde non-quart-de-tour — rotateRing traite
    // tout angle non multiple de 90 comme 270 : la validation comparerait
    // des anneaux FAUX et accepterait des poses chevauchantes.
    const isQuarter = (deg) => {
        const m = Math.abs(deg) % 90
        return m < 1e-6 || 90 - m < 1e-6
    }
    for (const part of parts || []) {
        for (const r of (part.rotations?.length ? part.rotations : [0, 90, 180, 270])) {
            if (!isQuarter(Number(r) || 0)) return 0
        }
    }
    for (const l of layouts || []) {
        for (const pi of l.placed_items || []) {
            if (!isQuarter(Number(pi.transformation?.rotation) || 0)) return 0
        }
    }
    const margin = Math.max(0, Number(space) || 0)
    const byId = new Map(parts.map((p) => [String(p.id), p]))
    // BPP : scopé PAR TÔLE (2026-09-01) — les layouts BPP partagent le
    // repère de coordonnées ; pooler trous/libres à travers les tôles
    // laissait nestedHole classer un fan d'une tôle comme occupant du trou
    // coïncidant d'une AUTRE, et le repli pinwheel posait deux jeux de
    // poses canoniques au même point (« jumeaux » à pose identique) en
    // téléportant des fans entre tôles. SPP (un layout) : inchangé.
    // Miroir de holefill._fill_one_sheet_holes.
    const deadline = Date.now() + PACK_BUDGET_MS
    let recovered = 0
    for (const layout of layouts) {
        recovered += _fillOneSheetHoles(layout, byId, margin, deadline)
    }
    return recovered
}

function _fillOneSheetHoles(layout, byId, margin, deadline) {
    const entries = [] // {item, pi, poly}
    for (const pi of layout.placed_items || []) {
        const item = byId.get(String(pi.item_id))
        if (!item) continue
        const t = pi.transformation || {}
        entries.push({ item, pi, poly: _placedPoly(item.coords, t.rotation ?? 0, ...(t.translation || [0, 0])) })
    }
    const holes = [] // {holeRing(world), members[], }
    for (const e of entries) {
        if (!(e.item.holes || []).length) continue
        const t = e.pi.transformation || {}
        for (const h of e.item.holes) {
            holes.push({ ring: _placedPoly(h, t.rotation ?? 0, ...(t.translation || [0, 0])), members: [] })
        }
    }
    const nestedHole = (poly) => {
        const c = _centroid(poly)
        return holes.findIndex((h) => _pin(c, h.ring))
    }
    const free = []
    for (const e of entries) {
        if ((e.item.holes || []).length) continue
        const hi = nestedHole(e.poly)
        if (hi < 0) free.push(e)
        else holes[hi].members.push(e)
    }
    let recovered = 0
    // Capacité pinwheel VALIDÉE du trou pour ce type de filler, à
    // l'espacement courant (jamais la capacité théorique) — miroir de
    // holefill.hole_capacity.
    const holeCapacity = (ring, fillItem) => {
        const allowed = fillItem.rotations?.length ? fillItem.rotations : PINWHEEL
        return _jsPinwheelCapacity(ring, _itemCoords(fillItem), margin, allowed).length
    }
    // Écarte les poses en conflit avec les fillers DÉJÀ dans le trou
    // (pré-nichés par l'expansion méta-pièces) : packHole valide contre un
    // trou VIDE — sans ça il retéléporte sur les poses canoniques occupées,
    // double-remplissage (cas trou600 : jumeaux au µm près). Miroir de
    // holefill.drop_occupied.
    const dropOccupied = (h, poses) => {
        if (!h.members.length) return poses
        const lim = margin > 0 ? margin + _SPACE_EPS : _SPACE_EPS
        return poses.filter((pose) => {
            const item = byId.get(String(pose.fillId))
            if (!item) return false
            const cand = _placedPoly(_itemCoords(item), pose.rot, pose.lx, pose.ly)
            return !h.members.some((m) => _polyPolyDist(cand, m.poly) < lim)
        })
    }
    for (const h of holes) {
        if (!free.length) break
        // Trou déjà à capacité validée (fillers pré-nichés) : no-op —
        // re-packer dupliquerait les occupants (trou600).
        if (h.members.length
            && h.members.length >= Math.max(...h.members.map((m) => holeCapacity(h.ring, m.item)))) {
            continue
        }
        const stock = {}
        for (const e of free) stock[e.item.id] = (stock[e.item.id] || 0) + 1
        const cands = _fillCandidates(free.map((e) => e.item), stock)
        const seen = new Set()
        const uniq = []
        for (const c of cands) {
            if (seen.has(c.id)) continue
            seen.add(c.id)
            uniq.push(c)
        }
        let poses = uniq.length ? packHole(h.ring, uniq, margin, deadline) : []
        if (poses.length) poses = dropOccupied(h, poses)
        if (poses.length) {
            const freeByItem = new Map()
            for (const e of free) {
                const list = freeByItem.get(e.item.id) || []
                list.push(e)
                freeByItem.set(e.item.id, list)
            }
            for (const pose of poses) {
                const pool = freeByItem.get(pose.fillId) || []
                if (!pool.length) continue
                const e = pool.shift()
                e.pi.transformation.rotation = pose.rot
                e.pi.transformation.translation = [pose.lx, pose.ly]
                e.poly = _placedPoly(_itemCoords(e.item), pose.rot, pose.lx, pose.ly)
                const fi = free.indexOf(e)
                if (fi >= 0) {
                    free.splice(fi, 1)
                    h.members.push(e) // occupe le trou (parité _apply_poses)
                    recovered++
                }
            }
            continue
        }
        const cur = h.members
        if (cur.length >= CAPACITY || free.length < CAPACITY - cur.length) continue
        const c = _centroid(h.ring)
        const pool = [...cur, ...free.slice(0, CAPACITY - cur.length)]
        const polys = []
        let ok = true
        for (let i = 0; i < pool.length; i++) {
            const cand = _placedPoly(pool[i].item.coords, PINWHEEL[i], c[0], c[1])
            if (!cand.every((v) => _pin(v, h.ring)) || _polyRingDist(cand, h.ring) < margin) { ok = false; break }
            if (polys.some((q) => _polyPolyDist(cand, q) < margin)) { ok = false; break }
            polys.push(cand)
        }
        if (!ok) continue
        pool.forEach((e, i) => {
            e.pi.transformation.rotation = PINWHEEL[i]
            e.pi.transformation.translation = [c[0], c[1]]
            e.poly = polys[i]
            const fi = free.indexOf(e)
            if (fi >= 0) { free.splice(fi, 1); recovered++ }
        })
    }
    return recovered
}

/** J-085 expansion meta-pièces (miroir de core/holefill.py expand_meta) :
 * rattache les fillers figés (pinwheel validé) aux hôtes posés par le solve
 * réduit. world_f = R(hrot+frot)·x + (R(hrot)·C + ht). Les slots d'un hôte
 * sont distribués anneau par anneau dans l'ordre, en n'utilisant que les
 * rotations validées côté serveur (ringRotations). Déterministe. */
export function expandMeta(parts, hostId, fillId, slots, layouts, ringRotations = null) {
    const host = parts.find((p) => String(p.id) === String(hostId))
    if (!host || !(host.holes || []).length) return layouts
    const rings = host.holes
    const rrots = ringRotations || rings.map(() => [...PINWHEEL])
    let hi = 0
    for (const layout of layouts) {
        const added = []
        for (const pi of layout.placed_items || []) {
            if (String(pi.item_id) !== String(hostId)) continue
            const t = pi.transformation || {}
            const hrot = t.rotation ?? 0
            let budget = slots?.[hi] ?? 0
            hi++
            const r = (hrot * Math.PI) / 180
            const cosR = Math.cos(r)
            const sinR = Math.sin(r)
            for (let ri = 0; ri < rings.length && budget > 0; ri++) {
                const c = _centroid(rings[ri])
                const rx = cosR * c[0] - sinR * c[1] + (t.translation?.[0] ?? 0)
                const ry = sinR * c[0] + cosR * c[1] + (t.translation?.[1] ?? 0)
                for (const frot of rrots[ri] || []) {
                    if (budget <= 0) break
                    added.push({ item_id: Number(fillId), transformation: { rotation: hrot + frot, translation: [rx, ry] } })
                    budget--
                }
            }
        }
        layout.placed_items = [...(layout.placed_items || []), ...added]
    }
    return layouts
}

function _ringArea(ring) {
    if (!ring || ring.length < 3) return 0
    let a = 0
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        a += x1 * y2 - x2 * y1
    }
    return Math.abs(a) * 0.5
}

function _partArea(part) {
    const coords = part?.coords || part?.coordinates || []
    const holes = part?.holes || []
    return _ringArea(coords) - holes.reduce((s, h) => s + _ringArea(h), 0)
}

/** Centroïde d'AIRE d'un anneau (shoelace — même formule que
 * nest-report::ring_centroid, la classification « dans le trou » du rapport
 * wasm ; repli sur la moyenne des sommets si l'anneau est dégénéré). */
const _ringAreaCentroid = (ring) => {
    let a = 0; let cx = 0; let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
        const cr = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
        a += cr
        cx += (ring[i][0] + ring[i + 1][0]) * cr
        cy += (ring[i][1] + ring[i + 1][1]) * cr
    }
    a /= 2
    if (!a) return _centroid(ring)
    return [cx / (6 * a), cy / (6 * a)]
}

/** D7 (audit 2026-09-03) : gate de trou IDENTIQUE au serveur (main.py
 * has_holes). Le payload local porte désormais hasHoles/fillHoles ; les
 * vieux payloads repliquent le calcul client (fillHoles explicite +
 * présence de trous) — le navigateur remplissait les trous d'un payload
 * préparé trous fermés (space > 2,4 : canneaux scellés) alors que le
 * serveur ne le fait pas. */
export function holesGateOpen(payload, parts) {
    if (payload?.hasHoles != null) return payload.hasHoles === true
    if (payload?.fillHoles === false) return false
    return (parts || []).some((p) => (p?.holes || []).length > 0)
}

/** Miroir de metrics.per_class_counts_match (A4, audit 2026-09-03) : la
 * garde anti-perte comparait le TOTAL — un doublon + une perte compensée
 * passaient. Conteneurs wasm {transforms:[{item_id}]} contre les comptes
 * demandés par part (clé String(id), comme partsById). */
export function perClassCountsMatch(containers, requestedById) {
    const placed = new Map()
    for (const c of containers || []) {
        for (const t of c?.transforms || []) {
            const k = String(t.item_id)
            placed.set(k, (placed.get(k) || 0) + 1)
        }
    }
    if (placed.size !== requestedById.size) return false
    for (const [k, want] of requestedById) {
        if (placed.get(k) !== want) return false
    }
    return true
}

/** Miroir du plafonnage metrics.verify_layout (d57cbea) : occupants par trou
 * (centroïde d'aire de l'anneau externe posé dans l'anneau du trou, premier
 * hôte retenu) → filled = Σ min(n, CAPACITY) ; l'excédent part dans
 * `overflow` (champ additif holesOverflow, piège #19b — un post-pass buggé a
 * déjà empilé 8 fillers dans un trou prévu pour 4, cas trou600). */
export function holesFillCap(containers, partsById) {
    let filled = 0
    let overflow = 0
    for (const c of containers || []) {
        const polys = []
        const holeRings = [] // { hostIdx, ring } en coords MONDE
        for (const t of c?.transforms || []) {
            const part = partsById.get(String(t.item_id))
            if (!part) continue
            const idx = polys.length
            const deg = ((Number(t.angle) || 0) * 180) / Math.PI
            polys.push(_placedPoly(_itemCoords(part), deg, t.x || 0, t.y || 0))
            for (const h of part.holes || []) {
                holeRings.push({ hostIdx: idx, ring: _placedPoly(h, deg, t.x || 0, t.y || 0) })
            }
        }
        const occupants = new Array(holeRings.length).fill(0)
        polys.forEach((poly, idx) => {
            const c0 = _ringAreaCentroid(poly)
            for (let hi = 0; hi < holeRings.length; hi++) {
                if (holeRings[hi].hostIdx === idx) continue
                if (_pin(c0, holeRings[hi].ring)) { occupants[hi]++; break }
            }
        })
        for (const n of occupants) {
            filled += Math.min(n, CAPACITY)
            overflow += Math.max(0, n - CAPACITY)
        }
    }
    return { filled, overflow }
}

function _cloneLiveLayouts(items) {
    const isBpp = items.some((raw) => Array.isArray(raw) && raw.length >= 5)
    const byBin = new Map()
    for (const raw of items) {
        let id, bin, rot, x, y
        if (raw.length >= 5) [id, bin, rot, x, y] = raw
        else {
            [id, rot, x, y] = raw
            bin = 0
        }
        if (!byBin.has(bin)) byBin.set(bin, { placed_items: [] })
        byBin.get(bin).placed_items.push({
            item_id: id,
            transformation: { rotation: rot, translation: [x, y] },
        })
    }
    const bins = [...byBin.keys()].sort((a, b) => a - b)
    return { isBpp, bins, layouts: bins.map((b) => byBin.get(b)) }
}

function _layoutsToLiveItems(layouts, bins, isBpp) {
    const out = []
    layouts.forEach((layout, i) => {
        const bin = bins[i] ?? i
        for (const pi of layout.placed_items || []) {
            const t = pi.transformation || {}
            const tr = t.translation || [0, 0]
            const rot = t.rotation ?? 0
            if (isBpp) out.push([pi.item_id, bin, rot, tr[0], tr[1]])
            else out.push([pi.item_id, rot, tr[0], tr[1]])
        }
    })
    return out
}

/**
 * J-085 on a live engine snapshot: remap is already applied by the
 * caller. Clones items, expands meta-pieces, relocates free fillers into
 * holes, and measures density so the atelier matches the result modal
 * *during* the search (not only after finalization).
 */
export function decorateLiveLayout(evt, payload) {
    if (!evt || !Array.isArray(evt.items) || !evt.items.length) return evt
    const parts = payload?.parts || []
    if (!parts.length) return evt
    try {
        const { isBpp, bins, layouts } = _cloneLiveLayouts(evt.items)
        let holesFilled = 0
        if (payload?.meta) {
            const before = layouts.reduce((n, l) => n + (l.placed_items?.length || 0), 0)
            if (payload.meta.packs) {
                expandPacks(parts, payload.meta.packs, layouts)
            } else {
                expandMeta(
                    parts,
                    payload.meta.host,
                    payload.meta.fill,
                    payload.meta.slots,
                    layouts,
                    payload.meta.ringRotations,
                )
            }
            holesFilled += layouts.reduce((n, l) => n + (l.placed_items?.length || 0), 0) - before
        }
        const space = Number(payload?.engineConfig?.min_item_separation) || 0
        // fillHoles=false (promesse UI « keep cutouts empty ») : pas de
        // post-pass de déplacement des fillers vers les trous — le serveur
        // gate déjà le sien via has_holes (main.py). D7 : gate hasHoles.
        if (holesGateOpen(payload, parts)) {
            holesFilled += applyHoleFill(parts, layouts, space) || 0
        }
        const items = _layoutsToLiveItems(layouts, bins, isBpp)
        const byId = new Map(parts.map((p) => [String(p.id), p]))
        let partsArea = 0
        const usedBins = new Set()
        for (const raw of items) {
            const part = byId.get(String(raw[0]))
            if (part) partsArea += _partArea(part)
            if (isBpp) usedBins.add(raw[1])
        }
        const sheets = evt.sheets || []
        const w = Number(sheets[0]?.[0]) || 0
        const h = Number(sheets[0]?.[1]) || 0
        const nSheets = Math.max(1, usedBins.size || 1)
        const sheetArea = w * h * nSheets
        // SPP : quand la frame porte une bande qui TIENT dans la tôle, la
        // densité affichée est celle du moteur sur la bande utilisée — même
        // échelle que le modal (pièces/bande). La densité pièces/tôle-entière
        // est constante pour un job donné (55,4 % sur le cas 100+800 quel
        // que soit le packing) : elle reste le repli des frames hors-tôle
        // et des bundles wasm antérieurs au champ used_height.
        const bandW = Number(evt.strip_width)
        const bandOk = !isBpp && Number.isFinite(bandW) && bandW > 0 && w > 0 && bandW <= w + 0.5
        const density = bandOk
            ? (evt.density ?? (sheetArea > 0 ? partsArea / sheetArea : null))
            : (sheetArea > 0 ? partsArea / sheetArea : (evt.density ?? null))
        return { ...evt, items, holesFilled, density }
    } catch {
        return evt
    }
}

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
            // Alternative structurelle AUTO-SUFFISANTE (constat 2026-08-29) :
            // ids d'origine + trous déjà remplis par le pass grille. Le remap
            // idMap CORROMPRait ses ids (un id d'origine indexé comme id
            // réduit), l'expansion meta doublerait les fillers, et
            // applyHoleFill téléporterait les fans des zones vers les trous
            // restés vides — tout l'aval est sauté pour CETTE alternative.
            const selfContained = Boolean(alt.structural && alt.selfContained)
            // J-085 : si le solve était réduit (meta-pièces), les placements
            // portent les ids RÉINDEXÉS de l'instance réduite — remap vers
            // les ids d'origine (idMap) puis rattache les fillers figés aux
            // hôtes ; puis post-pass de sécurité (no-op si trous déjà
            // pleins) — parité serveur.
            let expandedCount = 0
            if (payload?.meta && !selfContained) {
                const idMap = payload.meta.idMap
                if (Array.isArray(idMap)) {
                    for (const layout of layouts) {
                        for (const pi of layout.placed_items || []) {
                            const mapped = idMap[pi.item_id]
                            if (mapped != null) pi.item_id = mapped
                        }
                    }
                }
                const nBefore = layouts.reduce(
                    (n, l) => n + (l.placed_items?.length || 0), 0)
                if (payload.meta.packs) {
                    expandPacks(parts, payload.meta.packs, layouts)
                } else {
                    expandMeta(parts, payload.meta.host, payload.meta.fill, payload.meta.slots, layouts, payload.meta.ringRotations)
                }
                // V18 : pièces rattacchées par l'expansion (miroir du
                // compteur main.py).
                expandedCount = layouts.reduce(
                    (n, l) => n + (l.placed_items?.length || 0), 0) - nBefore
            }
            // A5 (audit 2026-09-03) : traçabilité des post-pass (additif,
            // miroir de engine_alt.postPass côté main.py) — plus de pass
            // muet : expandMeta compté, holeFillRecovered = relocations,
            // residual stats (moved/rounds/rollback/errors).
            let holeFillRecovered = 0
            if (!selfContained && holesGateOpen(payload, parts)) {
                holeFillRecovered = applyHoleFill(parts, layouts, space)
            }
            const postPass = {
                // V18 : expandMeta = pièces RATTACHÉES par l'expansion meta
                // (comptées dans le bloc d'exptraction ci-dessus) —
                // holeFillRecovered est des RELOCATIONS, pas des ajouts.
                expandMeta: expandedCount,
                holeFillRecovered,
                residualMoved: 0, residualRounds: 0,
                compactRollback: false, errors: [],
            }
            // D-MOT-19 : bandes résiduelles BPP (miroir core/residual.py) —
            // APRÈS hole-fill (les trous sont de meilleurs emplacements),
            // AVANT SVG/rapport/DXF sinon le livrable ignore le pass.
            if (!selfContained && !alt.structural
                && ((payload?.problem || 'spp') !== 'spp' || layouts.length >= 2)) {
                const { fillResidualBands } = await import('./residualClient')
                fillResidualBands(parts, layouts, space, payload, postPass)
                // A13 (audit 2026-09-03) : le pass résidiel déplace des
                // libres entre tôles — un trou resté vide sur une tôle sans
                // libre peut devenir remplissable. Deuxième hole-fill,
                // scopé tôle (piège #52). Miroir main.py.
                if (holesGateOpen(payload, parts)) {
                    postPass.holeFillRecovered += applyHoleFill(parts, layouts, space) || 0
                }
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
            // Plafonnage holesFilled + holesOverflow (miroir verify_layout
            // d57cbea) : le bundle wasm compte sans plafond — un double-
            // remplissage passerait silencieusement (cas trou600).
            if (report && !report.error && report.verify) {
                const { filled, overflow } = holesFillCap(containers, partsById)
                report.verify.holesFilled = filled
                report.verify.holesOverflow = overflow
            }
            out.push({
                sheets,
                containers,
                report: report && !report.error ? report : null,
                postPass,
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
/**
 * usedSheetShare local — miroir exact de metrics.compute_used_sheet_share :
 * bbox couvrant toutes les pièces placées / aire tôle (plus petit = mieux).
 * Sans lui, le modal retombe sur `density` dont l'échelle varie selon la
 * convention (pièces/bande moteur vs pièces/tôle) et l'alternative grille
 * (density null) affichait 0 % (constat user 2026-08-28 : « stats cassées »).
 */
function usedSheetShareOf(art, partsById) {
    if (!art?.containers?.length) return null
    let bboxArea = 0
    let sheetArea = 0
    for (const c of art.containers) {
        sheetArea += (c.bin_width || 0) * (c.bin_height || 0)
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const t of c.transforms || []) {
            const coords = partsById.get(String(t.item_id))?.coords
            if (!coords?.length) continue
            const a = t.angle || 0
            const cos = Math.cos(a)
            const sin = Math.sin(a)
            for (const [px, py] of coords) {
                const rx = px * cos - py * sin + (t.x || 0)
                const ry = px * sin + py * cos + (t.y || 0)
                if (rx < minX) minX = rx
                if (ry < minY) minY = ry
                if (rx > maxX) maxX = rx
                if (ry > maxY) maxY = ry
            }
        }
        if (minX !== Infinity) bboxArea += (maxX - minX) * (maxY - minY)
    }
    return sheetArea > 0 ? Math.min(1, bboxArea / sheetArea) : null
}

export function toServerShapeAlternatives(result, payload, artifacts) {
    const alternatives = result?.alternatives || []
    const parts = payload?.parts || []
    const partsById = new Map(parts.map((p) => [String(p.id), p]))
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
            // Alternative structurelle (grille canonique) : sa propre classe
            // d'affichage — miroir de _strategy_for côté serveur.
            strategy: alt.structural ? 'grid' : (alt.bias || 'balanced'),
            density: alt.solution?.density ?? alt.density ?? null,
            usedSheetShare: usedSheetShareOf(art, partsById),
            offcut: bestOffcut
                ? { width: bestOffcut.widthMm, height: bestOffcut.heightMm, area: bestOffcut.areaMm2 }
                : null,
            cost: alt.cost ?? alt.solution?.cost ?? null,
            layoutCount: layouts.length,
            svgs: art.sheets || [],
            report: {
                ...verify,
                // A5 : observabilité des post-pass (additif — miroir du
                // champ report.postPass serveur).
                postPass: art.postPass ?? null,
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
