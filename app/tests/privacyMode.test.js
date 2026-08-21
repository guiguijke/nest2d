import { describe, expect, it } from 'vitest'
import { translate } from '../utils/i18n'
import {
    PRIVACY_CHIP_KEY,
    PRIVACY_STATUS_KEY,
    projectPrivacyMode,
} from '../utils/privacyMode'

describe('projectPrivacyMode', () => {
    it('demo gagne sur local et vault', () => {
        expect(projectPrivacyMode({ isDemo: true, local: true }, true)).toBe('demo')
        expect(projectPrivacyMode(null, true)).toBe('demo')
    })

    it('projet local = device même si le coffre du compte est actif', () => {
        expect(projectPrivacyMode({ local: true }, true)).toBe('device')
        expect(projectPrivacyMode({ local: true }, false)).toBe('device')
    })

    it('cloud = vault si le coffre est actif, sinon 24 h', () => {
        expect(projectPrivacyMode({ slug: 'p' }, false)).toBe('cloud')
        expect(projectPrivacyMode({ slug: 'p' }, true)).toBe('vault')
        expect(projectPrivacyMode({ local: false }, true)).toBe('vault')
    })
})

describe('i18n keys', () => {
    it('chaque mode visible a une pastille EN et FR', () => {
        expect(PRIVACY_CHIP_KEY.device).toBe('privacy.chip.device')
        expect(PRIVACY_CHIP_KEY.cloud).toBe('privacy.chip.cloud')
        expect(PRIVACY_CHIP_KEY.vault).toBe('privacy.chip.vault')
        expect(PRIVACY_STATUS_KEY.cloud).toBe('privacy.status.cloud')
        const keys = [
            ...Object.values(PRIVACY_CHIP_KEY),
            ...Object.values(PRIVACY_STATUS_KEY),
            'privacy.choice',
            'privacy.device.title',
            'privacy.cloud.title',
            'privacy.cloud.vaultOff',
            'privacy.cloud.vaultOn',
        ]
        for (const key of keys) {
            expect(translate(key, 'en')).not.toBe(key)
            expect(translate(key, 'fr')).not.toBe(key)
        }
    })
})
