<template>
    <div
        v-if="show"
        class="free-nest"
        :class="{ 'free-nest--empty': isEmpty }"
    >
        <template v-if="isEmpty">
            <span class="free-nest__text">{{ t('banner.empty') }}</span>
            <button
                v-if="!paidDisabled"
                type="button"
                class="free-nest__link"
                @click="openPaywall"
            >
                {{ t('banner.cta') }}
            </button>
            <span v-else class="free-nest__link free-nest__link--disabled">
                {{ t('banner.comingSoon') }}
            </span>
        </template>
        <template v-else>
            <div class="free-nest__body">
                <span class="free-nest__text">
                    {{ t('banner.remaining', { n: freeRemaining, total: FREE_LIMIT }) }}
                </span>
                <div
                    class="free-nest__bar"
                    role="progressbar"
                    :aria-valuemin="0"
                    :aria-valuemax="FREE_LIMIT"
                    :aria-valuenow="freeRemaining"
                >
                    <div
                        class="free-nest__bar-fill"
                        :style="barStyle"
                        :class="barLevel"
                    />
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
    import { FREE_NESTING_LIMIT } from '~~/shared/constants/payment.constants'

    const { getters } = authStore
    const { t } = useLocale()

    // Temporarily disable the "Start free trial" CTA until paid plans are
    // re-enabled (NUXT_PUBLIC_PAID_PLANS_DISABLED).
    const paidDisabled = computed(() => useRuntimeConfig().public.paidPlansDisabled === true)

    const FREE_LIMIT = FREE_NESTING_LIMIT

    const user = computed(() => unref(getters.user) || {})

    const isSubscribed = computed(() => {
        const status = user.value.subscriptionStatus
        return status === 'active' || status === 'trialing'
    })

    const freeRemaining = computed(() => Number(user.value.freeRemaining || 0))

    // Only relevant for users who are not yet subscribed.
    const show = computed(() => !isSubscribed.value)

    const isEmpty = computed(() => freeRemaining.value <= 0)

    // Width of the progress bar reflects how much of the monthly quota remains.
    const barStyle = computed(() => ({
        width: `${(freeRemaining.value / FREE_LIMIT) * 100}%`,
    }))

    // Color shifts from green to amber to red as the allowance runs low, so the
    // user notices before hitting the paywall.
    const barLevel = computed(() => {
        const ratio = freeRemaining.value / FREE_LIMIT
        if (ratio > 0.5) return 'free-nest__bar-fill--high'
        if (ratio > 0.2) return 'free-nest__bar-fill--mid'
        return 'free-nest__bar-fill--low'
    })

    const buyCreditsDialog = useBuyCreditsDialog()
    const openPaywall = () => {
        buyCreditsDialog.value = true
    }
</script>

<style lang="scss" scoped>
    .free-nest {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 12px;
        font-size: 13px;
        color: var(--label-secondary);

        &--empty {
            color: var(--accent-primary);
        }

        &__body {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            width: 100%;
            max-width: 280px;
        }

        &__text {
            text-align: center;
        }

        &__link {
            font-weight: 700;
            color: var(--accent-primary);
            text-decoration: underline;
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            font-size: 13px;

            &--disabled {
                color: var(--label-tertiary);
                text-decoration: none;
                cursor: default;
            }
        }

        &__bar {
            width: 100%;
            height: 4px;
            border-radius: 999px;
            background: var(--fill-secondary, rgba(0, 0, 0, 0.08));
            overflow: hidden;
        }

        &__bar-fill {
            height: 100%;
            border-radius: 999px;
            transition: width 0.3s ease;

            &--high {
                background: #2ecc71;
            }

            &--mid {
                background: #f39c12;
            }

            &--low {
                background: #e74c3c;
            }
        }
    }
</style>
