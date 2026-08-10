import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// Bouton vault du header + logique partagée (useVaultControls) :
//  - refresh / generate → enable / rotate / forgetBrowser contre $fetch mocké
//  - erreurs → errorKey i18n (t est l'identité dans ces tests)
//  - vaultButtonState : couleur du bouton selon le statut
//
// Pas de harness DOM (vitest environment 'node') : les globales Nuxt
// auto-importées (useLocale, useVaultUnlockDialog, authStore, $fetch) sont
// mockées sur globalThis — même pattern que projectDelete.test.js.
// utils/vault et utils/track sont mockés (Blob/URL/document/IndexedDB
// n'existent pas en environnement node).

vi.mock('../utils/vault', () => ({
    generateVaultKey: vi.fn(() => new Uint8Array(32).fill(7)),
    buildKeyFile: vi.fn((bytes, keyId) => ({
        name: `nestorcut-vault-${keyId}.key.json`,
        content: '{}',
    })),
    downloadKeyFile: vi.fn(),
    keyToBase64: vi.fn(() => 'bW9jay1rZXk='),
    forgetRememberedKey: vi.fn(async () => {}),
}))

vi.mock('../utils/track', () => ({
    trackEvent: vi.fn(),
}))

import { useVaultControls, vaultButtonState } from '../composables/useVaultControls'
import { downloadKeyFile, forgetRememberedKey } from '../utils/vault'

const enabledStatus = { enabled: true, locked: false, keyId: 'abcd1234', expiresAt: null }
const lockedStatus = { enabled: true, locked: true, keyId: 'abcd1234', expiresAt: null }

let unlockDialog

beforeEach(() => {
    vi.clearAllMocks()
    unlockDialog = ref(false)
    globalThis.useLocale = () => ({ t: (key) => key })
    globalThis.useVaultUnlockDialog = () => unlockDialog
    globalThis.authStore = { actions: { setUser: vi.fn(async () => {}) } }
    globalThis.$fetch = vi.fn(async () => ({ enabled: false, locked: false }))
})

describe('vaultButtonState', () => {
    it('off sans statut ou vault désactivé', () => {
        expect(vaultButtonState(null)).toBe('off')
        expect(vaultButtonState(undefined)).toBe('off')
        expect(vaultButtonState({ enabled: false, locked: false })).toBe('off')
    })

    it('active quand le vault est activé et déverrouillé', () => {
        expect(vaultButtonState(enabledStatus)).toBe('active')
    })

    it('locked quand le vault est activé mais verrouillé', () => {
        expect(vaultButtonState(lockedStatus)).toBe('locked')
    })
})

describe('refresh', () => {
    it('remonte le statut activé/déverrouillé', async () => {
        globalThis.$fetch = vi.fn(async () => enabledStatus)
        const controls = useVaultControls()
        await controls.refresh()
        expect(globalThis.$fetch).toHaveBeenCalledWith('/api/security/vault/status')
        expect(controls.status.value).toEqual(enabledStatus)
    })

    it('remonte le statut verrouillé', async () => {
        globalThis.$fetch = vi.fn(async () => lockedStatus)
        const controls = useVaultControls()
        await controls.refresh()
        expect(controls.status.value).toEqual(lockedStatus)
        expect(vaultButtonState(controls.status.value)).toBe('locked')
    })

    it('échec réseau → status null', async () => {
        globalThis.$fetch = vi.fn(async () => {
            throw new Error('500')
        })
        const controls = useVaultControls()
        controls.status.value = enabledStatus
        await controls.refresh()
        expect(controls.status.value).toBeNull()
    })
})

describe('generate → enable', () => {
    it('génère et télécharge le fichier-clé, puis active le coffre', async () => {
        globalThis.$fetch = vi.fn(async (url) => {
            if (url === '/api/security/vault/status') return enabledStatus
            return {}
        })
        const controls = useVaultControls()

        await controls.generate()
        expect(controls.pendingKey.value).toBeInstanceOf(Uint8Array)
        expect(controls.pendingKeyFile.value.name).toMatch(/^nestorcut-vault-[0-9a-f]{8}\.key\.json$/)
        expect(downloadKeyFile).toHaveBeenCalledTimes(1)
        expect(controls.confirmed.value).toBe(false)

        controls.confirmed.value = true
        await controls.enable()

        expect(globalThis.$fetch).toHaveBeenCalledWith('/api/security/vault/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'bW9jay1rZXk=' }),
        })
        expect(controls.pendingKey.value).toBeNull()
        expect(controls.pendingKeyFile.value).toBeNull()
        expect(controls.noticeKey.value).toBe('vault.activated')
        expect(controls.notice.value).toBe('vault.activated')
        expect(globalThis.authStore.actions.setUser).toHaveBeenCalledTimes(1)
        expect(controls.status.value).toEqual(enabledStatus)
        expect(controls.loading.value).toBe(false)
    })

    it('sans confirmation, enable ne contacte pas le serveur', async () => {
        const controls = useVaultControls()
        await controls.generate()
        await controls.enable()
        expect(globalThis.$fetch).not.toHaveBeenCalled()
    })

    it('sans clé générée, enable ne fait rien', async () => {
        const controls = useVaultControls()
        controls.confirmed.value = true
        await controls.enable()
        expect(globalThis.$fetch).not.toHaveBeenCalled()
    })

    it('redownload retélécharge le fichier-clé en attente', async () => {
        const controls = useVaultControls()
        await controls.generate()
        controls.redownload()
        expect(downloadKeyFile).toHaveBeenCalledTimes(2)
    })

    it('échec avec statusMessage serveur → message brut + errorKey', async () => {
        globalThis.$fetch = vi.fn(async () => {
            // eslint-disable-next-line no-throw-literal
            throw { data: { statusMessage: 'vault_already_enabled' } }
        })
        const controls = useVaultControls()
        await controls.generate()
        controls.confirmed.value = true
        await controls.enable()
        expect(controls.errorKey.value).toBe('vault.error.activate')
        expect(controls.error.value).toBe('vault_already_enabled')
        expect(controls.loading.value).toBe(false)
    })

    it('échec sans message → texte = clé i18n', async () => {
        globalThis.$fetch = vi.fn(async () => {
            throw new Error('network down')
        })
        const controls = useVaultControls()
        await controls.generate()
        controls.confirmed.value = true
        await controls.enable()
        expect(controls.errorKey.value).toBe('vault.error.activate')
        expect(controls.error.value).toBe('vault.error.activate')
    })
})

describe('rotate', () => {
    it('télécharge une nouvelle clé et appelle /rotate', async () => {
        globalThis.$fetch = vi.fn(async (url) => {
            if (url === '/api/security/vault/status') return { ...enabledStatus, keyId: 'newid999' }
            return {}
        })
        const controls = useVaultControls()
        controls.status.value = lockedStatus // la rotation reste possible côté garde UI seulement
        await controls.rotate()
        expect(downloadKeyFile).toHaveBeenCalledTimes(1)
        expect(globalThis.$fetch).toHaveBeenCalledWith('/api/security/vault/rotate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'bW9jay1rZXk=' }),
        })
        expect(controls.noticeKey.value).toBe('vault.rotated')
        expect(controls.status.value.keyId).toBe('newid999')
        expect(controls.loading.value).toBe(false)
    })

    it('échec → errorKey vault.error.rotate', async () => {
        globalThis.$fetch = vi.fn(async () => {
            throw new Error('boom')
        })
        const controls = useVaultControls()
        await controls.rotate()
        expect(controls.errorKey.value).toBe('vault.error.rotate')
        expect(controls.error.value).toBe('vault.error.rotate')
        expect(controls.loading.value).toBe(false)
    })
})

describe('forgetBrowser', () => {
    it('purge la clé mémorisée et affiche la notice', async () => {
        const controls = useVaultControls()
        await controls.forgetBrowser()
        expect(forgetRememberedKey).toHaveBeenCalledTimes(1)
        expect(controls.noticeKey.value).toBe('vault.forgetNotice')
        expect(controls.notice.value).toBe('vault.forgetNotice')
    })
})

describe('openUnlock', () => {
    it('ouvre le dialogue global de déverrouillage', () => {
        const controls = useVaultControls()
        expect(unlockDialog.value).toBe(false)
        controls.openUnlock()
        expect(unlockDialog.value).toBe(true)
    })
})
