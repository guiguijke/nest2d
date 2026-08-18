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
            <span class="free-nest__reset">
                {{ t('banner.resetsAt', { date: resetLabel }) }}
            </span>
        </template>
        <template v-else>
            <div class="free-nest__body">
                <span class="free-nest__text">
                    {{ t('banner.remaining', { n: freeRemaining, total: freeLimit }) }}
                </span>
                <div
                    class="free-nest__bar"
                    role="progressbar"
                    :aria-valuemin="0"
                    :aria-valuemax="freeLimit"
                    :aria-valuenow="freeRemaining"
                >
                    <div
                        class="free-nest__bar-fill"
                        :style="barStyle"
                        :class="barLevel"
                    />
                </div>
                <span class="free-nest__reset">
                    {{ t('banner.resetsAt', { date: resetLabel }) }}
                </span>
            </div>
        </template>
    </div>
</template>

<script setup>
    import { FREE_NESTING_LIMIT } from '~~/shared/constants/payment.constants'
    import { formatQuotaReset } from '~/utils/quotaReset'
    import { hasPaidAccess } from '~/utils/entitlementUi'

    const { getters } = authStore
    const { t, locale } = useLocale()

    // Temporarily disable the "Start free trial" CTA until paid plans are
    // re-enabled (NUXT_PUBLIC_PAID_PLANS_DISABLED).
    const paidDisabled = computed(() => useRuntimeConfig().public.paidPlansDisabled === true)

    const user = computed(() => unref(getters.user) || {})

    // The monthly quota is per-user: a redeemed partner promo code raises it
    // for the campaign duration (server computes promo.active from the
    // snapshotted end date). Same resolution as effectiveFreeLimit()
    // server-side — never show the raised limit once the campaign has ended.
    const freeLimit = computed(() => {
        const promo = user.value.promo
        return promo?.active && Number.isInteger(promo.freeNestingLimit) && promo.freeNestingLimit > 0
            ? promo.freeNestingLimit
            : FREE_NESTING_LIMIT
    })

    const isSubscribed = computed(() => hasPaidAccess(user.value))

    const freeRemaining = computed(() => Number(user.value.freeRemaining || 0))

    // Hide once Stripe OR an admin grant (D-PAY-11) unlocks Unlimited/Pro.
    const show = computed(() => !isSubscribed.value)

    const isEmpty = computed(() => freeRemaining.value <= 0)

    // Date+heure localisées du reset mensuel (1er du mois suivant, 00:00 UTC).
    const resetLabel = computed(() => formatQuotaReset(new Date(), locale.value))

    // Width of the progress bar reflects how much of the monthly quota remains.
    const barStyle = computed(() => ({
        width: `${(freeRemaining.value / freeLimit.value) * 100}%`,
    }))

    // Color shifts from green to amber to red as the allowance runs low, so the
    // user notices before hitting the paywall.
    const barLevel = computed(() => {
        const ratio = freeRemaining.value / freeLimit.value
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
            flex-wrap: wrap;
        }

        // Ligne discrète sous la barre / sous le CTA : la date de reset du
        // quota ne doit pas rivaliser avec le compteur principal.
        &__reset {
            font-size: 12px;
            color: var(--label-tertiary);
            text-align: center;
        }

        // État vide : le texte et le CTA tiennent sur une ligne, la date
        // de reset passe sur sa propre ligne en dessous.
        &--empty &__reset {
            flex-basis: 100%;
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
