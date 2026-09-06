import { describe, expect, it } from 'vitest'
import {
    paramNumber,
    round4Str,
    safetyPatchForTargetMm,
    spacingFromKerfSafety,
    withKerfDefaults,
} from '../utils/spacingParams'

// ---------------------------------------------------------------------------
// Kerf explicite (B.4 / masterplan 3.10) — lot 3. L'espacement effectif
// (`space`, la clé moteur/API inchangée) vaut toujours kerf + 2 × sécurité.
// Verrous du vérificateur : migration sans changement de résultat pour les
// projets existants, règle exacte, défaut usine 2 mm.
// ---------------------------------------------------------------------------

describe('round4Str / paramNumber', () => {
    it('élimine le bruit flottant de la somme', () => {
        expect(round4Str(0.15 * 2)).toBe('0.3')
        expect(round4Str(0.1 + 0.2)).toBe('0.3')
    })
    it('accepte la virgule décimale saisie', () => {
        expect(paramNumber('1,5')).toBe(1.5)
        expect(paramNumber(undefined)).toBe(0)
        expect(paramNumber('abc')).toBe(0)
    })
})

describe('spacingFromKerfSafety (règle affichée)', () => {
    it('space = kerf + 2 × sécurité', () => {
        expect(spacingFromKerfSafety('0', '1')).toBe('2')
        expect(spacingFromKerfSafety('0.2', '0.9')).toBe('2')
        expect(spacingFromKerfSafety('0', '0.05')).toBe('0.1')
        expect(spacingFromKerfSafety('0.15', '0.15')).toBe('0.45')
    })
})

describe('withKerfDefaults (migration projets existants)', () => {
    it('dérive kerf 0 + sécurité space/2 → effectif IDENTIQUE', () => {
        for (const space of ['0.1', '2', '2.4', '0', '1.5']) {
            const migrated = withKerfDefaults({ space })
            expect(migrated.kerf).toBe('0')
            // Le dizaine-millième : la valeur reçue par le moteur ne bouge
            // pas (round-trip String -> Number -> String stable).
            expect(spacingFromKerfSafety(migrated.kerf, migrated.safety)).toBe(space)
        }
    })
    it('laisse intact un params déjà migré', () => {
        const p = { space: '2.4', kerf: '0.4', safety: '1' }
        expect(withKerfDefaults(p)).toBe(p)
    })
})

describe("safetyPatchForTargetMm (levier « réduire l'espacement »)", () => {
    it('réduit la sécurité, pas le kerf', () => {
        expect(safetyPatchForTargetMm(0.4, 2)).toEqual({ safetyMm: 0.8 })
        expect(safetyPatchForTargetMm(0, 0)).toBeNull()
    })
    it('cible inférieure ou égale au kerf → impossible (levier masqué)', () => {
        expect(safetyPatchForTargetMm(0.5, 0.5)).toBeNull()
        expect(safetyPatchForTargetMm(0.5, 0.3)).toBeNull()
    })
})

describe('défauts d\'usine (B.4)', () => {
    it('kerf 0 + sécurité 1 mm = espacement effectif 2 mm', () => {
        // Miroir de factoryParams() — le défaut ne doit plus être 0,1 mm.
        expect(spacingFromKerfSafety('0', '1')).toBe('2')
    })
})
