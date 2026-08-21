<template>
    <div class="vault-menu">
        <!--
            Couleur du déclencheur = état du coffre (vaultButtonState) :
            off = neutre, active = accent, locked = ambre (action requise).
        -->
        <button
            type="button"
            class="vault-menu__trigger"
            :class="`vault-menu__trigger--${buttonState}`"
            :title="t('vault.title')"
            :aria-label="t('vault.title')"
            @click="openPanel"
        >
            <span class="vault-menu__trigger-icon" aria-hidden="true" />
        </button>

        <DialogWrapper v-model:isModalOpen="isOpen" trackingTag="vault_menu">
            <div class="vault-menu__panel panel">
                <MainTitle :label="t('vault.title')" class="panel__title" />

                <!-- Explication grand public du mode vault, dépliée par le « ? » -->
                <details class="panel__help">
                    <summary class="panel__help-summary">
                        <span class="panel__help-icon" aria-hidden="true">?</span>
                        <span>{{ t('vaultMenu.helpTitle') }}</span>
                    </summary>
                    <div class="panel__help-body">
                        <p>{{ t('vaultMenu.helpWhere') }}</p>
                        <p>{{ t('vaultMenu.helpLostKey') }}</p>
                        <p>{{ t('vaultMenu.helpUnlock') }}</p>
                        <p>{{ t('vaultMenu.helpPurge') }}</p>
                    </div>
                </details>

                <p v-if="status === null" class="panel__muted">{{ t('common.loading') }}</p>

                <!-- Vault désactivé : génération du fichier-clé puis activation -->
                <template v-else-if="!status.enabled">
                    <p class="panel__muted">{{ t('vault.desc') }}</p>
                    <template v-if="!pendingKey">
                        <MainButton
                            :theme="themeType.primary"
                            :label="t('vault.generate')"
                            :isDisable="loading"
                            trackingTag="vault_menu_generate"
                            @click="generate"
                            class="panel__btn"
                        />
                    </template>
                    <template v-else>
                        <p class="panel__warning">
                            {{ t('vault.keyDownloadedWarning', { name: pendingKeyFile.name }) }}
                        </p>
                        <label class="panel__confirm">
                            <input type="checkbox" v-model="confirmed" />
                            <span>{{ t('vault.confirmSave') }}</span>
                        </label>
                        <div class="panel__actions">
                            <MainButton
                                :theme="themeType.primary"
                                :label="t('vault.activate')"
                                :isDisable="!confirmed || loading"
                                trackingTag="vault_menu_enable"
                                @click="enable"
                                class="panel__btn"
                            />
                            <MainButton
                                :theme="themeType.secondary"
                                :label="t('vault.downloadAgain')"
                                trackingTag="vault_menu_redownload"
                                @click="redownload"
                                class="panel__btn"
                            />
                        </div>
                    </template>
                </template>

                <!-- Vault activé : statut + actions courantes -->
                <template v-else>
                    <p class="panel__status">
                        <span class="panel__dot" :class="{ 'panel__dot--locked': status.locked }" />
                        {{ status.locked ? t('vault.locked') : t('vault.unlocked') }}
                    </p>
                    <p class="panel__muted">{{ t('vault.keyId') }}: <code>{{ status.keyId }}</code></p>
                    <div class="panel__actions">
                        <MainButton
                            v-if="status.locked"
                            :theme="themeType.primary"
                            :label="t('vault.unlockNow')"
                            trackingTag="vault_menu_unlock"
                            @click="openUnlock"
                            class="panel__btn"
                        />
                        <MainButton
                            :theme="themeType.secondary"
                            :label="t('vault.rotate')"
                            :isDisable="status.locked || loading"
                            trackingTag="vault_menu_rotate"
                            @click="rotate"
                            class="panel__btn"
                        />
                        <MainButton
                            :theme="themeType.secondary"
                            :label="t('vault.forgetBrowser')"
                            trackingTag="vault_menu_forget"
                            @click="forgetBrowser"
                            class="panel__btn"
                        />
                    </div>
                </template>

                <p v-if="error" class="panel__error">{{ error }}</p>
                <p v-if="notice" class="panel__notice">{{ notice }}</p>
            </div>
        </DialogWrapper>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { vaultButtonState } from '~/composables/useVaultControls'
import { trackEvent } from '~/utils/track'

const { t } = useLocale()

// Même logique que la page profil (composable partagé) — la désactivation et
// la destruction du coffre restent volontairement sur le profil uniquement.
const {
    status,
    loading,
    error,
    notice,
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
} = useVaultControls()

const isOpen = useVaultMenuOpen()
const buttonState = computed(() => vaultButtonState(status.value))

function openPanel() {
    trackEvent('click_vault_menu_open')
    isOpen.value = true
    refresh()
}

watch(isOpen, (open) => {
    if (open) refresh()
})

// Après un déverrouillage via le dialogue global, le statut affiché ici doit
// se rafraîchir (le dialogue appelle déjà authStore.setUser() de son côté).
watch(unlockDialog, (open) => {
    if (!open) refresh()
})

// Sync inter-composants : activation/désactivation faite depuis la page
// profil met à jour user.encryption — la couleur du bouton suit sans
// rechargement (comparaison sur les seuls drapeaux, pas sur l'objet user).
const { getters: authGetters } = authStore
const vaultFlags = computed(() => {
    const encryption = unref(authGetters.user)?.encryption
    return `${Boolean(encryption?.enabled)}:${Boolean(encryption?.locked)}`
})
watch(vaultFlags, () => refresh())

onMounted(refresh)
</script>

<style lang="scss" scoped>
.vault-menu {
    &__trigger {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        border-radius: 6px;
        background-color: var(--fill-tertiary);
        transition: background-color 0.3s;

        @media (hover: hover) {
            &:hover {
                background-color: var(--fill-secondary);
            }
        }
    }

    &__trigger-icon {
        display: block;
        width: 14px;
        height: 14px;
        mask-image: url('/icons/svg/lock.svg');
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        background-color: var(--label-tertiary);
        transition: background-color 0.3s;
    }

    // Vault activé et déverrouillé : accent bien visible.
    &__trigger--active {
        background-color: color-mix(in srgb, var(--accent-primary) 15%, transparent);

        .vault-menu__trigger-icon {
            background-color: var(--accent-primary);
        }

        @media (hover: hover) {
            &:hover {
                background-color: color-mix(in srgb, var(--accent-primary) 25%, transparent);
            }
        }
    }

    // Vault activé mais verrouillé : ambre = action requise
    // (même convention que la jauge de FreeNestBanner).
    &__trigger--locked {
        background-color: rgba(243, 156, 18, 0.15);

        .vault-menu__trigger-icon {
            background-color: #f39c12;
        }

        @media (hover: hover) {
            &:hover {
                background-color: rgba(243, 156, 18, 0.25);
            }
        }
    }
}

.panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px 20px;
    width: min(440px, 90vw);

    &__title {
        text-align: center;
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
    &__error {
        color: var(--error-border, #ef4444);
        font-size: 14px;
        text-align: center;
    }
    &__notice {
        color: var(--label-secondary);
        font-size: 14px;
        text-align: center;
    }

    // Bloc « ? » : explication simple du mode vault, repliée par défaut.
    &__help {
        border: 1px solid var(--separator-secondary);
        border-radius: 12px;
        padding: 10px 12px;

        &[open] .panel__help-icon {
            background-color: var(--accent-primary);
            color: var(--background-primary);
        }
    }
    &__help-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
        color: var(--label-secondary);
        list-style: none;

        &::-webkit-details-marker {
            display: none;
        }
    }
    &__help-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background-color: var(--fill-tertiary);
        color: var(--label-tertiary);
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
        transition: background-color 0.3s, color 0.3s;
    }
    &__help-body {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 14px;
        color: var(--label-secondary);
    }
}
</style>
