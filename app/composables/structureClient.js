/**
 * Pass structurel (grille canonique) — miroir EXACT de
 * workers/nesting/core/structure.py (voir la doc là-bas). SPP mono-tôle :
 * item rectangulaire dominant en quantité + petites pièces → grille exacte
 * (pitch dim+space, marges space) + zones denses pour les petites pièces
 * (A : au-dessus du reste de la colonne incomplète ; C : bande de fin de
 * colonnes pleines ; B : à droite, seule à étendre l'axe objectif).
 *
 * Les zones sont remplies par des sous-solves moteur (mini-pool wasm
 * mono-walk) — le callback est injecté par l'appelant.
 *
 * holePlan (constat 2026-08-29 : « trous d'abord » J-085 absorbait TOUTES
 * les petites pièces → instance réduite à 1 classe → jamais de grille) :
 * l'appelant passe la vue ORIGINALE à 2 classes + les rotations pinwheel
 * validées des trous ; les trous forment un 2e réservoir ENTRE C et B.
 * Dans ce mode le layout est AUTO-SUFFISANT (ids d'origine, trous remplis
 * par expandHoles) : l'appelant saute remap J-085 / expansion meta /
 * post-pass hole-fill pour cette alternative (sinon applyHoleFill
 * téléporterait les fans des zones vers les trous vides).
 */

export const STRUCT_TOL = 0.2
export const ZONE_A_DENSITY = 0.95
// Budgets NAVIGATEUR volontairement courts (le natif garde 30/25/45 ×5) :
// la phase grille est silencieuse pour la vue live — bornée à ~2 min max
// pour ne jamais geler l'UI sans feedback (constat user 2026-08-28).
export const ZONE_A_BUDGET_SEC = 20
export const ZONE_B_BUDGET_SEC = 30
export const ZONE_C_BUDGET_SEC = 15
// Encadrement par zone (≤3 runs moteur en navigateur, 5 en natif).
export const ZONE_MAX_ATTEMPTS = 3
// « Rectangles successifs » (demande user 2026-08-29 : chaque zone = des
// rectangles PLEINS empilés, pas une bande à moitié vide). Mesuré : le solve
// plafonne à ~57-60 % sur une bande 100 mm ENTIÈRE mais tient ~60 % PAR
// TRONÇON de 300-500 mm — les zones longues sont découpées en pas de
// ~ZONE_STEP_MM le long de leur grand axe, chaque pas rempli ENTIER avant
// le suivant (miroir exact de structure.py).
export const ZONE_STEP_MM = 450
export const ZONE_STEP_MIN_MM = 150
// Abandon d'un tronçon (et des suivants) sous cette fraction du demandé —
// le plafond RÉEL mesuré par tronçon est ~0,57-0,60 du cap 0,95.
export const ZONE_STEP_BREAK = 0.45
// Lattice analytique des petites pièces (« compression finale » user
// 2026-08-29) — colonnes entrelacées rot0/rot180, paramètres validés
// empiriquement (0 conflit, min-dist 0,113 à space 0,1 ; miroir exact de
// structure.py::small_lattice) : px = W/2 + space, py = 1.3·H,
// dy = -0.382·py, orientation (i+j)%2, centroïdes normalisés.
export const LATTICE_PY_RATIO = 1.3554
export const LATTICE_DY_RATIO = -0.378
// Marge vs courbes brutes exportées (anneaux simplifiés à ~0,05 mm) :
// validation à space + 2×tolérance (miroir structure.py).
export const LATTICE_SIMPLIFY_MM = 0.05

/** Centroïde d'aire (shoelace) — repli moyenne des sommets si dégénéré. */
function ringCentroid(coords) {
    let a = 0; let cx = 0; let cy = 0
    const n = coords.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % n]
        const cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    }
    if (Math.abs(a) < 1e-12) {
        let sx = 0; let sy = 0
        for (const [x, y] of coords) { sx += x; sy += y }
        return [sx / n, sy / n]
    }
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]
}

/** Rotation quarter-turn exacte (repère moteur : R(90)·(x,y) = (−y, x)). */
function rotateRing(coords, deg) {
    const r = ((deg % 360) + 360) % 360
    if (r === 0) return coords
    if (r === 180) return coords.map(([x, y]) => [-x, -y])
    if (r === 90) return coords.map(([x, y]) => [-y, x])
    return coords.map(([x, y]) => [y, -x])
}

function rotatePoint(pt, deg) {
    const [x, y] = rotateRing([pt], deg)[0]
    return [x, y]
}

function segPointDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax; const dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const qx = ax + t * dx; const qy = ay + t * dy
    return Math.hypot(px - qx, py - qy)
}

/** Distance exacte entre deux anneaux (sommets↔arêtes, suffisant convexe). */
function ringDist(c1, c2) {
    let m = Infinity
    const edges = (ring) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]])
    for (const [px, py] of c1) {
        for (const [[ax, ay], [bx, by]] of edges(c2)) {
            m = Math.min(m, segPointDist(px, py, ax, ay, bx, by))
            if (m < 1e-9) return 0
        }
    }
    for (const [px, py] of c2) {
        for (const [[ax, ay], [bx, by]] of edges(c1)) {
            m = Math.min(m, segPointDist(px, py, ax, ay, bx, by))
            if (m < 1e-9) return 0
        }
    }
    return m
}

/**
 * Lattice entrelacé des petites pièces dans la zone (miroir de
 * structure.py::small_lattice). Retourne des placements {item_id,
 * transformation} (convention moteur, repère PIÈCE) ou null si la forme ne
 * valide pas (repli tronçons moteur). Validation : paires de cellules
 * voisines (|Δi|,|Δj| ≤ 2) à distance ≥ space.
 */
export function smallLattice(small, space, zone) {
    const coords = (small && small.coords) || []
    if (coords.length < 3) return null
    const [x0, y0, x1, y1] = zone
    const bb = bbox(coords)
    const w = bb[2] - bb[0]
    const h = bb[3] - bb[1]
    if (w <= 0 || h <= 0) return null
    const c0 = ringCentroid(coords)
    const px = w / 2 + space
    const py = LATTICE_PY_RATIO * h
    const dy = LATTICE_DY_RATIO * py
    const ix0 = x0 + space; const iy0 = y0 + space
    const ix1 = x1 - space; const iy1 = y1 - space
    if (ix1 - ix0 < w || iy1 - iy0 < h) return null
    const cx0 = ix0 + w / 2

    const cells = []
    for (let i = 0; cx0 + i * px + w / 2 <= ix1 + 1e-9; i++) {
        const cx = cx0 + i * px
        for (let j = -40; j < 220; j++) {
            const even = ((i + j) % 2 + 2) % 2 === 0
            const cy = c0[1] + j * py + (even ? 0 : dy)
            if (cy - h / 2 >= iy0 - 1e-9 && cy + h / 2 <= iy1 + 1e-9) {
                cells.push({ i, j, even, cx, cy })
            }
        }
    }
    if (!cells.length) return null
    // anneaux monde (rotation puis translation centroïde)
    for (const c of cells) {
        const ring0 = rotateRing(coords, c.even ? 0 : 180)
        // re-centrer sur c0 : rot0 déjà centrée ; rot180 : centroïde = -c0
        const rc = c.even ? c0 : [-c0[0], -c0[1]]
        c.ring = ring0.map(([x, y]) => [x - rc[0] + (c.cx - c0[0]) + c0[0], y - rc[1] + (c.cy - c0[1]) + c0[1]])
    }
    // validation : voisins de cellule uniquement (le lattice ne conflite
    // qu'entre cellules proches — sinon O(n²) rédhibitoire en navigateur) ;
    // seuil = space + 2×tol simplification (courbes brutes exportées).
    const threshold = space + 2 * LATTICE_SIMPLIFY_MM
    for (let a = 0; a < cells.length; a++) {
        for (let b = a + 1; b < cells.length; b++) {
            const A = cells[a]; const B = cells[b]
            if (Math.abs(A.i - B.i) > 2 || Math.abs(A.j - B.j) > 2) continue
            if (ringDist(A.ring, B.ring) < threshold - 1e-9) return null
        }
    }
    // placements moteur : t = centroid_monde − R·centroid_pièce
    return cells.map((c) => {
        const deg = c.even ? 0 : 180
        const rc = rotatePoint(c0, deg)
        return {
            item_id: small.id,
            transformation: {
                rotation: deg,
                translation: [c.cx - rc[0], c.cy - rc[1]],
            },
        }
    })
}
const QUARTER_TURNS = [0, 90, 180, 270]

function shoelace(coords) {
    let s = 0
    for (let i = 0; i < coords.length - 1; i++) {
        s += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1]
    }
    return Math.abs(s) / 2
}

function bbox(coords) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of coords) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
    }
    return [x0, y0, x1, y1]
}

export function isAxisRect(coords) {
    const pts = coords.slice()
    if (pts.length && pts[0][0] === pts[pts.length - 1][0]
        && pts[0][1] === pts[pts.length - 1][1]) pts.pop()
    if (pts.length !== 4) return false
    const xs = [...new Set(pts.map((p) => Math.round(p[0] * 1e6) / 1e6))]
    const ys = [...new Set(pts.map((p) => Math.round(p[1] * 1e6) / 1e6))]
    if (xs.length !== 2 || ys.length !== 2) return false
    const got = new Set(pts.map((p) => `${Math.round(p[0] * 1e6) / 1e6},${Math.round(p[1] * 1e6) / 1e6}`))
    for (const x of xs) for (const y of ys) {
        if (!got.has(`${x},${y}`)) return false
    }
    return true
}

/** Bbox d'un anneau de bbox donnée tourné de rot (multiple de 90°). */
function rotatedBbox(bb, rotDeg) {
    const [x0, y0, x1, y1] = bb
    const r = ((rotDeg % 360) + 360) % 360
    if (r === 0) return [x0, y0, x1, y1]
    if (r === 180) return [-x1, -y1, -x0, -y0]
    if (r === 90) return [y0, -x1, y1, -x0]
    return [-y1, x0, -y0, x1]
}

/**
 * Détecte le cas structurel. `geomOf(itemId)` -> {coords, rotations}
 * (géométrie d'ORIGINE). Mêmes conditions conservatrices que Python.
 */
export function detectStructuralCase(instanceItems, geomOf, totalArea) {
    if (!Array.isArray(instanceItems) || instanceItems.length !== 2) return null
    const infos = []
    for (const it of instanceItems) {
        const geom = geomOf(it.id)
        if (!geom || !geom.coords || !geom.coords.length) return null
        const rots = (geom.rotations || []).map((r) => ((Number(r) % 360) + 360) % 360)
        if (!rots.length || rots.some((r) => !QUARTER_TURNS.includes(r))) return null
        infos.push({
            id: it.id,
            demand: Number(it.demand) || 0,
            coords: geom.coords,
            rotations: rots,
            area: shoelace(geom.coords),
            bbox: bbox(geom.coords),
        })
    }
    const [a, b] = infos
    for (const [rect, small] of [[a, b], [b, a]]) {
        if (rect.demand < 8) continue
        if (!isAxisRect(rect.coords)) continue
        if (rect.area * rect.demand < 0.6 * totalArea) continue
        const side = Math.min(rect.bbox[2] - rect.bbox[0], rect.bbox[3] - rect.bbox[1])
        if (Math.max(small.bbox[2] - small.bbox[0], small.bbox[3] - small.bbox[1]) > side + 1e-6) continue
        return { rect, small }
    }
    return null
}

export function planLattice(caseInfo, sheetW, sheetH, space, objective = 'x') {
    const [rx0, ry0, rx1, ry1] = caseInfo.rect.bbox
    const w = rx1 - rx0, h = ry1 - ry0
    const pitchX = w + space, pitchY = h + space
    const n = caseInfo.rect.demand
    // Translation EXTERNE de l'anneau d'origine : bord posé = tx + bbox.
    const ox = space - rx0
    const oy = space - ry0
    const placements = []

    if (objective === 'y') {
        // −Y : rangées le long de X (ancrées gauche), empilées depuis y=0 ;
        // bande B' AU-DESSUS, résolue en transposé (minimiser la hauteur).
        const perLine = Math.floor((sheetW - 2 * space - w) / pitchX) + 1
        if (perLine < 1) return null
        const nFull = Math.floor(n / perLine)
        const remainder = n - nFull * perLine
        const lines = nFull + (remainder ? 1 : 0)
        for (let r = 0; r < lines; r++) {
            const nHere = r < nFull ? perLine : remainder
            for (let c = 0; c < nHere; c++) {
                placements.push({
                    item_id: caseInfo.rect.id,
                    transformation: { rotation: 0, translation: [ox + c * pitchX, oy + r * pitchY] },
                })
            }
        }
        const latticeTop = space + lines * pitchY
        let zoneA = null
        if (remainder) {
            const y0 = space + nFull * pitchY
            zoneA = [space + remainder * pitchX, y0, sheetW - space, y0 + h]
        }
        let zoneC = null
        const fullRight = space + (perLine - 1) * pitchX + w
        if (nFull >= 1 && fullRight + space < sheetW - space) {
            zoneC = [fullRight + space, space, sheetW - space, space + nFull * pitchY]
        }
        const zoneB = [space, latticeTop + space, sheetW - space, sheetH - space]
        return { placements, latticeExtent: latticeTop, zoneA, zoneB, zoneC,
                 zoneBTransposed: true, perLine, lines, remainder }
    }

    const perCol = Math.floor((sheetH - 2 * space - h) / pitchY) + 1
    if (perCol < 1) return null
    const nFull = Math.floor(n / perCol)
    const remainder = n - nFull * perCol
    const cols = nFull + (remainder ? 1 : 0)
    for (let c = 0; c < cols; c++) {
        const nHere = c < nFull ? perCol : remainder
        for (let r = 0; r < nHere; r++) {
            placements.push({
                item_id: caseInfo.rect.id,
                transformation: { rotation: 0, translation: [ox + c * pitchX, oy + r * pitchY] },
            })
        }
    }
    const latticeRight = space + cols * pitchX
    let zoneA = null
    if (remainder) {
        const x0 = space + nFull * pitchX
        zoneA = [x0, space + remainder * pitchY, x0 + w, sheetH - space]
    }
    // Zone C — bande de fin de colonnes pleines (voir structure.py : sans
    // elle, longue bande vide « pas naturelle » au-dessus de la grille).
    let zoneC = null
    const fullColsTop = space + (perCol - 1) * pitchY + h
    const bandY0 = fullColsTop + space
    if (nFull >= 1 && bandY0 < sheetH - space) {
        const fullRight = space + (nFull - 1) * pitchX + w
        zoneC = [space, bandY0, fullRight, sheetH - space]
    }
    const zoneB = [latticeRight + space, space, sheetW - space, sheetH - space]
    return { placements, latticeExtent: latticeRight, zoneA, zoneB, zoneC,
             zoneBTransposed: false, perLine: perCol, lines: cols, remainder }
}

/** Packe `want` petites pièces dans la zone ; retries décroissants. */
/** Sentinelle d'annulation levée quand un pool de zone est annulé —
 * l'appelant la traduit en sortie propre (jamais de local-fail ensuite). */
export const ZONE_CANCELLED = Symbol('zone-cancelled')

async function zoneSolve(zone, small, space, want, solveFn, budgetSec,
                         transposed = false, onZone = null, zoneLabel = '',
                         step = 0, steps = 0) {
    // Encadrement « compacter encore et encore » (miroir exact de
    // structure.py::_zone_solve) : shrink ×0,6 à l'échec, regonfler +15 %
    // au succès, bissection — ≤ ZONE_MAX_ATTEMPTS runs moteur.
    // transposed : le solve minimise la largeur du problème transposé = la
    // HAUTEUR réelle de la zone (bande du haut −Y) ; map-back
    // (x, y) → (zone_w − y, x), rotation inchangée.
    const [x0, y0, x1, y1] = zone
    const zw = x1 - x0, zh = y1 - y0
    if (zw <= 0 || zh <= 0 || want <= 0) return []
    const solveH = transposed ? zw : zh
    const solveW = transposed ? zh : zw
    let best = null
    let hi = null
    let n = want
    for (let attempt = 0; attempt < ZONE_MAX_ATTEMPTS; attempt++) {
        if (onZone) onZone({ zone: zoneLabel, attempt: attempt + 1, attempts: ZONE_MAX_ATTEMPTS,
                             count: n, step, steps })
        const placements = await solveFn(n, solveH, solveW, budgetSec, transposed)
        let usedW = 0
        if (placements && placements.length) {
            for (const p of placements) {
                const rot = Number(p.transformation?.rotation) || 0
                const [tx] = p.transformation?.translation || [0, 0]
                const bb = rotatedBbox(small.bbox, rot)
                usedW = Math.max(usedW, tx + bb[2], -(tx + bb[0]))
            }
        }
        const ok = !!placements && placements.length >= n && usedW <= solveW + 1e-3
        if (ok) {
            best = placements
            if (n >= want) break
            const grow = Math.max(1, Math.floor(n * 0.15))
            n = Math.min(n + grow, want)
            if (hi != null) n = Math.min(n, hi - 1)
            if (n <= best.length) break
        } else {
            hi = hi == null ? n : Math.min(hi, n)
            if (best == null) {
                if (n <= 1) return []
                n = Math.max(1, Math.floor(n * 0.6))
                if (hi != null && hi > 1) n = Math.min(n, hi - 1)
                if (n < 1) return []
            } else {
                const gap = hi - best.length
                if (gap <= Math.max(1, Math.floor(best.length * 0.06))) break
                n = best.length + Math.floor(gap / 2)
            }
        }
    }
    if (!best) return []
    return best.map((p) => {
        const [tx, ty] = p.transformation.translation
        const [sx, sy] = transposed ? [x0 + (zw - ty), y0 + tx] : [x0 + tx, y0 + ty]
        return {
            item_id: small.id,
            transformation: {
                rotation: p.transformation.rotation,
                translation: [sx, sy],
            },
        }
    })
}

/** Découpe la zone en rectangles successifs le long de son grand axe
 * (depuis l'origine : côté ancré aux carrés pour A/C). Zone courte = un
 * seul rect. Miroir de structure.py::_zone_steps. */
export function zoneSteps(zone) {
    const [x0, y0, x1, y1] = zone
    const w = x1 - x0
    const h = y1 - y0
    const split = (len, base) => {
        let n = Math.max(1, Math.round(len / ZONE_STEP_MM))
        if (n > 1 && (len / n) * (n - 1) < ZONE_STEP_MIN_MM) n -= 1
        return n
    }
    if (w >= h) {
        const n = split(w, 0)
        const step = w / n
        return Array.from({ length: n }, (_, i) => [x0 + i * step, y0, x0 + (i + 1) * step, y1])
    }
    const n = split(h, 0)
    const step = h / n
    return Array.from({ length: n }, (_, i) => [x0, y0 + i * step, x1, y0 + (i + 1) * step])
}

/**
 * Layout canonique complet ou null (repli : résultat moteur tel quel).
 * `solveFn(count, stripH, maxW, budgetSec)` -> placements zone-local | null.
 *
 * `holePlan` (cas « trous d'abord » J-085/D-MOT-16 : la pré-passe a extrait
 * les petites pièces vers les trous des hôtes) : { hostId, fillId, rings,
 * ringRotations } + `expandHoles(hostId, fillId, slots, layouts)` qui pose
 * les fillers pinwheel (même math que l'expansion meta). Les trous sont le
 * 2e réservoir APRÈS les zones internes A/C (silhouette rectangulaire
 * pleine — « compacter sur toute la longueur », constat user 2026-08-29)
 * et AVANT la zone B (seule à étendre l'axe de l'objectif).
 */
export async function buildStructuralLayout(instanceItems, geomBy, sheetW, sheetH,
                                             space, solveFn, objective = 'x',
                                             onZone = null, holePlan = null,
                                             expandHoles = null) {
    let totalArea = 0
    for (const it of instanceItems) {
        const geom = geomBy(it.id)
        totalArea += shoelace(geom.coords) * (Number(it.demand) || 0)
    }
    const caseInfo = detectStructuralCase(instanceItems, geomBy, totalArea)
    if (!caseInfo) return null
    const lat = planLattice(caseInfo, sheetW, sheetH, space, objective)
    if (!lat) return null
    const placements = lat.placements.slice()
    const nSmall = caseInfo.small.demand
    // bbox de la petite pièce DANS LA FRAME DE SOLVE (zone B transposée).
    const smallSolve = lat.zoneBTransposed
        ? { ...caseInfo.small, bbox: transposedBbox(caseInfo.small.bbox) }
        : caseInfo.small

    // Plan d'exécution en ordre d'affichage : A, C puis B (les trous, sans
    // solve moteur, s'intercalent entre C et B). L'étape cumulative
    // step/steps rend la progression lisible (« C puis B » était illisible,
    // constat user 2026-08-28).
    const plan = [
        { key: 'A', zone: lat.zoneA, budget: ZONE_A_BUDGET_SEC, transposed: false },
        { key: 'C', zone: lat.zoneC, budget: ZONE_C_BUDGET_SEC, transposed: false },
        { key: 'B', zone: lat.zoneB, budget: ZONE_B_BUDGET_SEC, transposed: lat.zoneBTransposed },
    ].filter((z) => z.zone)
    const steps = plan.length

    const fillZone = async (z, want, stepIdx) => {
        if (!z.zone || want <= 0) return 0
        // LATTICE ANALYTIQUE d'abord (« compression finale », user
        // 2026-08-29) : déterministe, instantané, ~67 % en bande étroite
        // (vs 38-57 % moteur) ; tronçons moteur pour le surplus ou repli
        // si la forme ne valide pas.
        let gotTotal = 0
        if (!z.transposed) {
            const lat = smallLattice(caseInfo.small, space, z.zone)
            if (lat && lat.length) {
                // TOUT-OU-RIEN : un top-up moteur dans la même zone
                // écraserait le lattice (le solve ne voit pas les pièces
                // déjà posées — 300/231 mesuré 2026-08-29).
                const take = lat.slice(0, want)
                placements.push(...take)
                return take.length
            }
        }
        // Rectangles successifs pleins (miroir de structure.py::fill_zone)
        const rects = zoneSteps(z.zone)
        for (let i = 0; i < rects.length; i++) {
            if (gotTotal >= want) break
            const [zx0, zy0, zx1, zy1] = rects[i]
            const cap = Math.floor((zx1 - zx0) * (zy1 - zy0) * ZONE_A_DENSITY
                / Math.max(caseInfo.small.area, 1e-6))
            const wantStep = Math.min(want - gotTotal, Math.max(0, cap))
            if (!wantStep) continue
            const got = await zoneSolve(rects[i], smallSolve, space, wantStep,
                solveFn, z.budget, z.transposed, onZone, z.key, stepIdx, steps)
            placements.push(...got)
            gotTotal += got.length
            if (got.length < wantStep * ZONE_STEP_BREAK) break
        }
        return gotTotal
    }

    let used = 0
    let stepIdx = 0
    for (const z of plan) {
        stepIdx += 1
        if (z.key === 'B') break // dernier réservoir, traité après les trous
        used += await fillZone(z, nSmall - used, stepIdx)
    }

    // Trous des hôtes posés : capacity = Σ rotations validées par anneau ×
    // hôtes ; on n'y verse que l'excédent des zones internes (A/C pleines
    // d'abord — la demande user est la silhouette rectangulaire pleine).
    let holeUsed = 0
    if (holePlan && expandHoles && used < nSmall) {
        const perHost = (holePlan.ringRotations || [])
            .reduce((n, rr) => n + (rr ? rr.length : 0), 0)
        if (perHost > 0) {
            const nHosts = lat.placements.length
            let budget = Math.min(nSmall - used, perHost * nHosts)
            if (budget > 0) {
                const slots = []
                for (let i = 0; i < nHosts && budget > 0; i++) {
                    const k = Math.min(perHost, budget)
                    slots.push(k)
                    budget -= k
                }
                // expandHoles peut RÉASSIGNER layout.placed_items (expandMeta)
                // ou muter en place : relire dans les deux cas.
                const layout = { container_id: 0, placed_items: [...placements] }
                expandHoles(holePlan.hostId, holePlan.fillId, slots, [layout])
                const merged = layout.placed_items || placements
                placements.length = 0
                placements.push(...merged)
                holeUsed = slots.reduce((n, k) => n + k, 0)
                used += holeUsed
            }
        }
    }

    const left = nSmall - used
    const bZone = plan.find((z) => z.key === 'B')
    if (left > 0) {
        if (!bZone) return null
        // B = UNE bande pleine hauteur à largeur minimisée (mesuré ~81 %
        // de densité, contrairement aux bandes étroites ~57 %) — PAS de
        // découpage en tronçons. Miroir de structure.py (zone_b direct).
        const got = await zoneSolve(bZone.zone, smallSolve, space, left,
            solveFn, bZone.budget, bZone.transposed, onZone, 'B', steps, steps)
        if (nSmall - used - got.length > 0) return null // B saturée : repli moteur
        placements.push(...got)
        used += got.length
    }
    return {
        placed_items: placements,
        case: { perLine: lat.perLine, lines: lat.lines, remainder: lat.remainder,
                objective, holes: holeUsed },
    }
}

/** bbox de l'item tourné (x,y)→(y,−x) — frame de solve transposée. */
function transposedBbox(bb) {
    const [x0, y0, x1, y1] = bb
    return [-y1, x0, -y0, x1]
}

export function layoutUsedExtent(layout, geomBy, space, axis = 'x') {
    let far = 0
    for (const p of layout.placed_items) {
        const geom = geomBy(p.item_id)
        const bb = rotatedBbox(bbox(geom.coords), Number(p.transformation?.rotation) || 0)
        const t = p.transformation.translation[axis === 'x' ? 0 : 1]
        far = Math.max(far, t + (axis === 'x' ? bb[2] : bb[3]))
    }
    return far + space
}

export function layoutUsedWidth(layout, geomBy, space) {
    return layoutUsedExtent(layout, geomBy, space, 'x')
}
