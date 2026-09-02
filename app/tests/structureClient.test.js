import { describe, expect, it } from 'vitest'
import {
    detectStructuralCase,
    isAxisRect,
    layoutFitsSheet,
    layoutUsedWidth,
    planLattice,
    smallLattice,
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
        // zone A au-dessus des 5 restes ; zone B à droite (inset = smallLattice)
        expect(lat.zoneA[0]).toBeCloseTo(500.6, 6)
        expect(lat.zoneA[1]).toBeCloseTo(500.6, 6)
        expect(lat.zoneB[0]).toBeCloseTo(600.7, 6)
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

describe('rotatedBbox matches rotateRing', () => {
    it('R(90)=(−y,x) sur une bbox non centrée', async () => {
        const { layoutUsedWidth } = await import('../composables/structureClient')
        // Fillx4-like : x∈[−20,20], y∈[3,31]
        const ring = [[-20, 3], [20, 3], [20, 31], [-20, 31], [-20, 3]]
        const layout = {
            placed_items: [{
                item_id: 0,
                transformation: { rotation: 90, translation: [50, 0] },
            }],
        }
        const geomOf = () => ({ coords: ring })
        // R90 : x'=-y ∈ [−31,−3] ; +tx 50 → max_x = 47
        const w = layoutUsedWidth(layout, geomOf, 0)
        expect(w).toBeCloseTo(47, 5)
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
        // zone B' : au-dessus de la grille (latticeTop déjà +space), transposé
        expect(lat.zoneB[1]).toBeCloseTo(1201.3, 6)
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
        // zone C : lattice TOUT-OU-RIEN (0 appel moteur — un top-up
        // écraserait le lattice) ; B jamais appelée si C+trous suffisent.
        expect(calls).toHaveLength(0)
        const smalls = out.placed_items.filter((p) => p.item_id === 1)
        const rects = out.placed_items.filter((p) => p.item_id === 0)
        expect(rects).toHaveLength(12)
        expect(holeCalls).toHaveLength(1)
        const nHoles = holeCalls[0].slots.reduce((n, k) => n + k, 0)
        expect(out.case.holes).toBe(nHoles)
        expect(nHoles).toBe(80 - smalls.length)
        expect(nHoles).toBeGreaterThan(0)
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
        expect(out).not.toBeNull()
        expect(out.case.holes).toBeGreaterThan(0)
        expect(out.case.holes).toBeLessThan(80)
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
        // Fake ADAPTATIF : grille légale dans la bande solve (l'ancien
        // (1,1) échouait toujours au garde de débordement gauche de
        // zoneSolve — le test ne passait que parce que le lattice
        // relâché absorbait tout ; avec l'acceptation exacte des pas
        // (2026-09-02) le surplus va au moteur, le fake doit être valide.
        const solve = async (count, stripH, maxW) => {
            calls.push([Math.round(stripH), Math.round(maxW)])
            const rows = Math.max(1, Math.floor((stripH - 44) / 31))
            const cols = Math.max(1, Math.ceil(count / rows))
            const pitchX = cols > 1 ? (maxW - 42) / (cols - 1) : 0
            return Array.from({ length: count }, (_, k) => ({
                item_id: 1,
                transformation: {
                    rotation: 0,
                    translation: [22 + pitchX * Math.floor(k / rows), 22 + 31 * (k % rows)],
                },
            }))
        }
        const out = await buildStructuralLayout(items, (i) => geoms[i], 400, 2000,
            0.1, solve, 'x', null)
        expect(out).not.toBeNull()
        const smalls = out.placed_items.filter((p) => p.item_id === 1)
        expect(smalls).toHaveLength(480)
        // A/C/B : lattice d'abord. S'il reste un appel moteur, c'est B
        // (pleine hauteur) ou un tronçon A.
        if (calls.length) {
            const last = calls[calls.length - 1][0]
            expect(last === 450 || Math.abs(last - 1999.8) < 1).toBe(true)
        }
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
        // P-1 (audit 2026-08-31) : rotations explicites — sans elles,
        // le lattice ne pose plus que 0° (ancien défaut implicite : tout).
        const small = { id: 7, coords: ring, area: 550, rotations: [0, 90, 180, 270] }
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
        // bboxes dans la zone (la zone est déjà l'intérieur faisable)
        for (const w of world) {
            const xs = w.map((p) => p[0]); const ys = w.map((p) => p[1])
            expect(Math.min(...xs)).toBeGreaterThanOrEqual(500.4 - 1e-6)
            expect(Math.max(...xs)).toBeLessThanOrEqual(600.4 + 1e-6)
            expect(Math.min(...ys)).toBeGreaterThanOrEqual(500.6 - 1e-6)
            expect(Math.max(...ys)).toBeLessThanOrEqual(1999.9 + 1e-6)
        }
        // ancré sur le bord bas (pas de bande morte ~py)
        const minY = Math.min(...world.flatMap((w) => w.map((p) => p[1])))
        expect(minY).toBeLessThan(500.6 + 1.0)
    })

    it('space 1 mm et 2 mm (zone B 1000×2000) : lattice non nul', async () => {
        const { smallLattice } = await import('../composables/structureClient')
        const ring = quarterPie()
        // P-1 (audit 2026-08-31) : rotations explicites — sans elles,
        // le lattice ne pose plus que 0° (ancien défaut implicite : tout).
        const small = { id: 7, coords: ring, area: 550, rotations: [0, 90, 180, 270] }
        // zone B du cas 100 carrés 100 mm / tôle 1000×2000 (space 2 : 614)
        const at1 = smallLattice(small, 1, [514, 1, 999, 1999])
        const at2 = smallLattice(small, 2, [614, 2, 998, 1998])
        expect(at1).not.toBeNull()
        expect(at2).not.toBeNull()
        expect(at1.length).toBeGreaterThan(80)
        expect(at2.length).toBeGreaterThan(80)
        // 100 Trou + 800 Fill : 400 dans les trous, ~400 en zone B.
        expect(at2.length, `zone B space2 n=${at2.length}`).toBeGreaterThan(250)
        // collé au bord gauche (contre les carrés) : pas de couloir 2×space
        const world0 = at2[0]
        const rot = world0.transformation.rotation
        const [tx, ty] = world0.transformation.translation
        const cos = Math.cos(rot * Math.PI / 180)
        const sin = Math.sin(rot * Math.PI / 180)
        const xs = ring.map(([x, y]) => cos * x - sin * y + tx)
        expect(Math.min(...xs)).toBeLessThan(614 + 1.0)
    })

    it('bande haute étroite : le zigzag tourné 90° tient plus de pièces', async () => {
        const { smallLattice } = await import('../composables/structureClient')
        const ring = quarterPie()
        // P-1 (audit 2026-08-31) : rotations explicites — sans elles,
        // le lattice ne pose plus que 0° (ancien défaut implicite : tout).
        const small = { id: 7, coords: ring, area: 550, rotations: [0, 90, 180, 270] }
        // 100 × 1486 (colonne de reste type) : pas serré sur le grand côté.
        const out = smallLattice(small, 2, [512, 512, 612, 1998])
        expect(out).not.toBeNull()
        expect(out.length).toBeGreaterThan(120)
    })

    it('bande à peine plus haute que la pièce : les deux parités du zigzag', async () => {
        const { smallLattice } = await import('../composables/structureClient')
        const ring = quarterPie()
        // P-1 (audit 2026-08-31) : rotations explicites — sans elles,
        // le lattice ne pose plus que 0° (ancien défaut implicite : tout).
        const small = { id: 7, coords: ring, area: 550, rotations: [0, 90, 180, 270] }
        // rectangle ~508 × 58, pièce ~40 × 28, space 2 : trop court pour 2
        // pas Y, assez pour 1 rangée des DEUX parités si on ancre les deux.
        const out = smallLattice(small, 2, [2, 1940, 510, 1998])
        expect(out).not.toBeNull()
        expect(out.length, `n=${out.length}`).toBeGreaterThan(18)
    })

    it('disque : grille bbox toujours non nulle (toute forme)', async () => {
        const { smallLattice } = await import('../composables/structureClient')
        const ring = []
        for (let k = 0; k <= 24; k++) {
            const a = (k / 24) * 2 * Math.PI
            ring.push([14 * Math.cos(a), 14 * Math.sin(a)])
        }
        const out = smallLattice({ id: 1, coords: ring, area: 600 }, 0.1, [0, 0, 100.1, 500])
        expect(out).not.toBeNull()
        expect(out.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// Verrous audit 2026-08-31 (docs/PLAN-P-Q-moteur.md — miroirs T4, T6-T14)
// ---------------------------------------------------------------------------

describe('layoutFitsSheet — filet tôle (P-4, miroir structure.py)', () => {
    const geoms = { 0: geom(SQUARE), 1: geom(FAN) }

    it('rejette un placement dont la bbox sort de la tôle', () => {
        const layout = { placed_items: [
            { item_id: 0, transformation: { rotation: 0, translation: [960, 50] } },
        ] }
        expect(layoutFitsSheet(layout, (i) => geoms[i], 1000, 2000)).toBe(false)
    })

    it('accepte un placement dedans (eps 1e-3)', () => {
        const layout = { placed_items: [
            { item_id: 0, transformation: { rotation: 0, translation: [50, 50] } },
        ] }
        expect(layoutFitsSheet(layout, (i) => geoms[i], 1000, 2000)).toBe(true)
    })
})

describe('smallLattice — rotations permises (P-1, miroir structure.py)', () => {
    const quarterPie = () => {
        const r = 27.95
        const cy = 2.9
        const pts = []
        for (let k = -22; k <= 22; k++) {
            const a = (k * 45 / 22) * Math.PI / 180
            pts.push([r * Math.sin(a), cy + r * Math.cos(a)])
        }
        pts.push([0, cy])
        pts.push(pts[0])
        return pts
    }

    it('rotations=[0] : toutes les poses à 0°, aucune 90/180/270 (T6)', () => {
        const small = { id: 7, coords: quarterPie(), rotations: [0] }
        const zone = [500.4, 500.6, 600.4, 1999.9]
        const out = smallLattice(small, 0.1, zone)
        expect(out).not.toBeNull()
        for (const p of out) {
            expect((Number(p.transformation.rotation) % 360 + 360) % 360).toBe(0)
        }
        const four = smallLattice({ ...small, rotations: QUARTERS }, 0.1, zone)
        expect(out.length).toBeLessThan(four.length)
    })

    it('rotations=[0,180] : poses ∈ {0,180}, jamais 90/270 (T7)', () => {
        const small = { id: 7, coords: quarterPie(), rotations: [0, 180] }
        const out = smallLattice(small, 0.1, [0, 0, 1000, 1999.9])
        expect(out).not.toBeNull()
        for (const p of out) {
            const r = (Number(p.transformation.rotation) % 360 + 360) % 360
            expect(r === 0 || r === 180).toBe(true)
        }
    })
})

describe('detectStructuralCase — rect sans 0° et rotations vides (P-1/P-m.1)', () => {
    const make = (rectRots, smallRots) => {
        const items = [{ id: 0, demand: 100 }, { id: 1, demand: 400 }]
        const geoms = { 0: geom(SQUARE, rectRots), 1: geom(FAN, smallRots) }
        const total = 10000 * 100 + 615.7 * 400
        return { items, geoms, total }
    }

    it('rect.rotations=[90,270] : pas de grille (T8)', () => {
        const { items, geoms, total } = make([90, 270], QUARTERS)
        expect(detectStructuralCase(items, (i) => geoms[i], total)).toBeNull()
    })

    it('rotations VIDES = [0] (T14, miroir Python [] -> [0])', () => {
        const { items, geoms, total } = make([], [])
        const c = detectStructuralCase(items, (i) => geoms[i], total)
        expect(c).not.toBeNull()
        expect(c.rect.rotations).toEqual([0])
        expect(c.small.rotations).toEqual([0])
    })

    it('rotations ABSENTES = quarts de tour (rétrocompat)', () => {
        const items = [{ id: 0, demand: 100 }, { id: 1, demand: 400 }]
        const geoms = { 0: { coords: SQUARE }, 1: { coords: FAN } }
        const total = 10000 * 100 + 615.7 * 400
        const c = detectStructuralCase(items, (i) => geoms[i], total)
        expect(c).not.toBeNull()
        expect(c.rect.rotations).toEqual(QUARTERS)
    })
})

describe('planLattice — emprise ⊆ tôle (P-2, miroir structure.py)', () => {
    const slatCase = () => ({
        rect: {
            id: 0, demand: 310, rotations: QUARTERS, area: 5100,
            coords: [[0, 0], [510, 0], [510, 10], [0, 10], [0, 0]],
            bbox: [0, 0, 510, 10],
        },
        small: { id: 1, demand: 100, coords: FAN, rotations: QUARTERS, area: 615.7, bbox: [-19.8, 2.8, 19.8, 30.8] },
    })

    it('310 lattes 510×10 / 1000×2000 / space 1 : null (T9)', () => {
        expect(planLattice(slatCase(), 1000, 2000, 1)).toBeNull()
    })

    it('tôle 1100 : la grille tient, dernière colonne dans la tôle', () => {
        const lat = planLattice(slatCase(), 1100, 2000, 1)
        expect(lat).not.toBeNull()
        for (const p of lat.placements) {
            expect(p.transformation.translation[0] + 510).toBeLessThanOrEqual(1100 + 1e-6)
        }
    })
})
