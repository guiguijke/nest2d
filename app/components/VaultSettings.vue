<template>
    <div class="vault">
        <MainTitle label="Zero-knowledge vault" class="vault__title" />

        <p class="vault__desc">
            Your files are encrypted with a key file only you hold. We never
            store it: <strong>if you lose the key file, your data is lost
            forever</strong> — even we cannot recover it.
        </p>

        <!-- Loading -->
        <p v-if="status === null" class="vault__muted">Loading…</p>

        <!-- Not eligible -->
        <div v-else-if="!status.eligible && !status.enabled" class="vault__card">
            <p class="vault__muted">
                The zero-knowledge vault is available on the Pro plan.
            </p>
            <MainButton
                :theme="themeType.secondary"
                label="See plans"
                tag="a"
                href="/plans"
                trackingTag="vault_see_plans"
                class="vault__btn"
            />
        </div>

        <!-- Activation flow -->
        <div v-else-if="!status.enabled" class="vault__card">
            <template v-if="!pendingKey">
                <MainButton
                    :theme="themeType.primary"
                    label="Generate my key file"
                    :isDisable="loading"
                    trackingTag="vault_generate_key"
                    @click="generate"
                    class="vault__btn"
                />
            </template>
            <template v-else>
                <p class="vault__warning">
                    ⚠️ Your key file <code>{{ pendingKeyFile.name }}</code> has
                    been downloaded. Store it somewhere safe — it is the
                    <strong>only</strong> copy.
                </p>
                <label class="vault__confirm">
                    <input type="checkbox" v-model="confirmed" />
                    <span>
                        I saved my key file and I understand that losing it
                        makes my data unrecoverable.
                    </span>
                </label>
                <div class="vault__actions">
                    <MainButton
                        :theme="themeType.primary"
                        label="Activate the vault"
                        :isDisable="!confirmed || loading"
                        trackingTag="vault_enable"
                        @click="enable"
                        class="vault__btn"
                    />
                    <MainButton
                        :theme="themeType.secondary"
                        label="Download again"
                        trackingTag="vault_redownload"
                        @click="redownload"
                        class="vault__btn"
                    />
                </div>
            </template>
        </div>

        <!-- Enabled -->
        <div v-else class="vault__card">
            <p class="vault__status">
                <span class="vault__dot" :class="{ 'vault__dot--locked': status.locked }" />
                {{ status.locked ? 'Vault locked — files are unreadable until you unlock it.' : 'Vault unlocked — new files are encrypted.' }}
            </p>
            <p class="vault__muted">Key id: <code>{{ status.keyId }}</code></p>

            <div class="vault__actions">
                <MainButton
                    v-if="status.locked"
                    :theme="themeType.primary"
                    label="Unlock now"
                    trackingTag="vault_unlock_now"
                    @click="openUnlock"
                    class="vault__btn"
                />
                <MainButton
                    :theme="themeType.secondary"
                    label="Rotate my key"
                    :isDisable="status.locked || loading"
                    trackingTag="vault_rotate"
                    @click="rotate"
                    class="vault__btn"
                />
                <MainButton
                    :theme="themeType.secondary"
                    label="Forget this browser"
                    trackingTag="vault_forget_browser"
                    @click="forgetBrowser"
                    class="vault__btn"
                />
            </div>

            <details class="vault__danger">
                <summary>Disable the vault</summary>
                <p class="vault__muted">
                    Disabling requires an unlocked vault. Choose what happens
                    to your existing files:
                </p>
                <div class="vault__actions">
                    <MainButton
                        :theme="themeType.secondary"
                        label="Decrypt my files & disable"
                        :isDisable="status.locked || loading"
                        trackingTag="vault_disable_decrypt"
                        @click="disable('decrypt')"
                        class="vault__btn"
                    />
                    <MainButton
                        :theme="themeType.primary"
                        label="Destroy everything & disable"
                        :isDisable="status.locked || loading"
                        trackingTag="vault_disable_destroy"
                        @click="disable('destroy')"
                        class="vault__btn"
                    />
                </div>
            </details>
        </div>

        <p v-if="error" class="vault__error">{{ error }}</p>
        <p v-if="notice" class="vault__notice">{{ notice }}</p>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import {
    buildKeyFile,
    downloadKeyFile,
    forgetRememberedKey,
    generateVaultKey,
    keyToBase64,
} from '~/utils/vault'
import { trackEvent } from '~/utils/track'

const status = ref(null)
const loading = ref(false)
const error = ref('')
const notice = ref('')

// Activation flow state
const pendingKey = ref(null)
const pendingKeyFile = ref(null)
const confirmed = ref(false)

const unlockDialog = useVaultUnlockDialog()

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
    error.value = ''
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
    error.value = ''
    try {
        await $fetch('/api/security/vault/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: keyToBase64(pendingKey.value) }),
        })
        pendingKey.value = null
        pendingKeyFile.value = null
        notice.value = 'Vault activated. Your next uploads will be encrypted.'
        trackEvent('vault_enabled')
        await refresh()
        await authStore.actions.setUser()
    } catch (err) {
        error.value = err?.data?.statusMessage || 'Activation failed. Please try again.'
    } finally {
        loading.value = false
    }
}

function openUnlock() {
    unlockDialog.value = true
}

async function rotate() {
    error.value = ''
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
        notice.value = 'Key rotated. Your files were re-encrypted with the new key — the old key file is now useless.'
        trackEvent('vault_rotated')
        await refresh()
    } catch (err) {
        error.value = err?.data?.statusMessage || 'Rotation failed. Your files are still encrypted with the old key.'
    } finally {
        loading.value = false
    }
}

async function forgetBrowser() {
    await forgetRememberedKey()
    notice.value = 'This browser will no longer unlock the vault automatically.'
    trackEvent('vault_forget_browser')
}

async function disable(mode) {
    const message = mode === 'destroy'
        ? 'This permanently deletes ALL your files and disables the vault. There is no way back. Continue?'
        : 'Your files will be decrypted and the vault disabled. Continue?'
    if (!window.confirm(message)) return
    loading.value = true
    error.value = ''
    try {
        await $fetch('/api/security/vault/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
        })
        notice.value = mode === 'destroy' ? 'Vault disabled — all files were destroyed.' : 'Vault disabled — your files were decrypted.'
        trackEvent('vault_disabled', { mode })
        await refresh()
        await authStore.actions.setUser()
    } catch (err) {
        error.value = err?.data?.statusMessage || 'Disable failed. Please try again.'
    } finally {
        loading.value = false
    }
}

onMounted(refresh)
</script>

<style lang="scss" scoped>
.vault {
    margin-top: 32px;
    max-width: 520px;
    width: 100%;

    &__title {
        text-align: center;
    }
    &__desc {
        margin-top: 12px;
        font-size: 14px;
        color: var(--label-secondary);
        text-align: center;
    }
    &__card {
        margin-top: 20px;
        padding: 20px;
        border: 1px solid var(--separator-secondary);
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    &__muted {
        font-size: 14px;
        color: var(--label-tertiary);
    }
    &__warning {
        font-size: 14px;
        color: var(--label-secondary);
    }
    &__status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: var(--label-secondary);
    }
    &__dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: #22c55e;
        flex-shrink: 0;

        &--locked {
            background-color: #ef4444;
        }
    }
    &__confirm {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 14px;
        color: var(--label-secondary);
        cursor: pointer;
    }
    &__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    &__btn {
        flex: 1;
        min-width: 140px;
    }
    &__danger {
        margin-top: 8px;
        font-size: 14px;
        color: var(--label-secondary);

        summary {
            cursor: pointer;
            color: var(--error-border, #ef4444);
        }
    }
    &__error {
        margin-top: 12px;
        color: var(--error-border, #ef4444);
        font-size: 14px;
        text-align: center;
    }
    &__notice {
        margin-top: 12px;
        color: var(--label-secondary);
        font-size: 14px;
        text-align: center;
    }
}
</style>
