import { describe, expect, it } from 'vitest'
import { reportExportState } from '~~/app/utils/reportExport'

// D-RAP-11: report content visible on every plan; exports (copy/CSV) are
// Unlimited+. The gate is commercial and 100% client-side — the resolver is
// the only logic worth locking (the template wiring stays thin).
describe('reportExportState (D-RAP-11)', () => {
    it('enabled for paid tiers (D-RAP-4 regression: exports work)', () => {
        expect(reportExportState('standard', false)).toBe('enabled')
        expect(reportExportState('privacy', false)).toBe('enabled')
        expect(reportExportState('standard', true)).toBe('enabled')
        expect(reportExportState('privacy', true)).toBe('enabled')
    })

    it('locked in free (visible buttons + explicit label, click opens paywall)', () => {
        expect(reportExportState('free', false)).toBe('locked')
    })

    it('disabled (silently, NO paywall) when NUXT_PUBLIC_PAID_PLANS_DISABLED (D-PAY-7)', () => {
        expect(reportExportState('free', true)).toBe('disabled')
    })

    it('never grants export on an unknown/absent level (jamais de premium silencieux)', () => {
        expect(reportExportState(null, false)).toBe('locked')
        expect(reportExportState(undefined, false)).toBe('locked')
        expect(reportExportState('pro-max-ultra', false)).toBe('locked')
    })
})
