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
// Zigzag 0/180 : guess initial du pas Y (le vrai pas est le plus petit
// qui passe la distance ≥ space). Pas une constante de pièce.
export const LATTICE_PY_RATIO = 1.3554
export const LATTICE_DY_RATIO = -0.378
// Marge vs courbes brutes exportées (anneaux simplifiés à ~0,05 mm) :
// validation à space + 2×tolérance (miroir structure.py).
// P-m.3 (audit 2026-08-31) : côté Python cette marge suit l'env
// NEST_SIMPLIFY_MM (structure.py LATTICE_SIMPLIFY_MM) — le navigateur n'a
// pas d'env : GARDER SYNC avec main.py::SIMPLIFY_MM (défaut 0,05).
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
export function rotateRing(coords, deg) {
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

/** Distance EXACTE entre deux segments : 0 s'ils se croisent ou se
 * touchent, sinon min des 4 distances sommet-segment. */
function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
    const orient = (px, py, qx, qy, rx, ry) =>
        (qx - px) * (ry - py) - (qy - py) * (rx - px)
    const o1 = orient(ax, ay, bx, by, cx, cy)
    const o2 = orient(ax, ay, bx, by, dx, dy)
    const o3 = orient(cx, cy, dx, dy, ax, ay)
    const o4 = orient(cx, cy, dx, dy, bx, by)
    const onSeg = (px, py, qx, qy, rx, ry) =>
        Math.min(px, qx) <= rx && rx <= Math.max(px, qx)
        && Math.min(py, qy) <= ry && ry <= Math.max(py, qy)
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))
        && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0
    if (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return 0
    if (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return 0
    if (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return 0
    if (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return 0
    return Math.min(
        segPointDist(ax, ay, cx, cy, dx, dy),
        segPointDist(bx, by, cx, cy, dx, dy),
        segPointDist(cx, cy, ax, ay, bx, by),
        segPointDist(dx, dy, ax, ay, bx, by))
}

/** Distance exacte entre deux anneaux : arête↔arête (le seul test
 * sommet↔arête laissait passer des chevauchements réels — deux arêtes
 * qui se croisent EN LEUR MILIEU n'impliquent aucun sommet proche,
 * constat 2026-09-02 : 95 paires à ~33 mm² vues 0,11 par l'ancien
 * ringDist alors que shapely (serveur) les rejetait ; miroir exact de
 * shapely Polygon.distance sur les frontières). */
export function ringDist(c1, c2) {
    let m = Infinity
    const n1 = c1.length
    const n2 = c2.length
    for (let i = 0; i < n1; i++) {
        const ax = c1[i][0]; const ay = c1[i][1]
        const bx = c1[(i + 1) % n1][0]; const by = c1[(i + 1) % n1][1]
        for (let j = 0; j < n2; j++) {
            const cx = c2[j][0]; const cy = c2[j][1]
            const dx = c2[(j + 1) % n2][0]; const dy = c2[(j + 1) % n2][1]
            m = Math.min(m, segSegDist(ax, ay, bx, by, cx, cy, dx, dy))
            if (m < 1e-9) return 0
        }
    }
    return m
}

/**
 * Remplit un rectangle libre. Méthode GÉNÉRALE (toute forme, tout space) :
 *   1. grille bbox (pas = dim+space, rot 0 et 90) — toujours valide dès
 *      qu'une pièce tient ;
 *   2. zigzag 0/180, 90/270, et le même zigzag tourné (R90 du pavage) ;
 *      pas dichotomié sous distance ≥ space ; score = max N puis bord min
 *      sur l'axe objectif (chute max). Null si rien ne rentre.
 */
function decimateRing(coords, n = 20) {
    const closed = coords.length > 1
        && coords[0][0] === coords[coords.length - 1][0]
        && coords[0][1] === coords[coords.length - 1][1]
    const m = closed ? coords.length - 1 : coords.length
    if (m <= n) return coords
    const out = []
    for (let i = 0; i < n; i++) out.push(coords[Math.floor(i * m / n)])
    out.push(out[0])
    return out
}

export function smallLattice(small, space, zone, opts = {}) {
    const coords = (small && small.coords) || []
    if (coords.length < 3) return null
    const [zx0, zy0, zx1, zy1] = zone
    if (zx1 - zx0 <= 0 || zy1 - zy0 <= 0) return null
    const bb0 = bbox(coords)
    const w0 = bb0[2] - bb0[0]
    const h0 = bb0[3] - bb0[1]
    if (w0 <= 0 || h0 <= 0) return null
    const threshold = space + 2 * LATTICE_SIMPLIFY_MM
    const want = Number.isFinite(opts.want) && opts.want > 0 ? opts.want : Infinity
    const axis = opts.axis === 'y' ? 'y' : 'x'
    // P-1 (audit 2026-08-31 §P-1) : le lattice ne pose QUE des angles ∈
    // rotations permises — chaque famille n'est générée que si ses angles
    // posés sont légaux, et `consider` filtre toute pose illégale en
    // ceinture (miroir structure.py::small_lattice).
    const allowed = new Set(
        ((small.rotations && small.rotations.length ? small.rotations : [0])
            .map((r) => ((Number(r) % 360) + 360) % 360)))
    let best = null
    let bestScore = -Infinity
    const consider = (cells) => {
        if (!cells || !cells.length) return
        // Ceinture P-1 : aucune pose illégale ne survit au scoring.
        const legal = cells.filter((c) =>
            allowed.has((((Number(c.transformation?.rotation) % 360) + 360) % 360)))
        if (!legal.length) return
        const take = want < Infinity ? legal.slice(0, want) : legal
        const n = take.length
        const [far, near] = placementsFar(take, coords, axis)
        // P2 (audit 2026-09-03) : tie-break sur le bord PROCHE — une bande
        // saturée a le même bord lointain pour toutes ses variantes : le
        // bloc collé à l'origine de l'axe doit gagner (miroir du tuple
        // Python (n, -far, -near)).
        const score = n * 1e12 - far * 1e6 - near
        if (score > bestScore) { best = take; bestScore = score }
    }
    for (const deg0 of [0, 90]) {
        if (allowed.has(deg0)) {
            consider(bboxGrid(coords, small.id, space, zone, deg0))
            consider(bboxGridBrick(coords, small.id, space, zone, deg0))
        }
        if (allowed.has(deg0) && allowed.has((deg0 + 180) % 360)) {
            for (const yPhase of [0, 1]) {
                for (const xPhase of [0, 1]) {
                    consider(latticeVariant(coords, small.id, space, zone,
                        threshold, deg0, yPhase, xPhase))
                }
            }
        }
    }
    // Même zigzag tourné de 90° (pas X/Y échangés, distances préservées) :
    // une bande haute et étroite reçoit le pas serré sur le grand côté.
    // Poses résultantes = {90, 270} : légal seulement si les deux sont
    // permises (miroir Python).
    if (allowed.has(90) && allowed.has(270)) {
        for (const yPhase of [0, 1]) {
            for (const xPhase of [0, 1]) {
                consider(latticeRotated(coords, small.id, space, zone,
                    threshold, yPhase, xPhase))
            }
        }
    }
    return best
}

function placementsFar(placements, coords, axis) {
    let far = -Infinity
    let near = Infinity
    for (const p of placements) {
        const bb = rotatedBbox(bbox(coords), Number(p.transformation?.rotation) || 0)
        const t = p.transformation.translation[axis === 'y' ? 1 : 0]
        far = Math.max(far, t + (axis === 'y' ? bb[3] : bb[2]))
        near = Math.min(near, t + (axis === 'y' ? bb[1] : bb[0]))
    }
    return [far, near]
}

/** Grille axis-alignée, pas = bbox+space. Valide pour n'importe quel polygone. */
function bboxGrid(coords, itemId, space, zone, deg0) {
    const rot = rotateRing(coords, deg0)
    const c0 = ringCentroid(rot)
    const bb = bbox(rot)
    const w = bb[2] - bb[0]
    const h = bb[3] - bb[1]
    const [ix0, iy0, ix1, iy1] = zone
    if (ix1 - ix0 < w || iy1 - iy0 < h) return null
    const xL = c0[0] - bb[0]
    const xR = bb[2] - c0[0]
    const yD = c0[1] - bb[1]
    const yU = bb[3] - c0[1]
    const px = w + space
    const py = h + space
    const cx0 = ix0 + xL
    const cy0 = iy0 + yD
    const cells = []
    for (let i = 0; cx0 + i * px + xR <= ix1 + 1e-9; i++) {
        for (let j = 0; cy0 + j * py + yU <= iy1 + 1e-9; j++) {
            cells.push({ cx: cx0 + i * px, cy: cy0 + j * py })
        }
    }
    if (!cells.length) return null
    const cOrig = ringCentroid(coords)
    const rc = rotatePoint(cOrig, deg0)
    return cells.map((c) => ({
        item_id: itemId,
        transformation: { rotation: deg0, translation: [c.cx - rc[0], c.cy - rc[1]] },
    }))
}

/** Grille bbox en quinconce (rangées impaires décalées de px/2). */
function bboxGridBrick(coords, itemId, space, zone, deg0) {
    const rot = rotateRing(coords, deg0)
    const c0 = ringCentroid(rot)
    const bb = bbox(rot)
    const w = bb[2] - bb[0]
    const h = bb[3] - bb[1]
    const [ix0, iy0, ix1, iy1] = zone
    if (ix1 - ix0 < w || iy1 - iy0 < h) return null
    const xL = c0[0] - bb[0]
    const xR = bb[2] - c0[0]
    const yD = c0[1] - bb[1]
    const yU = bb[3] - c0[1]
    const px = w + space
    const py = h + space
    const cx0 = ix0 + xL
    const cy0 = iy0 + yD
    const cells = []
    for (let j = 0; cy0 + j * py + yU <= iy1 + 1e-9; j++) {
        const odd = j % 2 === 1
        const ox = odd ? px / 2 : 0
        for (let i = 0; cx0 + ox + i * px + xR <= ix1 + 1e-9; i++) {
            if (odd && cx0 + ox + i * px - xL < ix0 - 1e-9) continue
            cells.push({ cx: cx0 + ox + i * px, cy: cy0 + j * py })
        }
    }
    if (!cells.length) return null
    const cOrig = ringCentroid(coords)
    const rc = rotatePoint(cOrig, deg0)
    return cells.map((c) => ({
        item_id: itemId,
        transformation: { rotation: deg0, translation: [c.cx - rc[0], c.cy - rc[1]] },
    }))
}

/** Zigzag 0/180 généré dans le rectangle transposé, puis R(+90) vers la zone.
 *  Préserve l'emboîtement (contrairement à recalculer px/py sur la bbox 90°). */
function latticeRotated(coords, itemId, space, zone, threshold, yPhase, xPhase) {
    const [x0, y0, x1, y1] = zone
    const W = x1 - x0
    const H = y1 - y0
    if (W <= 0 || H <= 0) return null
    const fake = [0, 0, H, W]
    const packed = latticeVariant(coords, itemId, space, fake, threshold, 0, yPhase, xPhase)
    if (!packed || !packed.length) return null
    const cOrig = ringCentroid(coords)
    // R(+90) du pavage : (x,y) → (−y, x), puis calé sur (x0+W, y0).
    // Transpose (x,y)→(y,x) + rot 90 cassait les bboxes (moitié clipée).
    const out = packed.map((p) => {
        const srcDeg = Number(p.transformation.rotation) || 0
        const [tx, ty] = p.transformation.translation
        const srcC = rotatePoint(cOrig, srcDeg)
        const fx = srcC[0] + tx
        const fy = srcC[1] + ty
        const deg = (srcDeg + 90) % 360
        const rc = rotatePoint(cOrig, deg)
        return {
            item_id: itemId,
            transformation: {
                rotation: deg,
                translation: [x0 + W - fy - rc[0], y0 + fx - rc[1]],
            },
        }
    })
    const keep = out.filter((p) => {
        const bb = rotatedBbox(bbox(coords), p.transformation.rotation)
        const [tx, ty] = p.transformation.translation
        return tx + bb[0] >= x0 - 1e-6 && tx + bb[2] <= x1 + 1e-6
            && ty + bb[1] >= y0 - 1e-6 && ty + bb[3] <= y1 + 1e-6
    })
    if (!keep.length) return null
    // P2 (audit 2026-09-03) : la famille est ancrée à DROITE du rect
    // (mapping x0 + W − fy) — dans une bande étroite gagnée par le
    // compte, elle laissait un vide à gauche (~18 000 mm² sur la bande
    // droite de la tôle 1 du cas de référence). Translation rigide du
    // bloc contre x0 : validité conservée (glissement vers la gauche
    // dans le rect seulement). Miroir exact du Python.
    let minX = Infinity
    for (const p of keep) {
        const bb = rotatedBbox(bbox(coords), p.transformation.rotation)
        minX = Math.min(minX, p.transformation.translation[0] + bb[0])
    }
    const shift = minX - x0
    if (shift > 1e-9) {
        for (const p of keep) {
            p.transformation.translation[0] -= shift
        }
    }
    return keep
}

function latticeVariant(coords, itemId, space, zone, threshold, deg0, yPhase, xPhase = 0) {
    const [ix0, iy0, ix1, iy1] = zone
    const rot0 = rotateRing(coords, deg0)
    const c0 = ringCentroid(rot0)
    const bb = bbox(rot0)
    const w = bb[2] - bb[0]
    const h = bb[3] - bb[1]
    if (ix1 - ix0 < w || iy1 - iy0 < h) return null
    const xL0 = c0[0] - bb[0]; const xR0 = bb[2] - c0[0]
    const yD0 = c0[1] - bb[1]; const yU0 = bb[3] - c0[1]
    const extents = (even) => even
        ? { left: xL0, right: xR0, down: yD0, up: yU0 }
        : { left: xR0, right: xL0, down: yU0, up: yD0 }

    const generate = (py, px, maxI = 80, maxJ = 220) => {
        const dy = LATTICE_DY_RATIO * py
        const yBase = yPhase === 0
            ? iy0 + yD0
            : iy0 + yU0 - dy
        const xBase = xPhase === 0 ? ix0 + xL0 : ix0 + xR0
        const cells = []
        for (let i = 0; i < maxI; i++) {
            const cx = xBase + i * px
            if (cx - Math.min(xL0, xR0) > ix1 + 1e-9) break
            for (let j = 0; j < maxJ; j++) {
                const even = ((i + j) % 2 + 2) % 2 === 0
                const cy = yBase + j * py + (even ? 0 : dy)
                const e = extents(even)
                if (cx - e.left < ix0 - 1e-9 || cx + e.right > ix1 + 1e-9) continue
                if (cy - e.down < iy0 - 1e-9 || cy + e.up > iy1 + 1e-9) continue
                cells.push({ i, j, even, cx, cy })
            }
        }
        return cells
    }

    const attachRings = (cells, src = coords) => {
        for (const c of cells) {
            const deg = c.even ? deg0 : deg0 + 180
            const ring1 = rotateRing(src, deg)
            const rc = rotatePoint(c0, c.even ? 0 : 180)
            c.ring = ring1.map(([x, y]) => [x - rc[0] + c.cx, y - rc[1] + c.cy])
        }
        return cells
    }

    // tryPitch sur un anneau DONNÉ : la dichotomie court sur l'anneau
    // décimé (perf), l'acceptation finale doit être EXACTE (anneau
    // complet) — un scallopé fin décimé accepte des pas qui chevauchent
    // en réel (constat 2026-09-02 : 95 paires à ~33 mm² sur Fillx4 en
    // navigateur, le banc serveur shapely restait exact).
    const tryPitchOn = (py, px, ring) => {
        const patch = attachRings(generate(py, px, 5, 8), ring)
        if (!patch.length) return false
        for (let a = 0; a < patch.length; a++) {
            for (let b = a + 1; b < patch.length; b++) {
                const A = patch[a]; const B = patch[b]
                if (Math.abs(A.i - B.i) > 2 || Math.abs(A.j - B.j) > 2) continue
                if (ringDist(A.ring, B.ring) < threshold - 1e-9) return false
            }
        }
        return true
    }
    const coarse = decimateRing(coords, 20)
    const tryPitch = (py, px) => tryPitchOn(py, px, coarse)

    const py0 = LATTICE_PY_RATIO * h
    const px0 = w / 2 + space
    let py = py0
    if (!tryPitch(py0, px0)) {
        let found = false
        py = py0
        for (let i = 0; i < 24; i++) {
            py *= 1.08
            if (tryPitch(py, px0)) { found = true; break }
        }
        if (!found) return null
    }
    let lo = Math.min(h * 0.85, py * 0.75)
    if (lo >= py) lo = py * 0.75
    for (let k = 0; k < 8; k++) {
        const mid = (lo + py) / 2
        if (tryPitch(mid, px0)) py = mid
        else lo = mid
    }
    let px = px0
    let loPx = Math.max(w * 0.35, w / 2)
    for (let k = 0; k < 8; k++) {
        const mid = (loPx + px) / 2
        if (tryPitch(py, mid)) px = mid
        else loPx = mid
    }
    // Acceptation EXACTE (anneau complet) : la dichotomie ci-dessus a
    // convergé sur l'anneau décimé — si le pas retenu chevauche l'anneau
    // réel, on rescale (py ET px) jusqu'à validation exacte ; variante
    // rejetée sinon (miroir de la validation shapely de structure.py).
    let guard = 0
    while (!tryPitchOn(py, px, coords)) {
        py *= 1.06
        px *= 1.06
        if (++guard > 12) return null
    }
    const cells = generate(py, px)
    if (!cells.length) return null
    const cOrig = ringCentroid(coords)
    return cells.map((c) => {
        const deg = c.even ? deg0 : deg0 + 180
        const rc = rotatePoint(cOrig, deg)
        return {
            item_id: itemId,
            transformation: { rotation: deg, translation: [c.cx - rc[0], c.cy - rc[1]] },
        }
    })
}
const QUARTER_TURNS = [0, 90, 180, 270]

function shoelace(coords) {
    // P-m.6 : boucle circulaire — exact sur anneau OUVERT (segment de
    // fermeture) comme fermé. Miroir de structure.py::_shoelace.
    let s = 0
    const n = coords.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    }
    return Math.abs(s) / 2
}

export function bbox(coords) {
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

/** Bbox d'un anneau de bbox donnée tourné de rot (multiple de 90°).
 *  Même convention que rotateRing : R(90)·(x,y) = (−y, x). */
export function rotatedBbox(bb, rotDeg) {
    const [x0, y0, x1, y1] = bb
    const r = ((rotDeg % 360) + 360) % 360
    if (r === 0) return [x0, y0, x1, y1]
    if (r === 180) return [-x1, -y1, -x0, -y0]
    if (r === 90) return [-y1, x0, -y0, x1]
    return [y0, -x1, y1, -x0]
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
        // P-m.1 : absentes → quarts de tour (rétrocompat), VIDES → [0]
        // (miroir structure.py ; l'entrée job normalise déjà).
        let rotList = geom.rotations
        if (rotList == null) rotList = QUARTER_TURNS
        else if (!rotList.length) rotList = [0]
        const rots = rotList.map((r) => ((Number(r) % 360) + 360) % 360)
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
        // P-1 : la grille pose les rectangles à rotation 0 uniquement —
        // pas de 0° dans les rotations permises → l'autre rôle, sinon pas
        // de grille (miroir structure.py::detect_structural_case).
        if (!rect.rotations.some((r) => (((r % 360) + 360) % 360) === 0)) continue
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
        // P-2 : emprise de la grille ⊆ tôle, sinon repli moteur (miroir
        // structure.py — 310 lattes posaient la 2e rangée hors tôle).
        if (space + lines * pitchY > sheetH + 1e-6) return null
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
        // latticeTop inclut déjà `space` après la dernière rangée.
        const zoneB = [space, latticeTop, sheetW - space, sheetH - space]
        return { placements, latticeExtent: latticeTop, zoneA, zoneB, zoneC,
                 zoneBTransposed: true, perLine, lines, remainder }
    }

    const perCol = Math.floor((sheetH - 2 * space - h) / pitchY) + 1
    if (perCol < 1) return null
    const nFull = Math.floor(n / perCol)
    const remainder = n - nFull * perCol
    const cols = nFull + (remainder ? 1 : 0)
    // P-2 (miroir objectif −X) : emprise ⊆ tôle, sinon repli.
    if (space + cols * pitchX > sheetW + 1e-6) return null
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
    // latticeRight = dernier carré + space. smallLattice clippe sur la
    // zone telle quelle (plus de 2e inset).
    const zoneB = [latticeRight, space, sheetW - space, sheetH - space]
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
        let leftW = 0
        if (placements && placements.length) {
            for (const p of placements) {
                const rot = Number(p.transformation?.rotation) || 0
                const [tx] = p.transformation?.translation || [0, 0]
                const bb = rotatedBbox(small.bbox, rot)
                usedW = Math.max(usedW, tx + bb[2])
                leftW = Math.min(leftW, tx + bb[0])
            }
        }
        // P-m.2 : le débordement GAUCHE est une condition SÉPARÉE (chevauchement
        // de la zone voisine) — l'ancien max(usedW, -(tx+bb0)) le comparait à
        // la largeur de zone et le laissait passer (miroir structure.py).
        const ok = !!placements && placements.length >= n
            && usedW <= solveW + 1e-3 && leftW >= -1e-3
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
            const lat = smallLattice(caseInfo.small, space, z.zone,
                { want, axis: objective === 'y' ? 'y' : 'x' })
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
        // Lattice d'abord (même pavage que A/C) : à space 2 mm le zigzag
        // calé à 0,1 était rejeté → zoneSolve moteur = tas qui élargit +X.
        // Si le lattice tient TOUT le reliquat, on l'utilise (tout-ou-rien :
        // un top-up moteur dans B écraserait les cellules).
        let got = []
        if (!bZone.transposed) {
            const latB = smallLattice(caseInfo.small, space, bZone.zone,
                { want: left, axis: objective === 'y' ? 'y' : 'x' })
            if (latB && latB.length >= left) got = latB
        }
        if (!got.length) {
            got = await zoneSolve(bZone.zone, smallSolve, space, left,
                solveFn, bZone.budget, bZone.transposed, onZone, 'B', steps, steps)
        }
        if (!got.length || nSmall - used - got.length > 0) return null
        placements.push(...got)
        used += got.length
    }
    // P-4 (audit 2026-08-31 §P-4) : filet final — TOUT bug géométrique du
    // pass finit ici en repli moteur, jamais en pièces hors tôle (miroir
    // structure.py::layout_fits_sheet + localJobPrivate garde aval).
    if (!layoutFitsSheet({ placed_items: placements }, geomBy, sheetW, sheetH)) {
        return null
    }
    return {
        placed_items: placements,
        case: { perLine: lat.perLine, lines: lat.lines, remainder: lat.remainder,
                objective, holes: holeUsed },
    }
}

/** P-4 : bbox EXTERNE de chaque placement (rotation + translation, repère
 *  tôle) ⊆ [0, w]×[0, h]. Filet du pass structurel — le moteur garde son
 *  badge insideSheet (piège #6 : le SPP sparrow n'a pas de borne dure). */
export function layoutFitsSheet(layout, geomBy, sheetW, sheetH, eps = 1e-3) {
    for (const p of layout.placed_items || []) {
        const geom = geomBy(p.item_id)
        if (!geom) return false
        const bb = rotatedBbox(bbox(geom.coords), Number(p.transformation?.rotation) || 0)
        const [tx, ty] = p.transformation.translation
        if (tx + bb[0] < -eps || ty + bb[1] < -eps) return false
        if (tx + bb[2] > sheetW + eps || ty + bb[3] > sheetH + eps) return false
    }
    return true
}

/** bbox de l'item transposé (x,y)→(y,−x) = R(−90) — frame de solve de la
 *  zone B′ −Y (MÊME formule que localJobPrivate construit l'instance :
 *  coords.map(([x, y]) => [y, -x])).
 *  P-3 (audit 2026-08-31 §P-3) : l'ancien code renvoyait R(+90) — un
 *  AUTRE angle — et le garde used_w mesurait un bord imaginaire. Attention
 *  piège #48 : rotatedBbox(90) reste (−y, x) et n'est PAS cette bbox. */
function transposedBbox(bb) {
    const [x0, y0, x1, y1] = bb
    return [y0, -x1, y1, -x0]
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
