<template>
    <div class="account">
        <MainTitle :label="t('account.title')" class="account__title" />

        <details class="account__danger">
            <summary>{{ t('account.deleteTitle') }}</summary>

            <!-- Step 1 — alternatives to deletion (plan switch) -->
            <div v-if="showAlternatives" class="account__danger-block">
                <p class="account__block-title">
                    {{ t('account.alternativesTitle') }}
                </p>
                <p v-if="hasActiveSubscription" class="account__muted">
                    {{ t('account.alternativesDesc') }}
                </p>
                <div class="account__actions">
                    <MainButton
                        v-if="hasActiveSubscription && !data?.cancelAtPeriodEnd"
                        :theme="themeType.secondary"
                        :label="t('account.toFree')"
                        :isDisable="loading"
                        trackingTag="account_switch_free"
                        class="account__btn"
                        @click="switchToFree"
                    />
                    <MainButton
                        v-if="canUpgradeToPrivacy"
                        :theme="themeType.primary"
                        :label="t('account.toPrivacy', { plan: privacyPlanTitle })"
                        :isDisable="loading"
                        trackingTag="account_switch_privacy"
                        class="account__btn"
                        @click="switchToPrivacy"
                    />
                    <MainButton
                        v-if="showDiscoverPlan"
                        :theme="themeType.secondary"
                        :label="t('account.discoverPlan', { plan: standardPlanTitle })"
                        :isDisable="loading"
                        trackingTag="account_discover_plan"
                        class="account__btn"
                        @click="discoverPlan"
                    />
                </div>
            </div>

            <!-- Step 2 — irreversible deletion -->
            <div class="account__danger-block account__danger-block--critical">
                <p class="account__danger-title">
                    {{ t('account.deleteTitle') }}
                </p>
                <p class="account__muted">
                    {{ t('account.deleteDesc') }}
                </p>
                <p v-if="hasActiveSubscription" class="account__warning">
                    {{ t('account.deleteWarningSubscription') }}
                </p>
                <p class="account__confirm-challenge">
                    {{ t('account.confirmEmailLabel', { email: userEmail }) }}
                </p>
                <input
                    v-model="confirmEmail"
                    :placeholder="userEmail"
                    class="account__confirm-input"
                    autocomplete="off"
                    spellcheck="false"
                />
                <template v-if="isLocalAccount">
                    <p class="account__confirm-challenge">
                        {{ t('account.passwordLabel') }}
                    </p>
                    <input
                        v-model="password"
                        type="password"
                        :placeholder="t('account.passwordPlaceholder')"
                        class="account__confirm-input"
                        autocomplete="current-password"
                    />
                </template>
                <MainButton
                    :theme="themeType.primary"
                    :label="t('account.deleteBtn')"
                    :isDisable="!canDelete || loading"
                    trackingTag="account_delete"
                    class="account__btn"
                    @click="deleteAccount"
                />
            </div>
        </details>

        <p v-if="error" class="account__error">{{ error }}</p>
        <p v-if="notice" class="account__notice">{{ notice }}</p>
    </div>
</template>

<script setup>
import MainButton from './MainButton.vue'
import MainTitle from './MainTitle.vue'
import { themeType } from '~~/constants/theme.constants'
import { trackEvent } from '~/utils/track'

const { t } = useLocale()
const router = useRouter()

const { getters, actions } = authStore

// Paid CTAs follow the same kill-switch as the subscription card.
const paidDisabled = computed(() => useRuntimeConfig().public.paidPlansDisabled === true)

const { data, refresh } = await useFetch(API_ROUTES.SUBSCRIPTION)

const loading = ref(false)
const error = ref('')
const notice = ref('')
const confirmEmail = ref('')
const password = ref('')

const userEmail = computed(() => unref(getters.user)?.email || '')
const isLocalAccount = computed(() => unref(getters.user)?.provider === 'local')

const hasActiveSubscription = computed(() => {
    const status = unref(data)?.subscriptionStatus
    return status === 'active' || status === 'trialing'
})

// Current tier: 'privacy' > 'standard' > 'free' (no active subscription).
const currentTier = computed(() => {
    if (!hasActiveSubscription.value) return 'free'
    return unref(data)?.isPrivacyTier ? 'privacy' : 'standard'
})

const privacyPlanTitle = computed(
    () => unref(data)?.privacyPlan?.title || t('sub.proPrivacy')
)
const standardPlanTitle = computed(
    () => unref(data)?.plan?.title || t('plans.tier.unlimited')
)

// Alternatives: a paid account can fall back to Free (or climb to Privacy+);
// a free account can be shown the paid plan instead of leaving.
const canUpgradeToPrivacy = computed(
    () => hasActiveSubscription.value
        && currentTier.value === 'standard'
        && Boolean(unref(data)?.privacyPlan)
        && !paidDisabled.value
)
const showDiscoverPlan = computed(
    () => currentTier.value === 'free'
        && Boolean(unref(data)?.plan)
        && !paidDisabled.value
)
const showAlternatives = computed(
    () => (hasActiveSubscription.value && !unref(data)?.cancelAtPeriodEnd)
        || canUpgradeToPrivacy.value
        || showDiscoverPlan.value
)

const canDelete = computed(() => {
    const typed = confirmEmail.value.trim().toLowerCase()
    if (!typed || typed !== userEmail.value.toLowerCase()) return false
    if (isLocalAccount.value && !password.value) return false
    return true
})

const formatDate = (iso) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
    })
}

async function switchToFree() {
    if (loading.value) return
    if (!window.confirm(t('account.toFreeConfirm'))) return
    loading.value = true
    error.value = ''
    notice.value = ''
    try {
        const response = await $fetch(API_ROUTES.SUBSCRIPTION_CHANGE, {
            method: 'POST',
            body: { targetTier: 'free' },
        })
        notice.value = t('account.toFreeNotice', { date: formatDate(response?.currentPeriodEnd) })
        trackEvent('account_switch_free')
        await refresh()
        await actions.setUser()
    } catch (err) {
        error.value = t('account.error.change')
    } finally {
        loading.value = false
    }
}

async function switchToPrivacy() {
    if (loading.value) return
    if (!window.confirm(t('account.toPrivacyConfirm', { plan: privacyPlanTitle.value }))) return
    loading.value = true
    error.value = ''
    notice.value = ''
    try {
        await $fetch(API_ROUTES.SUBSCRIPTION_CHANGE, {
            method: 'POST',
            body: { targetTier: 'privacy' },
        })
        notice.value = t('account.toPrivacyNotice', { plan: privacyPlanTitle.value })
        trackEvent('account_switch_privacy')
        await refresh()
        await actions.setUser()
    } catch (err) {
        error.value = t('account.error.change')
    } finally {
        loading.value = false
    }
}

async function discoverPlan() {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
        const response = await $fetch(API_ROUTES.SUBSCRIBE)
        navigateTo(response.url, { external: true })
    } catch (err) {
        error.value = err?.data?.statusMessage || t('sub.error.start')
        loading.value = false
    }
}

async function deleteAccount() {
    if (!canDelete.value || loading.value) return
    if (!window.confirm(t('account.deleteConfirm'))) return
    loading.value = true
    error.value = ''
    notice.value = ''
    try {
        await $fetch(API_ROUTES.USER_DELETE, {
            method: 'POST',
            body: {
                confirmEmail: confirmEmail.value.trim(),
                password: isLocalAccount.value ? password.value : undefined,
            },
        })
        trackEvent('account_deleted')
        // The session is dead server-side: reuse the logout cleanup (clears
        // the cached user payload + auth state) then leave the profile.
        await actions.logout()
        router.push({ path: '/' })
    } catch (err) {
        const code = err?.data?.statusMessage
        if (code === 'confirmation_email_mismatch') {
            error.value = t('account.error.mismatch')
        } else if (code === 'invalid_password') {
            error.value = t('account.error.password')
        } else if (code === 'password_required') {
            error.value = t('account.error.passwordRequired')
        } else {
            error.value = t('account.error.generic')
        }
        loading.value = false
    }
}
</script>

<style lang="scss" scoped>
.account {
    margin-top: 32px;
    max-width: 520px;
    width: 100%;

    &__title {
        text-align: center;
    }
    &__muted {
        font-size: 14px;
        color: var(--label-tertiary);
    }
    &__warning {
        font-size: 14px;
        font-weight: 600;
        color: var(--error-border, #ef4444);
    }
    &__block-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--label-primary);
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
        margin-top: 20px;
        font-size: 14px;
        color: var(--label-secondary);

        summary {
            cursor: pointer;
            color: var(--error-border, #ef4444);
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
        color: var(--error-border, #ef4444);
        font-size: 15px;
    }
    &__confirm-challenge {
        font-size: 14px;
        color: var(--label-secondary);
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
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;

        &:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 15%, transparent);
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
