import { describe, expect, it } from 'vitest'
import {
    detectStructuralCase,
    isAxisRect,
    layoutUsedWidth,
    planLattice,
} from '../composables/structureClient'

const SQUARE = [[50, -50], [-50, -50], [-50, 50], [50, 50], [50, -50]]
const FAN = [[-19.8, 22.6], [0, 2.8], [19.8, 22.6], [0, 30.8], [-19.8, 22.6]]
const QUARTERS = [0, 90, 180, 270]
const geom = (coords, rotations = QUARTERS) => ({ coords, rotations })

describe('isAxisRect (miroir structure.py)', () => {
    it('carré fermé : vrai ; L et triangle : faux', () => {
        expect(isAxisRect(SQUARE)).toBe(true)
        expect(isAxisRect([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0]])).toBe(false)
        expect(isAxisRect([[0, 0], [10, 0], [5, 10], [0, 0]])).toBe(false)
    })
})

describe('detectStructuralCase', () => {
    const make = (nRect = 100, nSmall = 400) => {
        const items = [{ id: 0, demand: nRect }, { id: 1, demand: nSmall }]
        const geoms = { 0: geom(SQUARE), 1: geom(FAN) }
        const total = 10000 * nRect + 615.7 * nSmall
        return { items, geoms, total }
    }

    it('détecte rectangle dominant + petite pièce', () => {
        const { items, geoms, total } = make()
        const c = detectStructuralCase(items, (i) => geoms[i], total)
        expect(c.rect.id).toBe(0)
        expect(c.small.id).toBe(1)
    })

    it('3 classes / rotations non-orthogonales / rect non dominant : rejet', () => {
        const base = make()
        expect(detectStructuralCase(
            [...base.items, { id: 2, demand: 5 }],
            (i) => ({ ...base.geoms, 2: geom(FAN) })[i], base.total,
        )).toBeNull()
        expect(detectStructuralCase(
            base.items, (i) => (i === 0 ? geom(SQUARE, [0, 45]) : geom(FAN)), base.total,
        )).toBeNull()
        const few = make(10)
        expect(detectStructuralCase(few.items, (i) => few.geoms[i], few.total)).toBeNull()
    })
})

describe('planLattice — translation EXTERNE (bord gauche à space)', () => {
    const caseInfo = {
        rect: { id: 0, demand: 100, coords: SQUARE, rotations: QUARTERS, area: 10000, bbox: [-50, -50, 50, 50] },
        small: { id: 1, demand: 400, coords: FAN, rotations: QUARTERS, area: 615.7, bbox: [-19.8, 2.8, 19.8, 30.8] },
    }

    it('100 carrés sur 1000×2000 : 19/colonne, 6 colonnes, reste 5', () => {
        const lat = planLattice(caseInfo, 1000, 2000, 0.1)
        expect(lat.perLine).toBe(19)
        expect(lat.lines).toBe(6)
        expect(lat.remainder).toBe(5)
        expect(lat.placements).toHaveLength(100)
        // bord gauche du premier carré = tx + bbox.x0 = 50.1 - 50 = 0.1
        const [tx, ty] = lat.placements[0].transformation.translation
        expect(tx).toBeCloseTo(50.1, 6)
        expect(ty).toBeCloseTo(50.1, 6)
        // pitch exact colonne 2 / ligne 2
        const [px, py] = lat.placements[20].transformation.translation
        expect(px).toBeCloseTo(150.2, 6)
        expect(py).toBeCloseTo(150.2, 6)
        // zone A au-dessus des 5 restes ; zone B à droite + space
        expect(lat.zoneA[0]).toBeCloseTo(500.6, 6)
        expect(lat.zoneA[1]).toBeCloseTo(500.6, 6)
        expect(lat.zoneB[0]).toBeCloseTo(600.8, 6)
        // zone C : bande de fin de colonnes pleines (19 carrés -> 1901.9)
        expect(lat.zoneC[0]).toBeCloseTo(0.1, 6)
        expect(lat.zoneC[1]).toBeCloseTo(1902.0, 6)
        expect(lat.zoneC[2]).toBeCloseTo(500.5, 6)
        expect(lat.zoneC[3]).toBeCloseTo(1999.9, 6)
    })

    it('anneau non centré : le bord posé reste à space (convention bbox)', () => {
        const shifted = {
            ...caseInfo,
            rect: { ...caseInfo.rect, coords: SQUARE.map(([x, y]) => [x + 30, y + 40]), bbox: [-20, -10, 80, 90] },
        }
        const lat = planLattice(shifted, 1000, 2000, 0.1)
        const [tx, ty] = lat.placements[0].transformation.translation
        expect(tx + -20).toBeCloseTo(0.1, 6)
        expect(ty + -10).toBeCloseTo(0.1, 6)
    })
})

describe('layoutUsedWidth', () => {
    it('bbox externe + marge droite space', () => {
        const layout = {
            placed_items: [
                { item_id: 0, transformation: { rotation: 0, translation: [50.1, 50.1] } },
                { item_id: 0, transformation: { rotation: 90, translation: [150.2, 50.1] } },
            ],
        }
        const geomOf = () => geom(SQUARE)
        // rotation 90 d'un carré : bbox identique -> max_x = 150.2 + 50
        expect(layoutUsedWidth(layout, geomOf, 0.1)).toBeCloseTo(200.3, 6)
    })
})

describe('planLattice objectif −Y (rangées le long de X)', () => {
    const caseInfo = {
        rect: { id: 0, demand: 100, coords: SQUARE, rotations: QUARTERS, area: 10000, bbox: [-50, -50, 50, 50] },
        small: { id: 1, demand: 400, coords: FAN, rotations: QUARTERS, area: 615.7, bbox: [-19.8, 2.8, 19.8, 30.8] },
    }

    it('9 par rangée, 12 rangées, reste 1 ; zones A\'/C\' à droite, B\' au-dessus (transposée)', () => {
        const lat = planLattice(caseInfo, 1000, 2000, 0.1, 'y')
        expect(lat.perLine).toBe(9)
        expect(lat.lines).toBe(12)
        expect(lat.remainder).toBe(1)
        expect(lat.placements).toHaveLength(100)
        const [tx, ty] = lat.placements[0].transformation.translation
        expect(tx).toBeCloseTo(50.1, 6)
        expect(ty).toBeCloseTo(50.1, 6)
        // zone A' : droite du carré de reste (12e rangée)
        expect(lat.zoneA[0]).toBeCloseTo(100.2, 6)
        expect(lat.zoneA[1]).toBeCloseTo(1101.2, 6)
        // zone C' : bande verticale à droite des rangées pleines
        expect(lat.zoneC[0]).toBeCloseTo(901.0, 6)
        // zone B' : au-dessus de la grille, résolue en transposé
        expect(lat.zoneB[1]).toBeCloseTo(1201.4, 6)
        expect(lat.zoneBTransposed).toBe(true)
    })
})

describe("buildStructuralLayout holePlan (cas « trous d'abord »)", () => {
    // 12 carrés sur 500×400 : 4 colonnes de 3 (reste 0 → pas de zone A),
    // bande C au-dessus (≈400×99), zone B à droite (≈99), trous cap 48.
    const items = [{ id: 0, demand: 12 }, { id: 1, demand: 80 }]
    const geoms = { 0: geom(SQUARE), 1: geom(FAN) }
    const geomOf = (i) => geoms[i]
    const holePlan = {
        hostId: 0, fillId: 1,
        rings: [[]],
        ringRotations: [[0, 90, 180, 270]],
    }
    const fullSolve = async (count) => Array.from({ length: count }, () => ({
        item_id: 1, transformation: { rotation: 0, translation: [1, 1] },
    }))

    it("A/C d'abord, trous ensuite, B jamais si tout est absorbé", async () => {
        const { buildStructuralLayout } = await import('../composables/structureClient')
        const calls = []
        const solve = async (count, stripH, maxW) => {
            calls.push([Math.round(stripH), Math.round(maxW)])
            return fullSolve(count)
        }
        const holeCalls = []
        const out = await buildStructuralLayout(items, geomOf, 500, 400, 0.1,
            solve, 'x', null, holePlan,
            (host, fill, slots) => { holeCalls.push({ host, fill, slots: [...slots] }) })
        expect(out).not.toBeNull()
        // zone C : lattice TOUT-OU-RIEN (38 placées, 0 appel moteur — un
        // top-up écraserait le lattice) ; B jamais appelée.
        expect(calls).toHaveLength(0)
        // le surplus (80 − 38) va dans les trous
        expect(holeCalls).toHaveLength(1)
        expect(holeCalls[0].slots.reduce((n, k) => n + k, 0)).toBe(42)
        expect(out.case.holes).toBe(42)
        const rects = out.placed_items.filter((p) => p.item_id === 0)
        expect(rects).toHaveLength(12)
    })

    it('étapes cumulées step/steps dans les événements onZone', async () => {
        const { buildStructuralLayout } = await import('../composables/structureClient')
        const events = []
        await buildStructuralLayout(items, geomOf, 500, 400, 0.1, fullSolve,
            'x', (e) => events.push(e), holePlan, () => {})
        // A/C couvertes par le lattice INSTANTANÉ : aucun événement moteur
        // tant que B n'est pas atteinte — la progression reste correcte si
        // des zones moteur tournent.
        for (const e of events) {
            expect(e.step).toBeGreaterThanOrEqual(1)
            expect(e.steps).toBe(2) // C + B dans le plan
        }
    })

    it('B saturée après trous → repli null', async () => {
        const { buildStructuralLayout } = await import('../composables/structureClient')
        const solve = async (count, stripH, maxW) => (maxW > 150 ? null : fullSolve(count))
        const out = await buildStructuralLayout(items, geomOf, 500, 400, 0.1,
            solve, 'x', null, holePlan, () => {})
        // C refuse (w≈400) ; trous 48 ; B (w≈99) accepte les 32 restantes.
        expect(out).not.toBeNull()
        expect(out.case.holes).toBe(42) // 80 − 38 prises par le lattice C
    })
})

describe('zoneSteps — rectangles successifs (miroir structure.py)', () => {
    it('bande longue découpée en tronçons ~450 mm depuis l\'ancre ; bande courte intacte', async () => {
        const { zoneSteps, ZONE_STEP_MM } = await import('../composables/structureClient')
        // zone A type : 100×1499 -> 3 tronçons de ~500 empilés en Y
        const a = zoneSteps([500.4, 500.6, 600.4, 1999.9])
        expect(a).toHaveLength(3)
        expect(a[0][1]).toBeCloseTo(500.6, 6)
        expect(a[0][3]).toBeCloseTo(500.6 + 1499.3 / 3, 1)
        expect(a[2][3]).toBeCloseTo(1999.9, 6)
        // zone C type : 500×98 -> long axe X, 1 seul tronçon
        const c = zoneSteps([0.1, 1902.0, 500.3, 1999.9])
        expect(c).toHaveLength(1)
        expect(c[0]).toEqual([0.1, 1902.0, 500.3, 1999.9])
        expect(ZONE_STEP_MM).toBe(450)
    })

    it('zone A longue remplie par tronçons successifs ENTIRS avant B', async () => {
        const { buildStructuralLayout } = await import('../composables/structureClient')
        // 40 carrés 100×100 sur 400×2000 : perCol 19 -> 2 colonnes pleines +
        // reste 2 -> zone A = [200.3, 200.3, 300.3, 1999.9] (~1800 mm -> 4
        // tronçons), zone C [0.1, 1902, 200.2, 1999.9], B à droite.
        const items = [{ id: 0, demand: 40 }, { id: 1, demand: 480 }]
        const geoms = { 0: geom(SQUARE), 1: geom(FAN) }
        const calls = []
        const solve = async (count, stripH, maxW) => {
            calls.push([Math.round(stripH), Math.round(maxW)])
            return Array.from({ length: count }, () => ({
                item_id: 1, transformation: { rotation: 0, translation: [1, 1] },
            }))
        }
        const out = await buildStructuralLayout(items, (i) => geoms[i], 400, 2000,
            0.1, solve, 'x', null)
        expect(out).not.toBeNull()
        // A/C couvertes par le lattice (0 appel moteur) : le premier appel
        // moteur restant est B (pleine hauteur)
        const heights = calls.map((c) => c[0])
        expect(heights.length).toBeGreaterThanOrEqual(1)
        // le dernier appel moteur est le top-up A ou B (450 = tronçon A
        // après lattice ; B entière si elle reste)
        const last = heights[heights.length - 1]
        expect(last === 450 || Math.abs(last - 1999.8) < 1).toBe(true)
    })
})

describe('smallLattice — pavage analytique (compression finale)', () => {
    const quarterPie = () => {
        const pts = []
        const r = 27.95
        const cy = 2.9
        for (let k = -22; k <= 22; k++) {
            const a = (k * 45 / 22) * Math.PI / 180
            pts.push([r * Math.sin(a), cy + r * Math.cos(a)])
        }
        pts.push([0, cy])
        pts.push(pts[0])
        return pts
    }

    it('quart-de-disque : >120 placements, zéro conflit, bboxes dans la zone', async () => {
        const { smallLattice } = await import('../composables/structureClient')
        const ring = quarterPie()
        const small = { id: 7, coords: ring, area: 550 }
        const out = smallLattice(small, 0.1, [500.4, 500.6, 600.4, 1999.9])
        expect(out).not.toBeNull()
        expect(out.length).toBeGreaterThan(120)
        // re-validation indépendante : distance inter-pièces >= 0.1
        const world = out.map((p) => {
            const rot = p.transformation.rotation
            const [tx, ty] = p.transformation.translation
            const cos = Math.cos(rot * Math.PI / 180)
            const sin = Math.sin(rot * Math.PI / 180)
            return ring.map(([x, y]) => [cos * x - sin * y + tx, sin * x + cos * y + ty])
        })
        const seg = (px, py, ax, ay, bx, by) => {
            const dx = bx - ax; const dy = by - ay
            const l2 = dx * dx + dy * dy
            let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
            t = Math.max(0, Math.min(1, t))
            return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        }
        const dist = (c1, c2) => {
            let m = Infinity
            for (let i = 0; i < c1.length; i++) {
                const [ax, ay] = c1[i]; const [bx, by] = c1[(i + 1) % c1.length]
                for (const [px, py] of c2) m = Math.min(m, seg(px, py, ax, ay, bx, by))
            }
            for (let i = 0; i < c2.length; i++) {
                const [ax, ay] = c2[i]; const [bx, by] = c2[(i + 1) % c2.length]
                for (const [px, py] of c1) m = Math.min(m, seg(px, py, ax, ay, bx, by))
            }
            return m
        }
        // échantillon de paires proches (100 paires aléatoires déterministes)
        let seed = 42
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
        for (let n = 0; n < 100; n++) {
            const a = Math.floor(rnd() * world.length)
            const b = Math.floor(rnd() * world.length)
            if (a === b) continue
            expect(dist(world[a], world[b])).toBeGreaterThanOrEqual(0.1 - 1e-6)
        }
        // bboxes dans la zone (marge space)
        for (const w of world) {
            const xs = w.map((p) => p[0]); const ys = w.map((p) => p[1])
            expect(Math.min(...xs)).toBeGreaterThanOrEqual(500.5 - 1e-6)
            expect(Math.max(...xs)).toBeLessThanOrEqual(600.3 + 1e-6)
            expect(Math.min(...ys)).toBeGreaterThanOrEqual(500.7 - 1e-6)
            expect(Math.max(...ys)).toBeLessThanOrEqual(1999.8 + 1e-6)
        }
    })

    it("disque : rejet (pas d'entrelacement possible) -> repli moteur", async () => {
        const { smallLattice } = await import('../composables/structureClient')
        const ring = []
        for (let k = 0; k <= 24; k++) {
            const a = (k / 24) * 2 * Math.PI
            ring.push([14 * Math.cos(a), 14 * Math.sin(a)])
        }
        expect(smallLattice({ id: 1, coords: ring, area: 600 }, 0.1, [0, 0, 100.1, 500])).toBeNull()
    })
})
