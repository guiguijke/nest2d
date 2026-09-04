import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    buildGridLayoutsMulti, hostGridCapacity,
} from '../composables/structureMultiClient'

// Parité chiffrée Python ↔ JS (plan 2026-09-05 §2.3) : comptes par tôle et
// AABB à 1e-6 contre la fixture générée par core/structure_multi.py
// (workers, docker+shapely). Le pinwheel est INJECTÉ : pour cette fixture
// les 4 rotations valident dans le trou r35 (pinwheel plein, mesuré) — le
// chemin wasm réel est couvert par l'e2e.
const PARITY = JSON.parse(readFileSync(
    resolve(__dirname, './fixtures/grid_multi_parity.json'), 'utf8'))

const SQUARE = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
const FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
const QUARTERS = [0, 90, 180, 270]
const BBOX_SQUARE = [-50.0, -50.0, 50.0, 50.0]

const makeItems = (nHosts, nFans) => ([
    { id: 0, coords: SQUARE, holes: [], rotations: QUARTERS, demand: nHosts },
    { id: 1, coords: FAN, holes: [], rotations: QUARTERS, demand: nFans },
])
// Le trou vit sur l'ITEM hôte (vue originale) — pas sur la géométrie de
// détection.
const makeItemsWithHole = (nHosts, nFans) => {
    const ring = []
    for (let a = 0; a < 16; a++) {
        ring.push([35.0 * Math.cos(a / 16 * 2 * Math.PI), 35.0 * Math.sin(a / 16 * 2 * Math.PI)])
    }
    return [
        { id: 0, coords: SQUARE, holes: [ring], rotations: QUARTERS, demand: nHosts },
        { id: 1, coords: FAN, holes: [], rotations: QUARTERS, demand: nFans },
    ]
}
const geomOf = (id) => ({
    0: { coords: SQUARE, rotations: QUARTERS },
    1: { coords: FAN, rotations: QUARTERS },
}[id])
const pinwheelStub = async () => [0, 90, 180, 270]
const SHEETS = [{ width: 1000, height: 1000, count: 2 }]

describe('hostGridCapacity — miroir host_grid_capacity', () => {
    it('81 hôtes à s=0,1 ; ≤ 81 à s=2 ; hôte trop grand → 0', () => {
        expect(hostGridCapacity(BBOX_SQUARE, 1000, 1000, 0.1)).toBe(81)
        expect(hostGridCapacity(BBOX_SQUARE, 1000, 1000, 2)).toBeLessThanOrEqual(81)
        expect(hostGridCapacity(BBOX_SQUARE, 1000, 1000, 2)).toBeGreaterThanOrEqual(49)
        expect(hostGridCapacity(BBOX_SQUARE, 90, 90, 2)).toBe(0)
    })
})

for (const [name, space] of [['space2', 2], ['space01', 0.1]]) {
    describe(`buildGridLayoutsMulti — parité Python (${name})`, () => {
        it('comptes par tôle + AABB à 1e-6', async () => {
            const stats = { errors: [] }
            const layouts = await buildGridLayoutsMulti(
                makeItemsWithHole(100, 800), geomOf, SHEETS, space, stats,
                { pinwheelCapacity: pinwheelStub })
            expect(layouts, JSON.stringify(stats.errors)).not.toBeNull()
            const expected = PARITY[name].layouts
            expect(layouts).toHaveLength(expected.length)
            layouts.forEach((l, k) => {
                const hosts = l.placed_items.filter((p) => p.item_id === 0).length
                const fans = l.placed_items.filter((p) => p.item_id === 1).length
                expect(hosts).toBe(expected[k].hosts)
                expect(fans).toBe(expected[k].fans)
                expect(l.container_id).toBe(expected[k].container_id)
            })
            expect(layouts.reduce((s, l) => s + l.placed_items.length, 0)).toBe(900)
        })
    })
}

describe('buildGridLayoutsMulti — gardes', () => {
    it('stock insuffisant → null + erreur tracée (jamais une grille partielle)', async () => {
        const stats = { errors: [] }
        const layouts = await buildGridLayoutsMulti(
            makeItemsWithHole(100, 800), geomOf,
            [{ width: 1000, height: 1000, count: 1 }], 2, stats,
            { pinwheelCapacity: pinwheelStub })
        expect(layouts).toBeNull()
        expect(stats.errors.length).toBeGreaterThanOrEqual(1)
    })

    it('motif non reconnu (T-B like) → null sans erreur', async () => {
        const big1 = [[0, 0], [300, 0], [300, 200], [0, 200], [0, 0]]
        const big2 = [[0, 0], [250, 0], [250, 180], [0, 180], [0, 0]]
        const items = [
            { id: 0, coords: big1, holes: [], rotations: QUARTERS, demand: 20 },
            { id: 1, coords: big2, holes: [], rotations: QUARTERS, demand: 20 },
        ]
        const stats = { errors: [] }
        const layouts = await buildGridLayoutsMulti(
            items, (id) => ({
                0: { coords: big1, rotations: QUARTERS },
                1: { coords: big2, rotations: QUARTERS },
            }[id]), [{ width: 1500, height: 1000, count: 3 }], 2, stats)
        expect(layouts).toBeNull()
        expect(stats.errors).toHaveLength(0)
    })
})
