import { describe, expect, it } from 'vitest'
import { nextQuotaReset, formatQuotaReset } from '../utils/quotaReset'

// Le reset du quota mensuel est défini côté serveur par période UTC
// (server/utils/entitlement.js) : 1er du mois suivant à 00:00:00 UTC.

describe('nextQuotaReset', () => {
    it('milieu de mois → 1er du mois suivant 00:00 UTC', () => {
        const now = new Date('2026-08-15T12:34:56Z')
        expect(nextQuotaReset(now).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    })

    it('31 janvier → 1er février', () => {
        const now = new Date('2026-01-31T23:59:59Z')
        expect(nextQuotaReset(now).toISOString()).toBe('2026-02-01T00:00:00.000Z')
    })

    it("31 décembre 23:59 → 1er janvier de l'année suivante", () => {
        const now = new Date('2026-12-31T23:59:00Z')
        expect(nextQuotaReset(now).toISOString()).toBe('2027-01-01T00:00:00.000Z')
    })

    it('déjà le 1er à 00:00 UTC pile → mois suivant', () => {
        const now = new Date('2026-08-01T00:00:00.000Z')
        expect(nextQuotaReset(now).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    })

    it('sans argument : dans le futur', () => {
        expect(nextQuotaReset().getTime()).toBeGreaterThan(Date.now())
    })
})

describe('formatQuotaReset', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    const reset = nextQuotaReset(now)

    // Fragments de référence recalculés depuis la date de RESET (et non
    // « now ») : le jour affiché dépend du fuseau de la machine (00:00 UTC
    // peut être la veille au soir), mais il doit toujours décrire le reset.
    it('FR : contient mois, jour et heure', () => {
        const out = formatQuotaReset(now, 'fr')
        const month = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(reset)
        const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric' }).format(reset)
        expect(out).toContain(month)
        expect(out).toContain(day)
        expect(out).toMatch(/\d{1,2}:\d{2}/)
    })

    it('EN : contient mois, jour et heure', () => {
        const out = formatQuotaReset(now, 'en')
        const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(reset)
        const day = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(reset)
        expect(out).toContain(month)
        expect(out).toContain(day)
        expect(out).toMatch(/\d{1,2}:\d{2}/)
    })

    it('locale inconnue → repli anglais', () => {
        const out = formatQuotaReset(now, 'de')
        const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(reset)
        expect(out).toContain(month)
    })
})
