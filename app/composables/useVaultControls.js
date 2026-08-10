import { ref } from 'vue'
import {
    buildKeyFile,
    downloadKeyFile,
    forgetRememberedKey,
    generateVaultKey,
    keyToBase64,
} from '../utils/vault'
import { trackEvent } from '../utils/track'

/**
 * État visuel du bouton vault du header (fonction pure, testée unitairement) :
 *  - 'off'    : vault désactivé (ou statut pas encore chargé) → neutre
 *  - 'active' : vault activé et déverrouillé → accent
 *  - 'locked' : vault activé mais verrouillé → ambre, action requise
 */
export function vaultButtonState(status) {
    if (!status?.enabled) return 'off'
    return status.locked ? 'locked' : 'active'
}

/**
 * Logique du coffre zero-knowledge partagée entre VaultSettings (page profil)
 * et VaultMenuButton (panneau du header).
 *
 * disable() et destroyVault() restent VOLONTAIREMENT hors de ce composable :
 * la désactivation / suppression du coffre ne quitte pas la page profil.
 *
 * Chaque appel crée un état neuf (pas de singleton module) : le statut est
 * propre à l'utilisateur connecté et ne doit jamais fuiter entre requêtes SSR.
 * `errorKey` / `noticeKey` exposent la clé i18n du message affiché (les tests
 * n'ont pas besoin du texte traduit).
 *
 * Globales Nuxt auto-importées utilisées : useLocale, useVaultUnlockDialog,
 * authStore, $fetch (mockées sur globalThis dans les tests).
 */
export function useVaultControls() {
    const { t } = useLocale()
    const unlockDialog = useVaultUnlockDialog()

    const status = ref(null)
    const loading = ref(false)
    const error = ref('')
    const errorKey = ref('')
    const notice = ref('')
    const noticeKey = ref('')

    // Flux d'activation : clé générée côté navigateur, en attente de la
    // confirmation « fichier-clé sauvegardé » avant l'appel /enable.
    const pendingKey = ref(null)
    const pendingKeyFile = ref(null)
    const confirmed = ref(false)

    function setError(err, key) {
        errorKey.value = key
        error.value = err?.data?.statusMessage || t(key)
    }

    function setNotice(key) {
        noticeKey.value = key
        notice.value = t(key)
    }

    function clearError() {
        error.value = ''
        errorKey.value = ''
    }

    async function refresh() {
        try {
            status.value = await $fetch('/api/security/vault/status')
        } catch {
            status.value = null
        }
    }

    async function sha256Hex(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    async function generate() {
        clearError()
        const keyBytes = generateVaultKey()
        const keyId = (await sha256Hex(keyBytes)).slice(0, 8)
        pendingKey.value = keyBytes
        pendingKeyFile.value = buildKeyFile(keyBytes, keyId)
        confirmed.value = false
        downloadKeyFile(pendingKeyFile.value)
        trackEvent('vault_key_generated')
    }

    function redownload() {
        if (pendingKeyFile.value) downloadKeyFile(pendingKeyFile.value)
    }

    async function enable() {
        if (!pendingKey.value || !confirmed.value) return
        loading.value = true
        clearError()
        try {
            await $fetch('/api/security/vault/enable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: keyToBase64(pendingKey.value) }),
            })
            pendingKey.value = null
            pendingKeyFile.value = null
            setNotice('vault.activated')
            trackEvent('vault_enabled')
            await refresh()
            await authStore.actions.setUser()
        } catch (err) {
            setError(err, 'vault.error.activate')
        } finally {
            loading.value = false
        }
    }

    function openUnlock() {
        unlockDialog.value = true
    }

    async function rotate() {
        clearError()
        const keyBytes = generateVaultKey()
        const keyId = (await sha256Hex(keyBytes)).slice(0, 8)
        const keyFile = buildKeyFile(keyBytes, keyId)
        downloadKeyFile(keyFile)
        loading.value = true
        try {
            await $fetch('/api/security/vault/rotate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: keyToBase64(keyBytes) }),
            })
            setNotice('vault.rotated')
            trackEvent('vault_rotated')
            await refresh()
        } catch (err) {
            setError(err, 'vault.error.rotate')
        } finally {
            loading.value = false
        }
    }

    async function forgetBrowser() {
        await forgetRememberedKey()
        setNotice('vault.forgetNotice')
        trackEvent('vault_forget_browser')
    }

    return {
        status,
        loading,
        error,
        errorKey,
        notice,
        noticeKey,
        pendingKey,
        pendingKeyFile,
        confirmed,
        unlockDialog,
        refresh,
        generate,
        redownload,
        enable,
        openUnlock,
        rotate,
        forgetBrowser,
    }
}
