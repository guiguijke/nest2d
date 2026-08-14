import { describe, expect, it } from 'vitest'
import {
    normalizeLayouts,
    sheetDims,
    layoutTransforms,
    toServerShapeAlternatives,
    expandMeta,
    applyHoleFill,
    decorateLiveLayout,
} from '../composables/localBridge'

// Sortie moteur brute (forme jagua) : SPP = solution.layout (singulier),
// BPP = solution.layouts ; rotations en DEGRÉS (jagua 0.7.x).
const sppResult = {
    problem: 'spp',
    alternatives: [{
        rank: 0, seed: 42, evaluations: 1234, strip_width: 900, density: 0.61,
        solution: {
            strip_width: 900, density: 0.61,
            layout: {
                container_id: 0,
                placed_items: [
                    { item_id: 0, transformation: { rotation: 90, translation: [10, 20] } },
                    { item_id: 1, transformation: { rotation: 0, translation: [30.5, 40.25] } },
                ],
            },
        },
    }],
}

const bppResult = {
    problem: 'bpp',
    alternatives: [{
        rank: 0, seed: 7, bias: 'left', iterations: 500, cost: 2, density: 0.55,
        solution: {
            cost: 2, density: 0.55,
            layouts: [
                { container_id: 0, placed_items: [{ item_id: 0, transformation: { rotation: 0, translation: [5, 5] } }] },
                { container_id: 1, placed_items: [{ item_id: 1, transformation: { rotation: 180, translation: [6, 7] } }] },
            ],
        },
    }],
}

const payload = {
    problem: 'spp',
    instance: {
        strip_height: 1000,
        bins: [
            { id: 0, shape: { data: { outer: [[0, 0], [1500, 0], [1500, 1000], [0, 1000], [0, 0]] } } },
            { id: 1, shape: { data: { outer: [[0, 0], [2000, 0], [2000, 1200], [0, 1200], [0, 0]] } } },
        ],
        items: [{ id: 0, demand: 2 }, { id: 1, demand: 1 }],
    },
    engineConfig: { max_strip_width: 3000, min_item_separation: 2 },
    parts: [
        { id: 0, file_slug: 'f1', handles: ['A1'], color: '#111111', coords: [[0, 0], [10, 0], [10, 10]], holes: [] },
        { id: 1, file_slug: 'f2', handles: [], color: null, coords: [[0, 0], [5, 0], [5, 5]], holes: [[[1, 1], [2, 1], [2, 2]]] },
    ],
}

describe('normalizeLayouts (SPP singulier / BPP pluriel)', () => {
    it('SPP : layout unique en tableau', () => {
        expect(normalizeLayouts(sppResult.alternatives[0].solution)).toHaveLength(1)
    })
    it('BPP : layouts conservés', () => {
        expect(normalizeLayouts(bppResult.alternatives[0].solution)).toHaveLength(2)
    })
    it('solution vide ⇒ []', () => {
        expect(normalizeLayouts(null)).toEqual([])
        expect(normalizeLayouts({})).toEqual([])
    })
})

describe('sheetDims (comme bin_dims côté worker)', () => {
    it('SPP : max_strip_width × strip_height', () => {
        const sppPayload = { instance: { strip_height: 1000 }, engineConfig: { max_strip_width: 3000 } }
        expect(sheetDims(sppPayload, 0)).toEqual([3000, 1000])
    })
    it('BPP : bbox de la tôle du container (et repli première tôle)', () => {
        expect(sheetDims(payload, 0)).toEqual([1500, 1000])
        expect(sheetDims(payload, 1)).toEqual([2000, 1200])
        expect(sheetDims(payload, 99)).toEqual([1500, 1000])
    })
})

describe('layoutTransforms (piège : degrés → radians)', () => {
    it('convertit les rotations moteur (degrés) en radians', () => {
        const partsById = new Map(payload.parts.map((p) => [String(p.id), p]))
        const t = layoutTransforms(sppResult.alternatives[0].solution.layout, partsById)
        expect(t[0].angle).toBeCloseTo(Math.PI / 2, 10)
        expect(t[1].angle).toBe(0)
        expect(t[0]).toMatchObject({ item_id: '0', file_slug: 'f1', handles: ['A1'], x: 10, y: 20 })
    })
    it('pièce inconnue du payload : transform sans métadonnées (jamais de throw)', () => {
        const t = layoutTransforms({ placed_items: [{ item_id: 99, transformation: { rotation: 45, translation: [1, 2] } }] }, new Map())
        expect(t[0]).toMatchObject({ item_id: '99', file_slug: '', handles: [], angle: Math.PI / 4 })
    })
})

describe('toServerShapeAlternatives (forme consommée par ResultModal)', () => {
    const artifacts = [{
        sheets: ['<svg/>'],
        containers: [{ bin_width: 3000, bin_height: 1000, transforms: [] }],
        report: {
            per_sheet: [
                { index: 0, sheetAreaMm2: 3000000, partsAreaMm2: 100, freeAreaMm2: 2999900, offcut: { widthMm: 500, heightMm: 400, areaMm2: 200000, reusable: true } },
                { index: 1, sheetAreaMm2: 3000000, partsAreaMm2: 100, freeAreaMm2: 2999900, offcut: { widthMm: 900, heightMm: 800, areaMm2: 720000, reusable: true } },
            ],
            totals: { sheetCount: 2, sheetAreaMm2: 6000000, partsAreaMm2: 200, freeAreaMm2: 5999800, densityPct: 0 },
            verify: { smallestGapMm: 2.0, overlapFree: true, insideSheet: true, spacingOk: true, holesFilled: 1, holesTotal: 1 },
        },
    }]

    it('BPP : strategy=bias, report étalé (verify + champs additifs), meilleur offcut', () => {
        const alts = toServerShapeAlternatives(bppResult, payload, artifacts)
        expect(alts).toHaveLength(1)
        const alt = alts[0]
        expect(alt.strategy).toBe('left')
        expect(alt.layoutCount).toBe(2)
        expect(alt.svgs).toEqual(['<svg/>'])
        // verify étalé en tête (badges du modal)
        expect(alt.report.overlapFree).toBe(true)
        expect(alt.report.holesFilled).toBe(1)
        expect(alt.report.smallestGapMm).toBe(2.0)
        // champs additifs serveur
        expect(alt.report.partsAreaMm2).toBe(200)
        expect(alt.report.iterations).toBe(500)
        expect(alt.report.vcores).toBe(1)
        expect(alt.report.sheets).toHaveLength(2)
        // offcut global = le meilleur (le plus grand) des tôles
        expect(alt.offcut).toMatchObject({ width: 900, height: 800 })
        expect(alt.report.offcut.areaMm2).toBe(720000)
    })

    it('SPP sans bias : strategy balanced ; seed préservé', () => {
        const alts = toServerShapeAlternatives(sppResult, payload, artifacts)
        expect(alts[0].strategy).toBe('balanced')
        expect(alts[0].seed).toBe(42)
        expect(alts[0].density).toBeCloseTo(0.61)
    })

    it('artefact manquant ⇒ alternative sautée (jamais de throw)', () => {
        const alts = toServerShapeAlternatives(bppResult, payload, [null])
        expect(alts).toEqual([])
    })
})

describe('expandMeta (miroir holefill.py, J-085)', () => {
    // Hôte 100×100 avec trou circulaire approché, posé en (100, 100) rot 0.
    const ring = Array.from({ length: 8 }, (_, i) => {
        const a = (2 * Math.PI * i) / 8
        return [35 * Math.cos(a), 35 * Math.sin(a)]
    })
    const parts = [
        { id: 0, coords: [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], holes: [] },
        { id: 1, coords: [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]], holes: [ring] },
    ]
    const layouts = [{
        placed_items: [{ item_id: 1, transformation: { rotation: 90, translation: [100, 100] } }],
    }]

    it('ringRotations validées seulement, entraînées par la rotation de l’hôte', () => {
        const out = expandMeta(parts, 1, 0, [2], layouts, [[0, 180]])
        expect(out[0].placed_items).toHaveLength(3)
        const added = out[0].placed_items.slice(1)
        // rotations = hrot + frot ; centre du trou entraîné par R(90)·(0,0)+(100,100)
        expect(added.map((p) => p.transformation.rotation)).toEqual([90, 270])
        expect(added[0].transformation.translation[0]).toBeCloseTo(100, 10)
        expect(added[0].transformation.translation[1]).toBeCloseTo(100, 10)
        // item_id du filler = id d'origine (number)
        expect(added[0].item_id).toBe(0)
    })

    it('sans ringRotations (legacy) : pinwheel plein', () => {
        const out = expandMeta(parts, 1, 0, [4], [{
            placed_items: [{ item_id: 1, transformation: { rotation: 0, translation: [0, 0] } }],
        }])
        expect(out[0].placed_items).toHaveLength(5)
        expect(out[0].placed_items.slice(1).map((p) => p.transformation.rotation)).toEqual([0, 90, 180, 270])
    })
})

describe('decorateLiveLayout (vue live = modal après J-085)', () => {
    const ring = Array.from({ length: 8 }, (_, i) => {
        const a = (2 * Math.PI * i) / 8
        return [35 * Math.cos(a), 35 * Math.sin(a)]
    })
    const fill = { id: 0, coords: [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], holes: [] }
    const host = { id: 1, coords: [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]], holes: [ring] }

    it('rattache les fillers meta sur une frame live (SPP)', () => {
        const evt = {
            feasible: true,
            isSpp: true,
            sheets: [[200, 200]],
            items: [[1, 0, 100, 100]],
        }
        const out = decorateLiveLayout(evt, {
            parts: [fill, host],
            engineConfig: { min_item_separation: 0 },
            meta: { host: 1, fill: 0, slots: [2], ringRotations: [[0, 180]] },
        })
        expect(out.items.length).toBeGreaterThan(evt.items.length)
        expect(out.holesFilled).toBeGreaterThan(0)
        expect(out.density).toBeGreaterThan(0)
        // l'événement moteur n'est pas muté
        expect(evt.items).toHaveLength(1)
    })

    it('frame sans pièces / sans parts : renvoyée telle quelle', () => {
        expect(decorateLiveLayout({ items: [] }, { parts: [fill] })).toEqual({ items: [] })
        expect(decorateLiveLayout({ items: [[0, 0, 0, 0]] }, { parts: [] }).items).toHaveLength(1)
    })
})

describe('applyHoleFill (exporté pour le live)', () => {
    it('ne jette jamais sur un layout vide', () => {
        expect(applyHoleFill([], [{ placed_items: [] }], 2)).toBe(0)
    })
})
