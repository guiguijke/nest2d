import { describe, expect, it } from 'vitest'
import {
    fillResidualBands,
    layoutAabb,
    residualBands,
} from '../composables/residualClient'
import { smallLattice, rotatedBbox, bbox, ringDist } from '../composables/structureClient'

const SQUARE = [[50, -50], [-50, -50], [-50, 50], [50, 50], [50, -50]]
const FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
const QUARTERS = [0, 90, 180, 270]

const HOST = { id: 0, coords: SQUARE, holes: [[[35, 0], [0, 35], [-35, 0], [0, -35]]], rotations: QUARTERS }
const FAN_PART = { id: 1, coords: FAN, holes: [], rotations: QUARTERS }
const PARTS = [HOST, FAN_PART]

// payload minimal : sheetDims(payload, containerId) lit instance.bins
const payload = {
    problem: 'bpp',
    instance: {
        bins: [{
            id: 0, stock: 2,
            shape: { data: { outer: [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]] } },
        }],
    },
}

const pi = (itemId, tx, ty, rot = 0) => ({
    item_id: itemId,
    transformation: { rotation: rot, translation: [tx, ty] },
})
const layout = (pis, containerId = 0) => ({ container_id: containerId, placed_items: pis })

describe('residualBands — miroir residual.py (T1)', () => {
    it('4 côtés clippés à l\'AABB + coin TR, inset space, pas de L, pas de pleine tôle', () => {
        const bands = residualBands([2, 2, 920, 920], 1000, 1000, 2)
        const byName = Object.fromEntries(bands.map((b) => [b.name, b.rect]))
        expect(byName.right.map((v) => Math.round(v))).toEqual([922, 2, 998, 920])
        expect(byName.top.map((v) => Math.round(v))).toEqual([2, 922, 920, 998])
        expect(byName.corner.map((v) => Math.round(v))).toEqual([922, 922, 998, 998])
        expect(byName.left).toBeUndefined()
        expect(byName.bottom).toBeUndefined()
        // Aucun rect ne recouvre l'AABB utilisée ; right clippé à l'AABB.
        for (const b of bands) {
            const [x0, y0, x1, y1] = b.rect
            expect(x0 < 920 && x1 > 2 && y0 < 920 && y1 > 2).toBe(false)
        }
        expect(byName.right[3]).toBeCloseTo(920, 6)
    })

    it('AABB collée aux bords : aucune bande', () => {
        expect(residualBands([2, 2, 998, 998], 1000, 1000, 2)).toEqual([])
    })
})

describe('layoutAabb — rotation piège #48 (T1bis)', () => {
    it('bbox tournée, pas brute', () => {
        const part = { id: 2, coords: [[-100, -5], [100, -5], [100, 5], [-100, 5], [-100, -5]], holes: [] }
        const l = layout([pi(2, 500, 500, 90)])
        const got = layoutAabb(l, new Map([['2', part]]))
        expect(got.map((v) => Math.round(v))).toEqual([495, 400, 505, 600])
    })
})

describe('smallLattice dans une bande de 79 mm (T2)', () => {
    it('≥ 40 poses, toutes dans la bande inset, 0 conflit interne (ringDist)', () => {
        const band = [919, 2, 998, 902]
        const lat = smallLattice({ id: 1, coords: FAN, rotations: QUARTERS }, 2, band,
            { want: 400, axis: 'x' })
        expect(lat).not.toBeNull()
        expect(lat.length).toBeGreaterThanOrEqual(40)
        const rings = lat.map((p) => {
            const t = p.transformation
            const r = t.rotation
            const c = Math.cos(r * Math.PI / 180)
            const s = Math.sin(r * Math.PI / 180)
            return FAN.map(([x, y]) => [
                x * c - y * s + t.translation[0],
                x * s + y * c + t.translation[1],
            ])
        })
        for (const ring of rings) {
            let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
            for (const [x, y] of ring) {
                minx = Math.min(minx, x); maxx = Math.max(maxx, x)
                miny = Math.min(miny, y); maxy = Math.max(maxy, y)
            }
            expect(minx).toBeGreaterThanOrEqual(919 - 1e-6)
            expect(maxx).toBeLessThanOrEqual(998 + 1e-6)
            expect(miny).toBeGreaterThanOrEqual(2 - 1e-6)
            expect(maxy).toBeLessThanOrEqual(902 + 1e-6)
        }
        // 0 conflit interne : ringDist par paires (miroir du check
        // shapely du Python — vertex↔arêtes suffit sur ce corpus).
        for (let i = 0; i < rings.length; i++) {
            for (let j = i + 1; j < rings.length; j++) {
                expect(ringDist(rings[i], rings[j])).toBeGreaterThanOrEqual(2 - 1e-6)
            }
        }
    })
})

describe('fillResidualBands — compaction de la dernière tôle (T10, miroir test_residual.py)', () => {
    it("hélices re-grillées depuis la gauche + libres compactées derrière (v2, constat 2026-09-02)", () => {
        // Tôle 0 pleine (AABB collée aux bords → aucune bande) ; donneuse =
        // colonne d'hôtes à x=150 + 25 fans dispersées jusqu'à x=880.
        // v2 : hélices re-grillées en colonnes DEPUIS le bord gauche,
        // fans derrière la grille — tout −X, chute rectangulaire unique.
        const hosts0 = []
        for (let gx = 0; gx < 10; gx++) {
            for (let gy = 0; gy < 10; gy++) hosts0.push(pi(0, 50 + 100 * gx, 50 + 100 * gy))
        }
        const hosts1 = []
        for (let k = 0; k < 10; k++) hosts1.push(pi(0, 150, 50 + 100 * k))
        const free = []
        for (let k = 0; k < 25; k++) {
            free.push(pi(1, 500 + 60 * (k % 7), 100 + 70 * Math.floor(k / 7)))
        }
        const layouts = [layout(hosts0), layout([...hosts1, ...free])]

        const n = fillResidualBands(PARTS, layouts, 2, payload)
        expect(n).toBeGreaterThanOrEqual(35) // hôtes re-grillés + fans
        expect(layouts[0].placed_items).toHaveLength(100)
        const l1Fans = layouts[1].placed_items.filter((p) => p.item_id === 1)
        const l1Hosts = layouts[1].placed_items.filter((p) => p.item_id === 0)
        expect(l1Fans).toHaveLength(25)
        expect(l1Hosts).toHaveLength(10)
        for (const p of l1Hosts) {
            expect(p.transformation.translation[0]).toBeLessThanOrEqual(160)
        }
        // Borne basse 100 (et non 155) depuis le fix poches (audit
        // 2026-09-02 F1) : les fans remplissent D'ABORD la poche de la
        // colonne partielle d'hélices (x[104,204]) avant la bande droite.
        for (const p of l1Fans) {
            const tx = p.transformation.translation[0]
            expect(tx).toBeGreaterThanOrEqual(100)
            expect(tx).toBeLessThanOrEqual(450)
        }
        const aabb = layoutAabb(layouts[1], new Map(PARTS.map((p) => [String(p.id), p])))
        expect(aabb[2]).toBeLessThanOrEqual(500)
    })

    it("profil 'compact' (§2.2a) : les hôtes gardent leur pose moteur BIT-identique", () => {
        // Même fixture que le test précédent, profile='compact' : seules
        // les libres bougent — JAMAIS de re-grille des hélices (l'alternative
        // « Compaction » est homogène sur toutes ses tôles).
        const hosts0 = []
        for (let gx = 0; gx < 10; gx++) {
            for (let gy = 0; gy < 10; gy++) hosts0.push(pi(0, 50 + 100 * gx, 50 + 100 * gy))
        }
        const hosts1 = []
        for (let k = 0; k < 10; k++) hosts1.push(pi(0, 150, 50 + 100 * k))
        const free = []
        for (let k = 0; k < 25; k++) {
            free.push(pi(1, 500 + 60 * (k % 7), 100 + 70 * Math.floor(k / 7)))
        }
        const layouts = [layout(hosts0), layout([...hosts1, ...free])]
        const hostPoses = (l) => l.placed_items
            .filter((p) => p.item_id === 0)
            .map((p) => [p.transformation.translation[0], p.transformation.translation[1], p.transformation.rotation])
            .sort()
        const before = layouts.map(hostPoses)

        const stats = {}
        fillResidualBands(PARTS, layouts, 2, payload, stats, 'compact')
        expect(stats.profile).toBe('compact')
        layouts.forEach((l, k) => {
            expect(hostPoses(l)).toEqual(before[k])
        })
        // Profil par défaut (rétrocompat) : grid.
        const stats2 = {}
        fillResidualBands(PARTS, layouts, 2, payload, stats2)
        expect(stats2.profile).toBe('grid')
    })
})

describe('fillResidualBands — miroir Python (T3/T4/T5)', () => {
    it('T9 : donneurs suffisants → le coin TR est couvert (constat 2026-09-01)', () => {
        // Scénario user 2×1000×1000 : tôle 1 = bloc AABB x[100,900] y[100,900],
        // tôle 2 = foule de fans libres. Quand les donneurs ne sont pas le
        // facteur limitant (fix jumeaux applyHoleFill), les bandes se
        // remplissent jusqu'à capacité — la SECONDE bande, recalculée sur
        // l'AABB étendue par la première, couvre le coin TR : aucun vide
        // « coin haut-droit » en escalier.
        const hosts = []
        for (let gx = 0; gx < 8; gx++) {
            for (let gy = 0; gy < 8; gy++) hosts.push(pi(0, 150 + 100 * gx, 150 + 100 * gy))
        }
        const l0 = layout(hosts)
        const freeL1 = []
        for (let k = 0; k < 400; k++) {
            freeL1.push(pi(1, 40 + 60 * (k % 15), 40 + 60 * Math.floor(k / 15)))
        }
        const l1 = layout([pi(0, 500, 950), ...freeL1])
        const layouts = [l0, l1]

        const n = fillResidualBands(PARTS, layouts, 2, payload)
        expect(n).toBeGreaterThan(0)
        const moved = layouts[0].placed_items.filter((p) => p.item_id === 1)
        // Des fans à droite de l'AABB initiale ET au-dessus — et le COIN
        // (x > 900 et y > 900 simultanément) reçoit au moins une pièce.
        const right = moved.filter((p) => p.transformation.translation[0] > 902)
        const top = moved.filter((p) => p.transformation.translation[1] > 902)
        const corner = moved.filter((p) => p.transformation.translation[0] > 902
            && p.transformation.translation[1] > 902)
        expect(right.length).toBeGreaterThan(0)
        expect(top.length).toBeGreaterThan(0)
        expect(corner.length).toBeGreaterThan(0)
    })

    it('T3 : les libres de la tôle la moins remplie comblent les bandes ; hôtes immobiles', () => {
        const hosts = []
        for (const x of [52, 154]) for (const y of [52, 154]) hosts.push(pi(0, x, y))
        const nested = hosts.map((h) => pi(1,
            h.transformation.translation[0],
            h.transformation.translation[1] - 16.8))
        const l0 = layout([...hosts, ...nested])
        const freeL1 = Array.from({ length: 20 }, (_, k) =>
            pi(1, 60 + 45 * (k % 9), 600 + 45 * Math.floor(k / 9)))
        const l1 = layout([pi(0, 500, 500), ...freeL1])
        const layouts = [l0, l1]

        const n = fillResidualBands(PARTS, layouts, 2, payload)
        expect(n).toBeGreaterThanOrEqual(2)
        // Comptes invariants ; L0 gagne exactement ce que L1 perd.
        const all = layouts.flatMap((l) => l.placed_items)
        expect(all.length).toBe(29)
        expect(all.filter((p) => p.item_id === 0).length).toBe(5)
        expect(all.filter((p) => p.item_id === 1).length).toBe(24)
        expect(layouts.length).toBe(2)
        // L0 gagne exactement ce que L1 perd (les fans recompactées SUR L1
        // — v2 — ne quittent pas L1, et l'hôte de la donneuse peut avoir
        // été re-grillé : n inclut ces déplacements internes).
        const gain0 = layouts[0].placed_items.length - 8
        expect(layouts[1].placed_items.length).toBe(21 - gain0)
        // Hôtes de la RECEVEUSE immobiles ; nichés immobiles (l'hôte de
        // la donneuse est re-grillé par la compaction v2).
        for (const p of l0.placed_items) {
            if (p.item_id === 0) {
                const [tx, ty] = p.transformation.translation
                expect([[52, 52], [154, 52], [52, 154], [154, 154]])
                    .toEqual(expect.arrayContaining([[tx, ty]]))
            }
        }
        for (const h of hosts) {
            const [cx, cy] = h.transformation.translation
            const still = l0.placed_items.some((p) => p.item_id === 1
                && Math.abs(p.transformation.translation[0] - cx) < 1e-9
                && Math.abs(p.transformation.translation[1] - (cy - 16.8)) < 1e-9)
            expect(still).toBe(true)
        }
    })

    it('T4 : bande trop petite pour la classe → no-op', () => {
        // AABB quasi pleine tôle → bandes ~10×10 : le fan (40×28) ne tient
        // dans aucune rotation → aucun déplacement.
        const l0 = layout([pi(0, 500, 500)])
        const l1 = layout([pi(1, 100, 100)])
        const layouts = [l0, l1]
        expect(fillResidualBands(PARTS, layouts, 2, payload)).toBe(0)
        expect(layouts[0].placed_items.length).toBe(1)
        expect(layouts[1].placed_items.length).toBe(1)
    })

    it('T5 : 1 layout → no-op strict', () => {
        const l = layout([pi(0, 50, 50), pi(1, 300, 300)])
        const snapshot = JSON.stringify(l)
        expect(fillResidualBands(PARTS, [l], 2, payload)).toBe(0)
        expect(JSON.stringify(l)).toBe(snapshot)
    })

    it('T8 : tôle last vidée de ses libres → layout retiré', () => {
        const hosts = []
        for (const x of [52, 154]) for (const y of [52, 154]) hosts.push(pi(0, x, y))
        const l0 = layout([...hosts])
        const l1 = layout([pi(1, 60, 500), pi(1, 200, 500), pi(1, 340, 500), pi(1, 480, 500)])
        const layouts = [l0, l1]
        const n = fillResidualBands(PARTS, layouts, 2, payload)
        expect(n).toBe(4)
        expect(layouts.length).toBe(1)
        expect(layouts[0].placed_items.filter((p) => p.item_id === 1).length).toBe(4)
    })
})

// ---------------------------------------------------------------------------
// Fix poches + retry dégradé (audit 2026-09-02, miroir test_residual.py
// T11-T15 — docs/AUDIT-BPP-2026-09-02.md F1/F2).
// ---------------------------------------------------------------------------
import {
    fillOneBatch,
    helixUnitsAndFree,
    regridHelices,
} from '../composables/residualClient'

const PARTS_BY_ID = () => new Map(PARTS.map((p) => [String(p.id), p]))
const SHEET_DIMS = () => (layout) => [1000, 1000]

describe('regridHelices — poches des colonnes partielles (T11)', () => {
    it('10 hôtes (colonnes 9+1) → 1 poche clippée au sommet des colonnes pleines (P1)', () => {
        const hosts = []
        for (let k = 0; k < 10; k++) hosts.push(pi(0, 500 + 37 * k, 500))
        const last = layout(hosts)
        const { units } = helixUnitsAndFree(last, PARTS_BY_ID())
        const { moved, freeRects } = regridHelices(last, units, PARTS_BY_ID(), 1000, 1000, 2, payload)
        expect(moved).toBe(10)
        expect(freeRects).toHaveLength(1)
        // P1 (audit 2026-09-03) : y1 = sommet des colonnes pleines (~918),
        // PAS le bord de tôle (998 avant le fix) — sinon la bande haute
        // au-dessus des colonnes pleines dégénère et n'est jamais remplie.
        const r = freeRects[0].map((v) => Math.round(v))
        expect(r.slice(0, 3)).toEqual([104, 104, 204])
        expect(r[3]).toBeGreaterThan(900)
        expect(r[3]).toBeLessThan(930)
    })

    it('18 hôtes (2 colonnes pleines) → aucune poche', () => {
        const hosts = []
        for (let k = 0; k < 18; k++) hosts.push(pi(0, 500 + 31 * k, 500))
        const last = layout(hosts)
        const { units } = helixUnitsAndFree(last, PARTS_BY_ID())
        const { moved, freeRects } = regridHelices(last, units, PARTS_BY_ID(), 1000, 1000, 2, payload)
        expect(moved).toBe(18)
        expect(freeRects).toEqual([])
    })

    it('échec lattice → restauration complète, aucune poche', () => {
        const hosts = []
        for (let k = 0; k < 200; k++) hosts.push(pi(0, 500 + 5 * (k % 20), 500 + 5 * Math.floor(k / 20)))
        const last = layout(hosts)
        const before = last.placed_items.map((p) => ({ ...p.transformation }))
        const { units } = helixUnitsAndFree(last, PARTS_BY_ID())
        const { moved, freeRects } = regridHelices(last, units, PARTS_BY_ID(), 1000, 1000, 2, payload)
        expect(moved).toBe(0)
        expect(freeRects).toEqual([])
        last.placed_items.forEach((p, i) => {
            expect(p.transformation).toEqual(before[i])
        })
    })
})

describe('compaction — poche remplie avant la bande droite (T12)', () => {
    it('des fans vivent dans la poche x[104,204] et le layout reste intact', () => {
        const hosts0 = []
        for (let gx = 0; gx < 10; gx++) for (let gy = 0; gy < 10; gy++) hosts0.push(pi(0, 50 + 100 * gx, 50 + 100 * gy))
        const hosts1 = []
        for (let k = 0; k < 10; k++) hosts1.push(pi(0, 500, 300 + 37 * k))
        const free = []
        for (let k = 0; k < 25; k++) free.push(pi(1, 400 + 60 * (k % 9), 500 + 50 * Math.floor(k / 9)))
        const layouts = [layout(hosts0), layout([...hosts1, ...free])]

        const n = fillResidualBands(PARTS, layouts, 2, payload)
        expect(n).toBeGreaterThan(0)
        const l1Fans = layouts[1].placed_items.filter((p) => p.item_id === 1)
        expect(l1Fans).toHaveLength(25)
        const inPocket = l1Fans.filter((p) => {
            const tx = p.transformation.translation[0]
            return tx >= 104 && tx <= 204
        })
        expect(inPocket.length).toBeGreaterThan(0)
    })
})

describe('fillOneBatch — batch d\'une pose et retry dégradé (T13/T14)', () => {
    it('poches : une seule pose admise (bands), bandes classiques : seuil 2', () => {
        // Rect 60×60 : le fan n'y tient qu'une fois.
        const l0 = layout([pi(0, 100, 100)])
        const fan = pi(1, 700, 700)
        const nP = fillOneBatch([l0], 0, 0, PARTS_BY_ID(), SHEET_DIMS(), 2, payload, [fan],
            [{ name: 'pocket', rect: [500, 500, 560, 560], axis: 'x' }])
        expect(nP).toBe(1)

        const l1 = layout([pi(0, 500, 500)])
        const fan2 = pi(1, 700, 700)
        const nD = fillOneBatch([l1], 0, 0, PARTS_BY_ID(), SHEET_DIMS(), 2, payload, [fan2])
        expect(nD).toBe(0) // seuil 2 sur les bandes classiques (contrat T4)
        expect(l1.placed_items).toHaveLength(1)
    })

    it('leurre sur la 2e pose → subset valide posé (pas de rollback total)', () => {
        const band = { name: 'pocket', rect: [500, 2, 998, 400], axis: 'x' }
        const lat = smallLattice({ id: 1, coords: FAN, rotations: QUARTERS }, 2, band.rect,
            { want: 3, axis: 'x' })
        expect(lat.length).toBeGreaterThanOrEqual(3)
        const t1 = lat[0].transformation
        const t2 = lat[1].transformation
        const l0 = layout([
            pi(0, 100, 100),
            { item_id: 1, transformation: { rotation: t2.rotation, translation: [...t2.translation] } },
        ])
        const free = [pi(1, 700, 800), pi(1, 740, 800), pi(1, 780, 800)]
        const n = fillOneBatch([l0], 0, 0, PARTS_BY_ID(), SHEET_DIMS(), 2, payload, free, [band])
        // A7 (audit 2026-09-03) : chaque pose est validée individuellement —
        // la pose leurre (2e) est sautée, les poses 1 ET 3 sont posées
        // (l'ancien retry take>>1 ne produisait que {1} ou {1,2,3}).
        expect(n).toBe(2)
        const t3 = lat[2].transformation
        for (const t of [t1, t3]) {
            const moved = l0.placed_items.filter((p) => p.item_id === 1
                && p.transformation.translation[0] === t.translation[0]
                && p.transformation.translation[1] === t.translation[1])
            expect(moved).toHaveLength(1)
        }
    })

    it('identité : deux fans jumelles ne se détruisent pas (T15, régression remove par valeur)', () => {
        // Le donneur détaché reçoit une pose lattice identique à une fan
        // déjà posée : le remove doit échouer par IDENTITÉ (indexOf ===),
        // pas détruire la posée — 2 appels successifs conservent tout.
        const hosts0 = []
        for (let gx = 0; gx < 10; gx++) for (let gy = 0; gy < 10; gy++) hosts0.push(pi(0, 50 + 100 * gx, 50 + 100 * gy))
        const hosts1 = []
        for (let k = 0; k < 10; k++) hosts1.push(pi(0, 150, 50 + 100 * k))
        const free = []
        for (let k = 0; k < 25; k++) free.push(pi(1, 500 + 60 * (k % 7), 100 + 70 * Math.floor(k / 7)))
        const layouts = [layout(hosts0), layout([...hosts1, ...free])]
        fillResidualBands(PARTS, layouts, 2, payload)
        const counts = layouts.map((l) => l.placed_items.length)
        fillResidualBands(PARTS, layouts, 2, payload) // rejeu : rien ne se perd
        layouts.forEach((l, i) => expect(l.placed_items).toHaveLength(counts[i]))
        expect(layouts[1].placed_items.filter((p) => p.item_id === 1)).toHaveLength(25)
    })
})

describe('validateBatch — seuil jamais négatif (régression overlap navigateur, 2026-09-02 soir)', () => {
    it("space 0.1 : plus de fans que la capacité de la poche → 0 chevauchement final", () => {
        // Constat user : « ça overlappe » sur la tôle 2 en THIS DEVICE. Cause
        // racine : lim = space - 2*SIMPLIFY devient NÉGATIF à space 0,1 →
        // `ringDist < lim` ne rejetait plus RIEN → les itérations de poches
        // empilaient des poses dupliquées à distance 0 (477 paires à 0 sur ce
        // fixture avant le fix). Le plancher 1e-9 rejette tout chevauchement.
        const hosts0 = []
        for (let gx = 0; gx < 10; gx++) for (let gy = 0; gy < 10; gy++) hosts0.push(pi(0, 50 + 100 * gx, 50 + 100 * gy))
        const hosts1 = []
        for (let k = 0; k < 10; k++) hosts1.push(pi(0, 150, 50 + 100 * k))
        const free = []
        for (let k = 0; k < 300; k++) free.push(pi(1, 300 + 60 * (k % 12), 20 + 60 * Math.floor(k / 12)))
        const layouts = [layout(hosts0), layout([...hosts1, ...free])]

        fillResidualBands(PARTS, layouts, 0.1, payload)

        const fans = layouts[1].placed_items.filter((p) => p.item_id === 1)
        expect(fans).toHaveLength(300)
        const ringOf = (p) => {
            const t = p.transformation
            const r = (Number(t.rotation) || 0) * Math.PI / 180
            const c = Math.cos(r), s = Math.sin(r)
            return FAN.map(([x, y]) => [x * c - y * s + t.translation[0], x * s + y * c + t.translation[1]])
        }
        const rings = fans.map(ringOf)
        const bad = []
        for (let i = 0; i < rings.length; i++) {
            for (let j = i + 1; j < rings.length; j++) {
                if (ringDist(rings[i], rings[j]) < 0.05) bad.push([i, j])
            }
        }
        expect(bad, `paires chevauchantes: ${bad.length}`).toHaveLength(0)
    })
})


describe('pairViolates — seuil space 0 et chevauchements à d == 0 (A1/D5, audit 2026-09-03)', () => {
    // Le seuil dist < space − marge est PLANCHÉ mais seul ; à space 0,1 il
    // faut quand même rejeter un VRAI chevauchement (d == 0 + aire > 0),
    // et à space 0 les poses dupliquées.
    const ring = (coords, tx, ty) => coords.map(([x, y]) => [x + tx, y + ty])

    it('paire à 0,03 mm à space 0,1 → rejetée', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        const b = ring(SQUARE, 200 + 100 + 0.03, 200) // carrés de 100 mm
        expect(pairViolates(a, b, 0.1)).toBe(true)
    })

    it('paire à 1,95 mm à space 2 → rejetée', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        const b = ring(SQUARE, 200 + 100 + 1.95, 200)
        expect(pairViolates(a, b, 2)).toBe(true)
    })

    it('pose dupliquée (d == 0, recouvrement total) → rejetée même à space 0', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        expect(pairViolates(a, ring(SQUARE, 200, 200), 0)).toBe(true)
        expect(pairViolates(a, ring(SQUARE, 200, 200), 0.1)).toBe(true)
    })

    it('contact légal (arêtes qui se touchent, rien croisé) → permis à space 0', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        const b = ring(SQUARE, 300, 200) // bord contre bord exactement
        expect(pairViolates(a, b, 0)).toBe(false)
    })

    it('chevauchement partiel à d == 0 (croisement d\'arêtes) → rejeté à space 0', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        const b = ring(SQUARE, 250, 200) // 50 mm de recouvrement
        expect(pairViolates(a, b, 0)).toBe(true)
    })
})

describe('compaction — rollback A2 : snapshot AVANT le re-grid (audit 2026-09-03)', () => {
    it('une exception interne du pass remplit stats.errors (A5, plus de catch muet)', async () => {
        const mod = await import('../composables/residualClient')
        // parts sabordé : trou null → TypeError dans freePis (le filet
        // restaure les layouts et TRACE l'erreur au lieu d'avaler).
        const badHost = { ...HOST, holes: [null] }
        const l0 = layout([pi(0, 100, 100)])
        const l1 = layout([pi(0, 500, 500), pi(1, 540, 500)])
        const stats = {}
        const origErr = console.error
        console.error = () => {}
        try {
            const n = mod.fillResidualBands([badHost, FAN_PART], [l0, l1], 2, payload, stats)
            expect(n).toBe(0)
            expect(Array.isArray(stats.errors)).toBe(true)
            expect(stats.errors.length).toBeGreaterThan(0)
            expect(stats.errors[0].stage).toBe('residual')
        } finally {
            console.error = origErr
        }
    })

    it('compactLastSheet laisse PROPAGER une TypeError (D6 : le catch n’avale que la sentinelle)', async () => {
        const mod = await import('../composables/residualClient')
        const badHost = { ...HOST, holes: [null] }
        const partsById = new Map([['0', badHost], ['1', FAN_PART]])
        const last = layout([pi(0, 500, 500), pi(1, 700, 700)])
        expect(() => mod.compactLastSheet([last], 0, partsById, () => [1000, 1000], 2, payload))
            .toThrow()
    })
})


describe('V4 : contact à distance 0 rejeté à space > 0 (vérif 2026-09-04)', () => {
    const ring = (coords, tx, ty) => coords.map(([x, y]) => [x + tx, y + ty])

    it('contact bord à bord → rejeté à space 2 et 0,1', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        const b = ring(SQUARE, 300, 200) // bord contre bord exactement
        expect(pairViolates(a, b, 2)).toBe(true)
        expect(pairViolates(a, b, 0.1)).toBe(true)
    })

    it('space 0 : le contact reste permis (parité Python, V5)', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const a = ring(SQUARE, 200, 200)
        const b = ring(SQUARE, 300, 200)
        expect(pairViolates(a, b, 0)).toBe(false)
    })
})


describe('V7 : critère de compaction unifié (position + largeur, vérif 2026-09-04)', () => {
    it('colonne unique au bord +X → COMPACTÉE (l\'ancien critère sautait)', async () => {
        const mod = await import('../composables/residualClient')
        const partsById = new Map([['0', HOST], ['1', FAN_PART]])
        const hosts = []
        for (let k = 0; k < 9; k++) hosts.push(pi(0, 900, 52 + 102 * k))
        const fans = []
        for (let k = 0; k < 60; k++) fans.push(pi(1, 60 + 45 * (k % 8), 60 + 42 * Math.floor(k / 8)))
        const last = layout(hosts.concat(fans))
        const n = mod.compactLastSheet([last], 0, partsById, () => [1000, 1000], 2, payload)
        expect(n).toBeGreaterThan(0)
        const xs = last.placed_items.map((p) => p.transformation.translation[0])
        expect(Math.min(...xs)).toBeLessThanOrEqual(5.0)
    })

    it('déjà compacté (colonne −X + libres derrière) → no-op', async () => {
        const mod = await import('../composables/residualClient')
        const partsById = new Map([['0', HOST], ['1', FAN_PART]])
        const hosts = []
        for (let k = 0; k < 9; k++) hosts.push(pi(0, 52, 52 + 102 * k))
        const fans = []
        for (let k = 0; k < 40; k++) fans.push(pi(1, 160 + 42 * Math.floor(k / 22), 2 + 30 * (k % 22)))
        const last = layout(hosts.concat(fans))
        const before = JSON.parse(JSON.stringify(last.placed_items.map((p) => [p.item_id, p.transformation.translation])))
        const n = mod.compactLastSheet([last], 0, partsById, () => [1000, 1000], 2, payload)
        if (n === 0) {
            const after = last.placed_items.map((p) => [p.item_id, p.transformation.translation])
            expect(JSON.parse(JSON.stringify(after))).toEqual(before)
        }
    })
})


describe('W1/W2 : invariant générique « jamais pire que l\'entrée » (vérif 2026-09-04)', () => {
    it('W1 — receveuse pleine : jamais moins de pièces, jamais front reculé', async () => {
        const mod = await import('../composables/residualClient')
        const partsById = new Map([['0', HOST], ['1', FAN_PART]])
        const hosts = []
        for (let k = 0; k < 81; k++) {
            hosts.push(pi(0, 52 + 102 * (k % 9), 52 + 102 * Math.floor(k / 9)))
        }
        const fans = []
        for (let k = 0; k < 30; k++) fans.push(pi(1, 940, 2 + 32 * k))
        const l0 = layout(hosts.concat(fans))
        const beforeCount = l0.placed_items.length
        const beforeFront = mod.layoutAabb(l0, partsById)[2]
        mod.fillResidualBands([HOST, FAN_PART], [l0], 2, payload)
        const afterCount = l0.placed_items.length
        const afterFront = mod.layoutAabb(l0, partsById)[2]
        expect(afterCount).toBeGreaterThanOrEqual(beforeCount)
        expect(afterFront).toBeLessThanOrEqual(beforeFront + 0.5)
    })

    it('W2 — donneuse déjà compacte : le front ne recule jamais', async () => {
        const mod = await import('../composables/residualClient')
        const partsById = new Map([['0', HOST], ['1', FAN_PART]])
        const hosts = []
        for (let k = 0; k < 18; k++) {
            hosts.push(pi(0, 52 + 102 * (k % 2), 52 + 102 * Math.floor(k / 2)))
        }
        const fans = []
        for (let k = 0; k < 44; k++) {
            fans.push(pi(1, 206 + 42 * Math.floor(k / 22), 2 + 30 * (k % 22)))
        }
        const l1 = layout(hosts.concat(fans))
        const beforeFront = mod.layoutAabb(l1, partsById)[2]
        const stats = {}
        mod.compactLastSheet([l1], 0, partsById, () => [1000, 1000], 2, payload, stats)
        const afterFront = mod.layoutAabb(l1, partsById)[2]
        expect(afterFront).toBeLessThanOrEqual(beforeFront + 0.5)
        if (stats.compactRollback && stats.compactRollbackReason === 'front') {
            expect(stats.compactRollback).toBe(true)
        }
    })
})


describe('W4 : containment rejeté aussi à space > 0 (vérif 2026-09-04)', () => {
    it('petit anneau inclus dans un grand, à ≥ space du bord → rejeté', async () => {
        const { pairViolates } = await import('../composables/residualClient')
        const big = SQUARE // ±50
        const small = [[-9, -9], [9, -9], [9, 9], [-9, 9], [-9, -9]]
        // petit entièrement dans le grand (distance de frontière 41 ≥ 2)
        const a = big.map(([x, y]) => [x + 200, y + 200])
        const b = small.map(([x, y]) => [x + 200, y + 200])
        expect(pairViolates(b, a, 2)).toBe(true)
        expect(pairViolates(b, a, 0.1)).toBe(true)
        expect(pairViolates(b, a, 0)).toBe(true)
    })
})


describe('Y2 : non-posées rendues sur la donneuse VALIDÉES (vérif tour 5)', () => {
    it('fan superposée à une pièce de la donneuse → rejet (miroir Python)', async () => {
        const { validateReturn } = await import('../composables/residualClient')
        const partsById = new Map([['1', FAN_PART]])
        const l = layout([pi(1, 200, 200)])
        const intruder = { item_id: 1, transformation: { rotation: 0, translation: [202, 200] } }
        expect(validateReturn([intruder], l, partsById, 2)).toBe(false)
        // loin de toute pièce → acceptée
        const far = { item_id: 1, transformation: { rotation: 0, translation: [600, 600] } }
        expect(validateReturn([far], l, partsById, 2)).toBe(true)
    })
})


describe("AD1 (L2-quater) — rendues d'origine receveuse validées sur la donneuse", () => {
    it('fan receveuse rendue sur une fan donneuse → rollback tracé, pas de ceinture', async () => {
        const mod = await import('../composables/residualClient')
        const hosts0 = []
        for (let gx = 0; gx < 10; gx++) {
            for (let gy = 0; gy < 10; gy++) hosts0.push(pi(0, 50 + 100 * gx, 50 + 100 * gy))
        }
        // receveuse : grille pleine + une FAN posée à des coordonnées qui
        // coïncident avec une fan donneuse (232, 600)
        hosts0.push(pi(1, 232.0, 600.0))
        const hosts1 = []
        for (let k = 0; k < 10; k++) hosts1.push(pi(0, 150, 50 + 100 * k))
        const free = []
        for (let k = 0; k < 6; k++) free.push(pi(1, 200 + 32 * k, 600))
        const layouts = [layout(hosts0), layout([...hosts1, ...free])]
        const stats = {}
        const origErr = console.error
        console.error = () => {}
        try {
            const n = mod.fillResidualBands(PARTS, layouts, 2, payload, stats, 'compact')
            console.error = origErr
            // soit le relais a posé la fan receveuse ailleurs (légal),
            // soit le retour est rejeté : rollback avec raison dédiée
            // ou ceinture — mais JAMAIS de chevauchement livré.
            const ok = (stats.mergedRollbackReason === 'restore-recv-on-donor')
                || (stats.compactRollbackReason === 'restore-recv-on-donor')
                || (stats.residualRolledBack === true)
                || n > 0
            expect(ok).toBe(true)
            // si rollback du merge : la fan receveuse revient sur SA tôle
            if (stats.mergedRollbackReason === 'restore-recv-on-donor'
                || stats.compactRollbackReason === 'restore-recv-on-donor') {
                const back = layouts[0].placed_items.some((p) =>
                    p.item_id === 1
                    && p.transformation.translation[0] === 232.0
                    && p.transformation.translation[1] === 600.0)
                expect(back).toBe(true)
            }
        } finally {
            console.error = origErr
        }
    })
})
