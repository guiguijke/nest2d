import { describe, expect, it } from 'vitest'
import { capacityReport, REFUSE_RATIO } from '../../app/composables/capacityClient'

// Plan 2026-09-05 §1.3 — le refus 422 du nest.post.js est testé au niveau
// de la fonction qu'il appelle (capacityReport) : la charge de quota a
// lieu APRANT la vérification (R-1), donc un refus = aucun quota touché.
// L'endpoint lui-même est couvert par le e2e navigateur (qa-e2e).

const FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
const HOST = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]

describe('nest.post 422 — pré-contrôle capacité (plan 2026-09-05 §1.2a)', () => {
    it('le cas propriétaire (900+100, 1×1000×2000, 4 mm) est refusé', () => {
        const parts = [{ coords: HOST, count: 100 }, { coords: FAN, count: 900 }]
        const cap = capacityReport(parts, [{ width: 1000, height: 2000, count: 1 }], 4)
        expect(cap.refused).toBe(true)
        expect(cap.ratio).toBeGreaterThan(REFUSE_RATIO)
        // le refus porte les trois leviers pour le 422
        expect(cap.sheetsNeeded).toBe(2)
        expect(cap.maxSpacingForFitMm).toBeLessThan(4)
        const total = Object.values(cap.maxPartsAtSpacing).reduce((n, v) => n + v, 0)
        expect(total).toBeGreaterThan(0)
        expect(total).toBeLessThan(1000)
    })

    it('le même job à 0,1 mm passe (aucun 422)', () => {
        const parts = [{ coords: HOST, count: 100 }, { coords: FAN, count: 900 }]
        const cap = capacityReport(parts, [{ width: 1000, height: 2000, count: 1 }], 0.1)
        expect(cap.refused).toBe(false)
    })

    it('2 tôles à 4 mm : pas de refus', () => {
        const parts = [{ coords: HOST, count: 100 }, { coords: FAN, count: 900 }]
        const cap = capacityReport(parts, [{ width: 1000, height: 2000, count: 2 }], 4)
        expect(cap.refused).toBe(false)
    })
})
