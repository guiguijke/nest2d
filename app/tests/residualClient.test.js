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
        expect(layouts[0].placed_items.length).toBe(8 + n)
        expect(layouts[1].placed_items.length).toBe(21 - n)
        // Hôtes immobiles ; nichés immobiles.
        for (const l of layouts) {
            for (const p of l.placed_items) {
                if (p.item_id === 0) {
                    const [tx, ty] = p.transformation.translation
                    expect([[52, 52], [154, 52], [52, 154], [154, 154], [500, 500]])
                        .toEqual(expect.arrayContaining([[tx, ty]]))
                }
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
