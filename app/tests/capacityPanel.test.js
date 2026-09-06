import { describe, expect, it } from 'vitest'
import { capacityPanelModel } from '../utils/capacityPanel'

// Z1 (vérif 2026-09-05) : le refus capacité doit AFFICHER les trois leviers
// chiffrés et les actions « Ajouter une tôle » / « Réduire l'espacement » —
// la capture ne montrait qu'une ligne générique.
describe('capacityPanelModel', () => {
    const unfit = {
        reason: 'capacity',
        ratio: 0.92,
        sheetsNeeded: 2,
        maxPartsAtSpacing: 924,
        maxSpacingForFitMm: 2.1,
    }

    it('expose les trois leviers du cas propriétaire', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 4 })
        expect(m.levers.sheetsNeeded).toBe(2)
        expect(m.levers.maxParts).toBe(924)
        expect(m.levers.maxSpacingMm).toBe(2.1)
    })

    it('« Ajouter une tôle » incrémente le compte du premier format actif', () => {
        const sheets = [
            { width: '1000', height: '2000', count: '1' },
            { width: '1500', height: '3000', count: '0' },
        ]
        const m = capacityPanelModel(unfit, { sheets, spaceMm: 4 })
        expect(m.nextSheets[0].count).toBe('2')
        expect(m.nextSheets[1].count).toBe('0')
    })

    it("« Réduire l'espacement » ne s'affiche que si elle abaisse le réglage courant", () => {
        expect(capacityPanelModel(unfit, { sheets: [], spaceMm: 4 }).reduceSpacingToMm).toBe(2.1)
        expect(capacityPanelModel(unfit, { sheets: [], spaceMm: 2 }).reduceSpacingToMm).toBeNull()
        expect(capacityPanelModel(unfit, { sheets: [], spaceMm: null }).reduceSpacingToMm).toBeNull()
    })

    it('solution partielle : unplaced sans leviers reste affichable', () => {
        const m = capacityPanelModel({ reason: 'partial', unplaced: 18 }, { sheets: [], spaceMm: 4 })
        expect(m.unplaced).toBe(18)
        expect(m.levers.sheetsNeeded).toBeNull()
    })

    it('payload vide → pas de bandeau', () => {
        expect(capacityPanelModel(null, {})).toBeNull()
        expect(capacityPanelModel({}, {})).toBeNull()
        expect(capacityPanelModel({ reason: 'capacity' }, {})).toBeNull()
    })

    // C04 (lot 3) : levier « réduire l'espacement » MASQUÉ sous 0,5 mm —
    // plus de bouton illusoire, la phrase « même sans espacement » prend
    // le relais (noSpacingGain).
    it('masque le levier et pose noSpacingGain quand space ≤ 0,5 mm', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 0.3 })
        expect(m.reduceSpacingToMm).toBeNull()
        expect(m.noSpacingGain).toBe(true)
        // Le levier chiffré reste affiché (information utile).
        expect(m.levers.maxSpacingMm).toBe(2.1)
    })

    it('kerf explicite : cible ≤ kerf → levier masqué (on ne coupe pas dans l’outil)', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 4, kerfMm: 2.5 })
        expect(m.reduceSpacingToMm).toBeNull()
        expect(m.noSpacingGain).toBe(true)
        // Cible au-dessus du kerf → levier visible.
        const ok = capacityPanelModel(unfit, { sheets: [], spaceMm: 4, kerfMm: 1 })
        expect(ok.reduceSpacingToMm).toBe(2.1)
        expect(ok.noSpacingGain).toBeFalsy()
    })

    it('espacement confortable : pas de phrase plancher', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 4 })
        expect(m.noSpacingGain).toBeFalsy()
    })
})
