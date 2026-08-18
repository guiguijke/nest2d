<template>
    <div class="subscription">
        <MainTitle :label="t('profile.subscription')" class="subscription__title" />

        <div v-if="isStripeActive" class="subscription__card">
            <div class="subscription__status">
                <span class="subscription__badge">{{ statusLabel }}</span>
            </div>
            <p v-if="data?.cancelAtPeriodEnd" class="subscription__cancel-notice">
                {{ t('sub.cancelNotice', { date: formatDate(data?.currentPeriodEnd) }) }}
            </p>
            <p v-else class="subscription__desc">
                {{ t('sub.activeDesc') }}
            </p>
            <MainButton
                v-if="!data?.cancelAtPeriodEnd"
                :label="t('sub.cancelBtn')"
                :theme="themeType.secondary"
                :size="sizeType.m"
                :isDisable="isLoading"
                trackingTag="subscription_cancel"
                class="subscription__btn subscription__btn--cancel"
                @click="cancelSubscription"
            />
        </div>

        <div v-else-if="isGranted" class="subscription__card">
            <div class="subscription__status">
                <span class="subscription__badge">{{ t('sub.grantActive') }}</span>
            </div>
            <p class="subscription__desc">{{ t('sub.grantDesc') }}</p>
        </div>

        <div v-if="isActive && data?.isPrivacyTier" class="subscription__card">
            <div class="subscription__status">
                <span class="subscription__badge">{{ t('sub.proPrivacy') }}</span>
            </div>
            <p class="subscription__desc">
                Maximum compute budget and priority queue are enabled on your
                account.
            </p>
        </div>

        <div v-else-if="isActive && data?.privacyPlan" class="subscription__card">
            <div class="subscription__plan-title">{{ data.privacyPlan.title || t('sub.proPrivacy') }}</div>
            <div class="subscription__price">
                {{ formatPrice(data.privacyPlan.amount, data.privacyPlan.currency) }}
                <span class="subscription__interval">/ {{ data.privacyPlan.interval }}</span>
            </div>
            <p class="subscription__desc">
                Maximum compute budget and priority queue.
            </p>
            <MainButton
                v-if="!paidDisabled"
                :label="t('sub.upgradePro')"
                :theme="themeType.primary"
                :size="sizeType.m"
                :isDisable="isLoading"
                trackingTag="subscription_upgrade_pro"
                class="subscription__btn"
                @click="subscribePro"
            />
            <MainButton
                v-else
                :label="t('sub.comingSoon')"
                :theme="themeType.secondary"
                :size="sizeType.m"
                :isDisable="true"
                class="subscription__btn"
            />
        </div>

        <div v-else-if="!isGranted" class="subscription__card">
            <div v-if="data?.plan" class="subscription__plan">
                <div class="subscription__plan-title">{{ data.plan.title || t('sub.monthlyPlan') }}</div>
                <div class="subscription__price">
                    {{ formatPrice(data.plan.amount, data.plan.currency) }}
                    <span class="subscription__interval">/ {{ data.plan.interval }}</span>
                </div>
                <div class="subscription__free">
                    {{ t('sub.freeLeft', { n: data.freeRemaining }) }}
                </div>
                <div class="subscription__reset">
                    {{ t('sub.resetsAt', { date: quotaResetLabel }) }}
                </div>
                <MainButton
                    v-if="!paidDisabled"
                    :label="t('sub.startTrial', { days: data.plan.trialDays })"
                    :theme="themeType.primary"
                    :size="sizeType.m"
                    :isDisable="isLoading"
                    trackingTag="subscription_start_trial"
                    class="subscription__btn"
                    @click="subscribe"
                />
                <MainButton
                    v-else
                    :label="t('sub.comingSoon')"
                    :theme="themeType.secondary"
                    :size="sizeType.m"
                    :isDisable="true"
                    class="subscription__btn"
                />
                <p class="subscription__note">
                    {{ t('sub.cancelTrialNote') }}
                </p>
            </div>
            <div v-else class="subscription__desc">
                {{ t('sub.unavailable') }}
            </div>
        </div>

        <div v-if="error" class="subscription__error">{{ error }}</div>
    </div>
</template>

<script setup>
import MainButton from './MainButton.vue'
import MainTitle from './MainTitle.vue'
import { themeType } from '~~/constants/theme.constants'
import { sizeType } from '~~/constants/size.constants'
import { formatQuotaReset } from '~/utils/quotaReset'

const { t, locale } = useLocale()

// Date+heure localisées du reset du quota gratuit (1er du mois suivant,
// 00:00 UTC) — affichées près du compteur de nestings restants.
const quotaResetLabel = computed(() => formatQuotaReset(new Date(), locale.value))

// Temporarily disable paid-plan CTAs (Unlimited trial + Pro upgrade) until
// Strip ships to production. Toggle via NUXT_PUBLIC_PAID_PLANS_DISABLED.
const paidDisabled = computed(() => useRuntimeConfig().public.paidPlansDisabled === true)

const { data, refresh } = await useFetch('/api/payment/subscription')

const isLoading = ref(false)
const error = ref('')

const formatDate = (iso) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
    })
}

const { data: userMe } = useNuxtData('user')
const isStripeActive = computed(() => {
    const status = unref(data)?.subscriptionStatus
    return status === 'active' || status === 'trialing'
})
const isGranted = computed(() => {
    if (isStripeActive.value) return false
    if (unref(data)?.granted) return true
    const level = unref(userMe)?.compute?.level
    return level === 'standard' || level === 'privacy'
})
const isActive = computed(() => isStripeActive.value || isGranted.value)

const statusLabel = computed(() => {
    const status = unref(data)?.subscriptionStatus
    if (status === 'trialing') return t('sub.trialActive')
    if (status === 'active') return t('sub.active')
    return status || ''
})

const formatPrice = (amount, currency) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount)
}

const subscribe = async () => {
    if (isLoading.value) return
    error.value = ''
    isLoading.value = true
    try {
        const response = await $fetch('/api/payment/subscribe')
        navigateTo(response.url, { external: true })
    } catch (err) {
        error.value = err?.data?.statusMessage || t('sub.error.start')
        isLoading.value = false
    }
}

const subscribePro = async () => {
    if (isLoading.value) return
    error.value = ''
    isLoading.value = true
    try {
        const response = await $fetch('/api/payment/subscribe?tier=privacy')
        navigateTo(response.url, { external: true })
    } catch (err) {
        error.value = err?.data?.statusMessage || t('sub.error.startPro')
        isLoading.value = false
    }
}

const cancelSubscription = async () => {
    if (isLoading.value) return
    const confirmed = window.confirm(t('sub.cancelConfirm'))
    if (!confirmed) return
    error.value = ''
    isLoading.value = true
    try {
        await $fetch('/api/payment/subscription/cancel', { method: 'POST' })
        await refresh()
    } catch (err) {
        error.value = err?.data?.statusMessage || t('sub.error.cancel')
    } finally {
        isLoading.value = false
    }
}
</script>

<style lang="scss" scoped>
.subscription {
    display: flex;
    flex-direction: column;
    align-items: center;

    &__title {
        margin-bottom: 18px;
    }

    &__card {
        min-width: 320px;
        max-width: 420px;
        padding: 24px 20px;
        border-radius: 8px;
        background: var(--fill-tertiary);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
        text-align: center;
    }

    &__badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        color: var(--background-primary);
        background-color: var(--accent-primary);
    }

    &__desc {
        margin-top: 12px;
        font-size: 14px;
        color: var(--label-secondary);
    }

    &__plan-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--label-primary);
        margin-bottom: 6px;
    }

    &__price {
        font-size: 28px;
        font-weight: 800;
        color: var(--label-primary);
    }

    &__interval {
        font-size: 14px;
        font-weight: 500;
        color: var(--label-secondary);
    }

    &__free {
        margin: 12px 0 4px;
        font-size: 13px;
        color: var(--accent-primary);
    }

    // Date de reset du quota gratuit : discrète, sous le compteur.
    &__reset {
        margin: 0 0 18px;
        font-size: 12px;
        color: var(--label-tertiary);
    }

    // Override MainButton's default `width: max-content` so the trial button
    // stretches to the full width of the card. The descendant selector raises
    // specificity enough to win against the child component's own scoped rule.
    &__card &__btn {
        width: 100%;
    }

    &__btn--cancel {
        margin-top: 16px;
    }

    &__cancel-notice {
        margin-top: 12px;
        font-size: 14px;
        color: var(--label-secondary);
    }

    &__note {
        margin-top: 14px;
        font-size: 13px;
        color: var(--label-secondary);
    }

    &__error {
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        color: rgb(222, 0, 54);
    }
}
</style>
