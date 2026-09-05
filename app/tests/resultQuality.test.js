import { describe, expect, it } from 'vitest'
import { altDensityPctOf, whyFirstKind } from '../utils/resultQuality'

describe('altDensityPctOf — une seule définition, mesurée (AA1)', () => {
    it('lit totals.densityPct du rapport (déjà en %)', () => {
        expect(altDensityPctOf({ report: { totals: { densityPct: 55.4 } } })).toBe(55.4)
    })

    it('rapport SANS totals → null (pas de chiffre faux, pas de repli)', () => {
        expect(altDensityPctOf({ report: { sheets: [] } })).toBeNull()
    })

    it('repli sur alt.density SEULEMENT sans rapport (jobs antérieurs)', () => {
        expect(altDensityPctOf({ density: 0.554 })).toBeCloseTo(55.4, 5)
        expect(altDensityPctOf({ density: 0.623, usedSheetShare: 0.69 })).toBeCloseTo(62.3, 5)
    })

    it('grille et moteur, mêmes pièces/tôles → même densité', () => {
        // Cas du banc Fable : grille 55,4 % « matière/Σ tôles » vs moteur
        // 62,3 % « matière/emprise » — avec totals MESURÉS, identiques.
        const grid = { report: { totals: { densityPct: 61.1 } } }
        const engine = { report: { totals: { densityPct: 61.1 } } }
        expect(altDensityPctOf(grid)).toBe(altDensityPctOf(engine))
    })

    it('null/absent → null', () => {
        expect(altDensityPctOf(null)).toBeNull()
        expect(altDensityPctOf({})).toBeNull()
    })
})

describe('whyFirstKind — la justification du rang 0 est vraie (AA1)', () => {
    const alt = (area) => ({ offcut: { area } })

    it('chute du rang 0 maximale → offcut', () => {
        expect(whyFirstKind([alt(600), alt(580), alt(590)])).toBe('offcut')
    })

    it('égalité à 1 mm² près → offcut (tolérance)', () => {
        expect(whyFirstKind([alt(599.5), alt(600)])).toBe('offcut')
    })

    it('chute du rang 0 PLUS PETITE (banc Fable : 580,4 vs 599,6) → grid', () => {
        expect(whyFirstKind([alt(580406), alt(599600)])).toBe('grid')
    })

    it('forme hydratée areaMm2 reconnue aussi', () => {
        expect(whyFirstKind([
            { offcut: { areaMm2: 100 } },
            { offcut: { areaMm2: 200 } },
        ])).toBe('grid')
    })

    it('une seule option → null (pas de justification)', () => {
        expect(whyFirstKind([alt(500)])).toBeNull()
        expect(whyFirstKind(null)).toBeNull()
    })
})
