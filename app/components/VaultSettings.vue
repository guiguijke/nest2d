<template>
    <div class="vault">
        <MainTitle :label="t('vault.title')" class="vault__title" />

        <p class="vault__desc">
            {{ t('vault.desc') }}
        </p>

        <!-- Loading -->
        <p v-if="status === null" class="vault__muted">{{ t('common.loading') }}</p>

        <!-- Activation flow (opt-in on every plan — D-PRV-5, J-049) -->
        <div v-else-if="!status.enabled" class="vault__card">
            <template v-if="!pendingKey">
                <MainButton
                    :theme="themeType.primary"
                    :label="t('vault.generate')"
                    :isDisable="loading"
                    trackingTag="vault_generate_key"
                    @click="generate"
                    class="vault__btn"
                />
            </template>
            <template v-else>
                <p class="vault__warning">
                    {{ t('vault.keyDownloadedWarning', { name: pendingKeyFile.name }) }}
                </p>
                <label class="vault__confirm">
                    <input type="checkbox" v-model="confirmed" />
                    <span>{{ t('vault.confirmSave') }}</span>
                </label>
                <div class="vault__actions">
                    <MainButton
                        :theme="themeType.primary"
                        :label="t('vault.activate')"
                        :isDisable="!confirmed || loading"
                        trackingTag="vault_enable"
                        @click="enable"
                        class="vault__btn"
                    />
                    <MainButton
                        :theme="themeType.secondary"
                        :label="t('vault.downloadAgain')"
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
                {{ status.locked ? t('vault.locked') : t('vault.unlocked') }}
            </p>
            <p class="vault__muted">{{ t('vault.keyId') }}: <code>{{ status.keyId }}</code></p>

            <div class="vault__actions">
                <MainButton
                    v-if="status.locked"
                    :theme="themeType.primary"
                    :label="t('vault.unlockNow')"
                    trackingTag="vault_unlock_now"
                    @click="openUnlock"
                    class="vault__btn"
                />
                <MainButton
                    :theme="themeType.secondary"
                    :label="t('vault.rotate')"
                    :isDisable="status.locked || loading"
                    trackingTag="vault_rotate"
                    @click="rotate"
                    class="vault__btn"
                />
                <MainButton
                    :theme="themeType.secondary"
                    :label="t('vault.forgetBrowser')"
                    trackingTag="vault_forget_browser"
                    @click="forgetBrowser"
                    class="vault__btn"
                />
            </div>

            <details class="vault__danger">
                <summary>{{ t('vault.dangerZone') }}</summary>

                <div class="vault__danger-block">
                    <p class="vault__muted">
                        {{ t('vault.disableDesc') }}
                    </p>
                    <div class="vault__actions">
                        <MainButton
                            :theme="themeType.secondary"
                            :label="t('vault.decryptDisable')"
                            :isDisable="status.locked || loading"
                            trackingTag="vault_disable_decrypt"
                            @click="disable('decrypt')"
                            class="vault__btn"
                        />
                        <MainButton
                            :theme="themeType.secondary"
                            :label="t('vault.destroyDisable')"
                            :isDisable="status.locked || loading"
                            trackingTag="vault_disable_destroy"
                            @click="disable('destroy')"
                            class="vault__btn"
                        />
                    </div>
                </div>

                <div class="vault__danger-block vault__danger-block--critical">
                    <p class="vault__danger-title">
                        {{ t('vault.destroyFull') }}
                    </p>
                    <p class="vault__muted">
                        {{ t('vault.destroyFullDesc') }}
                    </p>
                    <p class="vault__confirm-challenge">
                        {{ t('vault.confirmChallenge', { keyId: status.keyId }) }}
                    </p>
                    <input
                        v-model="destroyConfirm"
                        :placeholder="status.keyId"
                        class="vault__confirm-input"
                        autocomplete="off"
                        spellcheck="false"
                    />
                    <MainButton
                        :theme="themeType.primary"
                        :label="t('vault.destroyBtn')"
                        :isDisable="destroyConfirm !== status.keyId || loading"
                        trackingTag="vault_destroy_full"
                        @click="destroyVault"
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
import { trackEvent } from '~/utils/track'

const { t } = useLocale()

// Logique vault partagée avec le panneau du header (VaultMenuButton) — voir
// app/composables/useVaultControls.js. Seules la désactivation et la
// destruction complète restent propres à cette page (demande explicite).
const {
    status,
    loading,
    error,
    notice,
    pendingKey,
    pendingKeyFile,
    confirmed,
    refresh,
    generate,
    redownload,
    enable,
    openUnlock,
    rotate,
    forgetBrowser,
} = useVaultControls()

// Full-destroy confirmation: user must retype their keyId to enable the button.
const destroyConfirm = ref('')

async function disable(mode) {
    const message = mode === 'destroy'
        ? t('vault.confirmDisableDestroy')
        : t('vault.confirmDisableDecrypt')
    if (!window.confirm(message)) return
    loading.value = true
    error.value = ''
    try {
        await $fetch('/api/security/vault/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
        })
        notice.value = mode === 'destroy' ? t('vault.disabledDestroy') : t('vault.disabledDecrypt')
        trackEvent('vault_disabled', { mode })
        await refresh()
        await authStore.actions.setUser()
    } catch (err) {
        error.value = err?.data?.statusMessage || t('vault.error.disable')
    } finally {
        loading.value = false
    }
}

async function destroyVault() {
    if (destroyConfirm.value !== status.value?.keyId) return
    if (!window.confirm(t('vault.destroyConfirm'))) return
    loading.value = true
    error.value = ''
    try {
        await $fetch('/api/security/vault/destroy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'DESTROY' }),
        })
        destroyConfirm.value = ''
        notice.value = t('vault.destroyed')
        trackEvent('vault_destroyed')
        await refresh()
        await authStore.actions.setUser()
    } catch (err) {
        error.value = err?.data?.statusMessage || t('vault.error.destroy')
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
            color: var(--error-text, #ef4444);
        }

        &[open] summary {
            margin-bottom: 16px;
        }
    }
    &__danger-block {
        padding: 16px;
        border: 1px solid var(--separator-secondary);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;

        & + & {
            margin-top: 12px;
        }

        &--critical {
            border-color: var(--error-border, #ef4444);
            background-color: var(--error-background);
        }
    }
    &__danger-title {
        font-weight: 700;
        color: var(--error-text, #ef4444);
        font-size: 15px;
    }
    &__confirm-challenge {
        font-size: 14px;
        color: var(--label-secondary);

        code {
            background-color: var(--fill-tertiary);
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 700;
            color: var(--label-primary);
            user-select: all;
        }
    }
    &__confirm-input {
        width: 100%;
        padding: 10px 12px;
        border-radius: 8px;
        background-color: var(--background-primary);
        border: 1px solid var(--separator-primary);
        color: var(--label-primary);
        font-size: 15px;
        font-weight: 600;
        font-family: $sf_mono;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;

        &:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 15%, transparent);
        }
    }
    &__error {
        margin-top: 12px;
        color: var(--error-text, #ef4444);
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
