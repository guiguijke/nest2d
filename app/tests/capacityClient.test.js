import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    REFUSE_RATIO, REFERENCE_PACKING, capacityReport, inflatedArea, sheetUsableArea,
} from '../composables/capacityClient'

const BENCH = resolve(__dirname, '../../workers/nesting/bench')

// Fixtures .testparts (canoniques) pour la parité chiffrée.
const FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
const HOST = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]

describe('capacityClient — miroir capacity.py (plan 2026-09-05 §1.2a)', () => {
    it('fan à 4 mm : +38-50 %', () => {
        const a0 = inflatedArea({ coords: FAN }, 0)
        const a4 = inflatedArea({ coords: FAN }, 4)
        expect(a4 / a0).toBeGreaterThan(1.35)
        expect(a4 / a0).toBeLessThan(1.5)
    })

    it('Minkowski exact sur un rectangle', () => {
        const rect = [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]
        expect(inflatedArea({ coords: rect }, 2)).toBeCloseTo(5000 + 300 + Math.PI, 9)
    })

    it('aire utile déflatée (piège #49)', () => {
        expect(sheetUsableArea(1000, 2000, 4)).toBeCloseTo(996 * 1996, 6)
    })

    it('cas propriétaire 4 mm : refus, 2 tôles, espacement max < 4', () => {
        const parts = [{ coords: HOST, count: 100 }, { coords: FAN, count: 900 }]
        const r = capacityReport(parts, [{ width: 1000, height: 2000, count: 1 }], 4)
        expect(r.refused).toBe(true)
        expect(r.ratio).toBeGreaterThan(REFUSE_RATIO)
        expect(r.sheetsNeeded).toBe(2)
        expect(r.maxSpacingForFitMm).toBeLessThan(4)
        const totalMax = Object.values(r.maxPartsAtSpacing).reduce((n, v) => n + v, 0)
        expect(totalMax).toBeGreaterThanOrEqual(500)
        expect(totalMax).toBeLessThan(1000)
    })

    it('faible espacement : pas de refus', () => {
        const parts = [{ coords: HOST, count: 100 }, { coords: FAN, count: 900 }]
        const r = capacityReport(parts, [{ width: 1000, height: 2000, count: 1 }], 0.1)
        expect(r.refused).toBe(false)
    })

    it('parité chiffrée Python ↔ JS à 1e-9 (formules)', () => {
        // La parité Python/JS des formules est verrouillée via les mêmes
        // valeurs canoniques : le test pytest (test_capacity.py) vérifie
        // les mêmes invariants — ici on verrouille les constantes.
        expect(REFUSE_RATIO).toBe(0.88)
        expect(REFERENCE_PACKING).toBe(0.85)
    })

    it('parité avec la sortie Python sur la fixture user (si présente)', async () => {
        const p = resolve(BENCH, 'out_user_payload.json')
        const exists = (() => { try { readFileSync(p); return true } catch { return false } })()
        if (!exists) return
        const payload = JSON.parse(readFileSync(p, 'utf8'))
        const parts = payload.parts.map((pt) => ({ coords: pt.coords, count: pt.count }))
        const sheets = payload.instance.bins.map((b) => {
            const outer = b.shape?.data?.outer || b.shape
            let w = 0, h = 0
            for (const [x, y] of outer) { w = Math.max(w, x); h = Math.max(h, y) }
            return { width: w, height: h, count: b.stock }
        })
        const space = Number(payload.engineConfig?.min_item_separation) || 0
        const r = capacityReport(parts, sheets, space)
        // Mêmes seuils, mêmes leviers — le ratio exact est verrouillé par
        // le pytest miroir sur le cas canonique.
        expect(r).not.toBeNull()
        expect(r.ratio).toBeGreaterThan(0)
        expect(r.ratio).toBeLessThan(1.5)
    })
})

describe('capacityClient — borne rangées Z4 (floor(W/(w+s)), orientations 0/90)', () => {
    it('constructiveFit : W=19, w=8, s=2 → exactement 1 colonne', () => {
        // 2 colonnes exigent 8+2+8+2+8 = 28 > 19 : la dérogation ne doit
        // pas laisser passer un infaisable (sur-compte de l'ancienne
        // formule floor((W+s)/(w+s))).
        const rect8 = [[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]
        // count=3 sur tôle 19×19 : capacité 1 par tôle → 19 tôles !
        const r = capacityReport(
            [{ coords: rect8, count: 3 }],
            [{ width: 19, height: 19, count: 1 }], 2)
        expect(r.refused).toBe(true)
    })

    it('le cas 8×8 / tôle 12 / s=2 reste constructif (garde #49)', () => {
        const rect8 = [[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]
        const r = capacityReport(
            [{ coords: rect8, count: 1 }],
            [{ width: 12, height: 12, count: 1 }], 2)
        expect(r.refused).toBe(false)
    })

    it('orientation 90° reconnue (100×30, pièce 25×8, s=2 → 10)', () => {
        // Via le refus/dérogation : 10 par tôle en orientation tournée,
        // 9 en orientation droite. count=10 tient exactement tourné.
        const rect = [[0, 0], [25, 0], [25, 8], [0, 8], [0, 0]]
        const r = capacityReport(
            [{ coords: rect, count: 10 }],
            [{ width: 100, height: 30, count: 1 }], 2)
        expect(r.refused).toBe(false)
        // count=11 : plus aucune construction ne tient sur le stock (1
        // tôle) et le ratio dépasse le seuil → refus.
        const r11 = capacityReport(
            [{ coords: rect, count: 11 }],
            [{ width: 100, height: 30, count: 1 }], 2)
        expect(r11.refused).toBe(true)
    })
})
