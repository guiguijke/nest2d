import { describe, expect, it } from 'vitest'
import { hasPaidAccess } from '../utils/entitlementUi'

describe('hasPaidAccess', () => {
    it('Stripe active / trialing = payant', () => {
        expect(hasPaidAccess({ subscriptionStatus: 'active' })).toBe(true)
        expect(hasPaidAccess({ subscriptionStatus: 'trialing' })).toBe(true)
    })

    it('grant admin (flag ou compute.level) = payant même à 0 nestings free', () => {
        expect(hasPaidAccess({ granted: true, freeRemaining: 0 })).toBe(true)
        expect(hasPaidAccess({ compute: { level: 'standard' }, freeRemaining: 0 })).toBe(true)
        expect(hasPaidAccess({ compute: { level: 'privacy' }, freeRemaining: 0 })).toBe(true)
    })

    it('free épuisé sans grant = pas payant', () => {
        expect(hasPaidAccess({ subscriptionStatus: null, freeRemaining: 0 })).toBe(false)
        expect(hasPaidAccess({ compute: { level: 'free' }, freeRemaining: 0 })).toBe(false)
        expect(hasPaidAccess(null)).toBe(false)
    })
})
