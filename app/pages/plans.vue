<template>
    <div class="plans">
        <section class="plans__hero">
            <h1 class="plans__title title title--large">Plans &amp; pricing</h1>
            <p class="plans__subtitle">
                Start free, upgrade when the material savings speak for themselves.
            </p>
        </section>

        <section class="plans__cards cards">
            <div
                v-for="tier in tiers"
                :key="tier.name"
                :class="{ 'cards__card--highlighted': tier.highlighted }"
                class="cards__card"
            >
                <span class="cards__badge" :class="`cards__badge--${tier.badgeKind}`">
                    {{ tier.badge }}
                </span>
                <h2 class="cards__name">{{ tier.name }}</h2>
                <div class="cards__price">
                    {{ tier.price }}
                    <span class="cards__interval">/ {{ tier.interval }}</span>
                </div>
                <p class="cards__description">{{ tier.description }}</p>
                <ul class="cards__features">
                    <li v-for="feature in tier.features" :key="feature" class="cards__feature">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cards__check"><path d="M20 6 9 17l-5-5"/></svg>
                        {{ feature }}
                    </li>
                </ul>
                <MainButton
                    :theme="tier.highlighted ? themeType.primary : themeType.secondary"
                    :label="userIsSet ? 'Manage in profile' : tier.cta"
                    :isDisable="Boolean(tier.comingSoon && !userIsSet)"
                    :trackingTag="tier.trackingTag"
                    @click="onTierClick(tier)"
                    class="cards__cta"
                />
            </div>
        </section>

        <section class="plans__compare compare">
            <h2 class="compare__title title title--medium">Compare plans</h2>
            <div class="compare__table-wrapper">
                <table class="compare__table">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Free</th>
                            <th class="compare__th--highlighted">Unlimited</th>
                            <th>Pro</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in comparisonRows" :key="row.label">
                            <td class="compare__label">{{ row.label }}</td>
                            <td v-for="(value, i) in row.values" :key="i"
                                :class="{ 'compare__td--highlighted': i === 1 }"
                                class="compare__value">
                                <svg v-if="value === true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="compare__icon compare__icon--yes"><path d="M20 6 9 17l-5-5"/></svg>
                                <span v-else-if="value === false" class="compare__icon compare__icon--no">—</span>
                                <template v-else>{{ value }}</template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <LoginView />
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { FREE_NESTING_LIMIT, TRIAL_DAYS, SUBSCRIPTION_PRICE_LABEL, PRO_PRICE_LABEL } from '~~/shared/constants/payment.constants'

onMounted(() => {
    trackEvent('page_view', { page: 'plans' })
})

const loginDialog = useLoginDialog()
const { getters: authGetters } = authStore
const userIsSet = computed(() => Boolean(unref(authGetters.userIsSet)))

// Temporarily disable paid-plan CTAs (Unlimited trial + Pro upgrade) until
// Strip ships to production. Toggle via NUXT_PUBLIC_PAID_PLANS_DISABLED.
const paidDisabled = computed(() => useRuntimeConfig().public.paidPlansDisabled === true)

// Shared with the landing via the 'payment-plans' cache key (deduplicated +
// cached for a few minutes). See composables/usePlans.js.
const { data: plans } = usePlans()
const formatPlanPrice = (plan) => {
    if (!plan?.available) return null
    return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: plan.currency || 'eur',
        maximumFractionDigits: plan.amount % 1 === 0 ? 0 : 2,
    }).format(plan.amount)
}

const tiers = computed(() => {
    const proPlan = unref(plans)?.privacy
    const proAvailable = Boolean(proPlan?.available)
    return [
        {
            name: 'Free',
            price: '€0',
            interval: 'forever',
            badge: 'Discovery',
            badgeKind: 'neutral',
            description: 'Try the engine on your own parts, every month.',
            features: [
                `${FREE_NESTING_LIMIT} free nestings every month`,
                'All core nesting features',
                'DXF & ZIP export',
            ],
            cta: 'Start for free',
            trackingTag: 'plans_free',
        },
        {
            name: 'Unlimited',
            price: SUBSCRIPTION_PRICE_LABEL,
            interval: 'month',
            badge: 'Most popular',
            badgeKind: 'accent',
            highlighted: true,
            description: 'For makers and workshops that nest every week.',
            features: [
                'Unlimited nesting operations',
                '3 alternative layouts per job',
                'Multi-sheet jobs',
                'Email notifications',
            ],
            // When paid plans are disabled, the card stays visible (price +
            // features) but the CTA shows "Coming soon" and does nothing.
            cta: paidDisabled.value ? 'Coming soon' : `Start ${TRIAL_DAYS}-day free trial`,
            comingSoon: paidDisabled.value,
            trackingTag: 'plans_unlimited',
        },
        {
            name: 'Pro',
            price: proAvailable ? formatPlanPrice(proPlan) : PRO_PRICE_LABEL,
            interval: 'month',
            badge: 'Confidentiality+',
            badgeKind: 'pro',
            description: 'Maximum confidentiality and the densest layouts.',
            features: [
                'Everything in Unlimited',
                'Zero-knowledge encryption',
                'Maximum compute budget',
                'Priority queue',
            ],
            cta: proAvailable && !paidDisabled.value ? 'Get Pro' : 'Coming soon',
            comingSoon: !proAvailable || paidDisabled.value,
            trackingTag: 'plans_pro',
        },
    ]
})

const comparisonRows = [
    { label: 'Nestings included', values: [`${FREE_NESTING_LIMIT} / month`, 'Unlimited', 'Unlimited'] },
    { label: 'Alternative layouts per job', values: ['1', '3', '3'] },
    { label: 'Compute budget (layout quality)', values: ['Standard', 'High', 'Maximum'] },
    { label: 'Processing priority', values: [false, 'Standard', 'Priority'] },
    { label: 'Multi-sheet jobs', values: [true, true, true] },
    { label: 'Heterogeneous sheet types', values: [true, true, true] },
    { label: 'DXF & ZIP export', values: [true, true, true] },
    { label: 'Email notifications', values: [false, true, true] },
    { label: 'Zero-knowledge encryption', values: [false, false, true] },
    { label: '7-day free trial', values: [false, true, true] },
]

function onTierClick(tier) {
    if (tier.comingSoon && !userIsSet.value) return
    trackEvent(`click_${tier.trackingTag}`, { page: 'plans' })
    if (userIsSet.value) {
        navigateTo('/profile')
        return
    }
    loginDialog.value = true
}
</script>

<style lang="scss" scoped>
.plans {
    line-height: 1.4;
    color: var(--label-secondary);

    &__hero {
        text-align: center;
        padding: 24px 16px 8px;
    }
    &__title {
        color: var(--accent-primary);
    }
    &__subtitle {
        margin-top: 12px;
    }
}

.title {
    color: var(--accent-primary);
    font-weight: 700;

    &--large {
        font-size: 2rem;

        @media (min-width: 567px) {
            font-size: 2.5rem;
        }
    }
    &--medium {
        font-size: 1.5rem;

        @media (min-width: 567px) {
            font-size: 2rem;
        }
    }
}

// ---------- Cards ----------
.cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, 1fr);
    padding: 32px 8px;
    max-width: 1100px;
    margin: 0 auto;

    @media (min-width: 1199px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 32px;
        padding: 48px 16px;
    }

    &__card {
        position: relative;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--separator-secondary);
        padding: 32px 24px;
        border-radius: 16px;
        background-color: var(--background-primary);

        &--highlighted {
            border-color: var(--accent-primary);
            background-color: var(--fill-tertiary);
        }
    }

    &__badge {
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 14px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
        letter-spacing: 0.03em;

        &--neutral {
            background-color: var(--fill-secondary);
            color: var(--label-secondary);
            border: 1px solid var(--separator-primary);
        }
        &--accent {
            background-color: var(--accent-primary);
            color: var(--background-primary);
        }
        &--pro {
            background-color: var(--background-secondary);
            color: var(--background-primary);
            border: 1px solid var(--accent-primary);
        }
    }

    &__name {
        color: var(--accent-primary);
        font-weight: 700;
        font-size: 20px;
        text-align: center;
    }

    &__price {
        margin-top: 12px;
        color: var(--accent-primary);
        font-weight: 900;
        font-size: 2.25rem;
        text-align: center;
    }

    &__interval {
        font-size: 14px;
        font-weight: 400;
        color: var(--label-tertiary);
    }

    &__description {
        margin-top: 8px;
        font-size: 14px;
        text-align: center;
    }

    &__features {
        margin-top: 24px;
        margin-bottom: 32px;
        flex-grow: 1;
    }

    &__feature {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 14px;
        padding: 6px 0;
    }

    &__check {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--accent-primary);
    }

    &__cta {
        width: 100%;
    }
}

// ---------- Comparison table ----------
.compare {
    padding: 32px 8px 64px;
    max-width: 900px;
    margin: 0 auto;

    &__title {
        text-align: center;
        margin-bottom: 32px;
    }

    &__table-wrapper {
        overflow-x: auto;
        border: 1px solid var(--separator-secondary);
        border-radius: 16px;
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
        min-width: 560px;

        th, td {
            padding: 14px 18px;
            text-align: center;
        }

        thead th {
            color: var(--accent-primary);
            font-weight: 700;
            font-size: 15px;
            border-bottom: 1px solid var(--separator-primary);
        }

        tbody tr:not(:last-child) td {
            border-bottom: 1px solid var(--separator-secondary);
        }
    }

    &__label {
        text-align: left !important;
        color: var(--label-primary);
        font-weight: 600;
    }

    &__value {
        color: var(--label-secondary);
    }

    &__th--highlighted,
    &__td--highlighted {
        background-color: var(--fill-tertiary);
    }

    &__icon {
        display: inline-block;
        width: 18px;
        height: 18px;

        &--yes {
            color: var(--accent-primary);
        }
        &--no {
            color: var(--label-tertiary);
        }
    }
}
</style>
