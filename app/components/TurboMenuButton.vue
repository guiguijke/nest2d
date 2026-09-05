<template>
    <!-- Chantier B (J-093 suite) : bouton Turbo — boîte + interrupteur +
         notice. Flag-gated dev (NUXT_PUBLIC_TURBO_ENABLED) tant que la
         course client+serveur n'est pas codée ; la préférence est écrite
         côté serveur (réservée aux payants, P3). -->
    <div v-if="flagEnabled" class="turbo-menu">
        <button
            type="button"
            class="turbo-menu__btn"
            :class="{ 'turbo-menu__btn--on': enabled }"
            :aria-label="t('turbo.button')"
            :title="t('turbo.button')"
            @click="open = true"
        >
            ⚡
        </button>
        <DialogWrapper v-model:isModalOpen="open" trackingTag="turbo">
            <div class="turbo-box">
                <MainTitle :label="t('turbo.title')" class="turbo-box__title" />
                <label class="turbo-box__switch" :class="{ 'turbo-box__switch--disabled': loading }">
                    <input
                        type="checkbox"
                        :checked="enabled"
                        :disabled="loading"
                        @change="onToggle"
                    />
                    <span>{{ t('turbo.switchLabel') }}</span>
                </label>
                <p class="turbo-box__notice">{{ t('turbo.notice') }}</p>
                <p class="turbo-box__devnote">{{ t('turbo.devNote') }}</p>
                <p v-if="error" class="turbo-box__error" role="alert">{{ error }}</p>
            </div>
        </DialogWrapper>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants' // eslint-disable-line no-unused-vars — MainTitle theme cohérence
import { trackEvent } from '~/utils/track'

const { t } = useLocale()

const open = ref(false)
const loading = ref(false)
const error = ref('')

// Le bouton n'existe que si le flag dev/staging est ON (string ou bool —
// piège #29).
const flagEnabled = computed(() => {
    const v = useRuntimeConfig().public.turboEnabled
    return v === true || v === 'true'
})

const user = computed(() => unref(authStore.getters.user) || {})
const enabled = computed(() => user.value.turboHybrid === true)
const isFree = computed(() => (user.value.compute?.level || 'free') === 'free')

async function onToggle(event) {
    const next = Boolean(event?.target?.checked)
    error.value = ''
    trackEvent('click_turbo_toggle', { to: next ? 'on' : 'off' })
    if (next && isFree.value) {
        // Visible mais verrouillé : l'activation renvoie au paywall (le
        // serveur refuse aussi l'écriture — P3, double verrou).
        const buyCreditsDialog = useBuyCreditsDialog()
        open.value = false
        buyCreditsDialog.value = true
        return
    }
    loading.value = true
    try {
        await $fetch('/api/user/preferences', {
            method: 'PATCH',
            body: { turboHybrid: next },
        })
        await authStore.actions.setUser()
    } catch (err) {
        error.value = err?.data?.statusMessage === 'upgrade_required'
            ? t('turbo.locked')
            : t('turbo.error')
    } finally {
        loading.value = false
    }
}
</script>

<style lang="scss" scoped>
.turbo-menu {
    display: inline-flex;
    align-items: center;

    // Neutre quand désactivé, bien visible quand activé (demande produit).
    &__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        border: 1px solid var(--separator-secondary);
        background: transparent;
        color: var(--label-tertiary);
        font-size: 16px;
        cursor: pointer;
        transition: color 0.2s, border-color 0.2s, background-color 0.2s;

        &:hover {
            border-color: var(--separator-primary);
            color: var(--label-secondary);
        }

        &--on {
            color: #fff;
            background: var(--accent-primary);
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 22%, transparent);
        }
    }
}

.turbo-box {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 8px;
    max-width: 420px;

    &__switch {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 600;
        color: var(--label-primary);
        cursor: pointer;

        input {
            width: 18px;
            height: 18px;
            accent-color: var(--accent-primary);
        }

        &--disabled {
            opacity: 0.6;
            cursor: default;
        }
    }

    &__notice {
        font-size: 13px;
        color: var(--label-secondary);
        line-height: 1.45;
    }

    &__devnote {
        font-size: 12px;
        color: var(--label-tertiary);
        font-style: italic;
    }

    &__error {
        font-size: 13px;
        color: var(--error-text, #ef4444);
    }
}
</style>
