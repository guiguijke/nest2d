<template>
    <div class="main">
        <section class="main__hero hero">
            <div class="hero__content">
                <span class="hero__badge">{{ hero.badge }}</span>
                <h1 class="hero__title">
                    {{ hero.title }}
                </h1>
                <p class="hero__text">
                    {{ hero.text }}
                </p>
                <div class="hero__actions">
                    <MainButton
                        :theme="themeType.primary"
                        :label="hero.primaryCta"
                        @click="onGetForFreeClick"
                        trackingTag="hero_get_started"
                    />
                    <MainButton
                        :theme="themeType.secondary"
                        :label="hero.secondaryCta"
                        tag="a"
                        href="#how-it-works"
                        trackingTag="hero_how_it_works"
                    />
                </div>
                <p class="hero__hint">
                    {{ freeNestingsHint }}
                </p>
            </div>
            <button class="hero__visual" @click="openModal({ src: heroScreenshot, index: 0, theme: theme })">
                <img
                    :src="heroScreenshot"
                    alt="Nest2D workspace — parts nested on a sheet"
                    class="hero__img"
                />
            </button>
        </section>

        <section class="main__highlights highlights">
            <span
                v-for="item in highlights"
                :key="item"
                class="highlights__item"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="highlights__icon"><path d="M20 6 9 17l-5-5"/></svg>
                {{ item }}
            </span>
        </section>

        <section class="main__features features" id="features">
            <h2 class="features__title title title--medium">
                {{ features.title }}
            </h2>
            <p class="features__subtitle">
                {{ features.subtitle }}
            </p>
            <div class="features__list features-list">
                <div
                    v-for="featuresItem in features.list"
                    :key="featuresItem.title"
                    class="features-list__card"
                >
                    <span class="features-list__icon" v-html="featureIcons[featuresItem.icon]" />
                    <h3 class="features-list__title title">
                        {{ featuresItem.title }}
                    </h3>
                    <p class="features-list__text">
                        {{ featuresItem.text }}
                    </p>
                </div>
            </div>
        </section>

        <section class="main__works works" id="how-it-works">
            <h2 class="works__title title title--medium">
                {{ howItWorks.title }}
            </h2>
            <div class="works__list works-list">
                <div
                    v-for="(howItWorksItem, howItWorksIndex) in howItWorks.list"
                    :key="howItWorksItem.title"
                    class="works-list__item works-list-item"
                >
                    <span class="works-list-item__number">
                        {{ howItWorksIndex + 1 }}
                    </span>
                    <h3 class="works-list-item__title title">
                        {{ howItWorksItem.title }}
                    </h3>
                    <p class="works-list-item__text">
                        {{ howItWorksItem.text }}
                    </p>
                </div>
            </div>
        </section>

        <section class="main__screenshots screenshots" id="screenshots">
            <h2 class="screenshots__title title title--medium">
                {{ screenshots.title }}
            </h2>
            <div class="screenshots__list screenshots-list">
                <button
                    v-for="(screenshot, screenshotIndex) in screenshots.list[theme]"
                    :key="screenshot.src"
                    @click="openModal({ src: screenshot.src, index: screenshotIndex, theme: theme })"
                    class="screenshots-list__btn"
                >
                    <img
                        :src="screenshot.src"
                        alt="Nest2D user interface"
                        class="screenshots-list__img"
                    />
                </button>
            </div>
        </section>

        <section class="main__pricing pricing" id="pricing">
            <h2 class="pricing__title title title--medium">
                {{ pricing.title }}
            </h2>
            <p class="pricing__subtitle">
                {{ pricing.subtitle }}
            </p>
            <div class="pricing__list pricing-list">
                <div
                    v-for="tier in pricing.tiers"
                    :key="tier.name"
                    :class="{ 'pricing-list__card--highlighted': tier.highlighted }"
                    class="pricing-list__card"
                >
                    <span v-if="tier.badge" class="pricing-list__badge">{{ tier.badge }}</span>
                    <h3 class="pricing-list__name">{{ tier.name }}</h3>
                    <div class="pricing-list__price">
                        {{ tier.price }}
                        <span class="pricing-list__interval">/ {{ tier.interval }}</span>
                    </div>
                    <p class="pricing-list__description">{{ tier.description }}</p>
                    <ul class="pricing-list__features">
                        <li
                            v-for="feature in tier.features"
                            :key="feature"
                            class="pricing-list__feature"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pricing-list__check"><path d="M20 6 9 17l-5-5"/></svg>
                            {{ feature }}
                        </li>
                    </ul>
                    <MainButton
                        :theme="tier.highlighted ? themeType.primary : themeType.secondary"
                        :label="tier.cta"
                        :isDisable="Boolean(tier.comingSoon)"
                        :trackingTag="tier.trackingTag"
                        @click="onPricingClick(tier)"
                        class="pricing-list__cta"
                    />
                </div>
            </div>
        </section>

        <section class="main__faq faq" id="faq">
            <h2 class="faq__title title title--medium">
                {{ faq.title }}
            </h2>
            <p class="faq__text">
                {{ faq.text }}
            </p>
            <div class="faq__list faq-list">
                <div
                    :key="faqItem.title"
                    v-for="(faqItem, index) in faq.list"
                    class="faq-list__item"
                    @click="updateActiveFaqList(index)"
                >
                    <h3 :class="{'faq-list__title--active': activeFaqList === index}" class="faq-list__title title">
                        {{ faqItem.title }}
                    </h3>
                    <p :class="{'faq-list__text--active': activeFaqList === index}" class="faq-list__text">
                        {{ faqItem.firstPart }}
                        <a
                            v-if="faqItem.link"
                            class="faq-list__link"
                            :href="faqItem.linkHref"
                            :target="faqItem.target ? faqItem.target : '_self'"
                        >
                            {{ faqItem.link }}
                        </a>
                        <template v-if="faqItem.secondPart">
                            {{ ' ' + faqItem.secondPart }}
                        </template>
                    </p>
                </div>
            </div>
        </section>

        <section class="main__refund refund" id="refund">
            <h2 class="refund__title title title--medium">
                {{ refund.title }}
            </h2>
            <p class="refund__text">
                {{ refund.firstPart }}
                <a
                    v-if="refund.link"
                    class="refund__link"
                    :href="refund.linkHref"
                >
                    {{ refund.link }}
                </a>
                <template v-if="refund.secondPart">
                    {{ ' ' + refund.secondPart }}
                </template>
            </p>
        </section>

        <section class="main__started started" id="get-started">
            <h2 class="started__title title title--medium">
                {{ started.title }}
            </h2>
            <p class="started__text">
                {{ started.text }}
            </p>
            <MainButton
                :theme="themeType.primary"
                :label="started.cta"
                @click="onBottomLoginClick"
                trackingTag="bottom_get_started"
                class="started__btn"
            />
        </section>

        <ScreenshotsModal v-model:isModalOpen="screenshotDialog" />
        <LoginView />
    </div>
</template>
<script setup>
definePageMeta({
    middleware: 'auth'
})
onMounted(() => {
    trackEvent('page_view', { page: 'landing' })
})
import { hero, highlights, features, screenshots, howItWorks, pricing, useStarted, useFaq, useRefund } from '~~/data/index'
import { FREE_NESTING_LIMIT, TRIAL_DAYS } from '~~/constants/payment.constants'
import { defaultThemeType, themeType } from '~~/constants/theme.constants'

const started = useStarted()
const faq = useFaq()
const refund = useRefund()

const loginDialog = useLoginDialog()

function onGetForFreeClick() {
    trackEvent('click_get_started_for_free', { page: 'landing' })
    loginDialog.value = true
}

function onBottomLoginClick() {
    trackEvent('click_login_bottom', { page: 'landing' })
    loginDialog.value = true
}

function onPricingClick(tier) {
    if (tier.comingSoon) return
    trackEvent(`click_${tier.trackingTag}`, { page: 'landing' })
    loginDialog.value = true
}

const freeNestingsHint = `${FREE_NESTING_LIMIT} free nestings · No installation · ${TRIAL_DAYS}-day free trial`

// Inline monochrome stroke icons matching the design system.
const featureIcons = {
    nest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h6l2-4 3 8 2-4h5"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 4.9-9 4.9-9-4.9z"/><path d="m3 11.9 9 4.9 9-4.9"/><path d="m3 16.9 9 4.9 9-4.9"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
}

const screenshotDialog = useScreenshotDialog();

const { actions } = globalStore;
const { setModalScreenshotData } = actions;
const themeCookie = useCookie('theme');
const themeGlobal = computed(() => {
    return  themeCookie.value || defaultThemeType
})
const theme = computed(() => {
    return unref(themeGlobal)
})
const heroScreenshot = computed(() => `/screenshots/second-${unref(theme)}.png`)
const openModal = (screenshot) => {
    setModalScreenshotData(screenshot)
    screenshotDialog.value = true
}
const activeFaqList = ref(0)

const updateActiveFaqList = (index) => {
    activeFaqList.value = index
}
</script>
<style lang="scss" scoped>

.main {
    background-color: var(--background-primary);
    flex-direction: column;
    display: flex;
    min-height: 100vh;
    line-height: 1.4;
    color: var(--label-secondary);
    font-size: 14px;

    @media (min-width: 567px) {
        font-size: 18px;
    }
}

.title {
    color: var(--accent-primary);
    font-weight: 700;
    font-size: 16px;

    @media (min-width: 567px) {
        font-size: 20px;
    }

    &--medium {
        font-size: 1.5rem;

        @media (min-width: 567px) {
            font-size: 2rem;
        }
    }
}

section {
    padding: 32px 8px;
    text-align: center;

    @media (min-width: 567px) {
        padding: 56px 16px;
    }
    @media (min-width: 1199px) {
        padding: 72px 24px;
    }
}

// ---------- Hero ----------
.hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 40px;
    text-align: center;

    @media (min-width: 1199px) {
        flex-direction: row;
        text-align: left;
        gap: 64px;
    }

    &__content {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;

        @media (min-width: 1199px) {
            align-items: flex-start;
        }
    }

    &__badge {
        display: inline-block;
        padding: 6px 14px;
        border: 1px solid var(--separator-primary);
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-tertiary);
        margin-bottom: 24px;
    }

    &__title {
        color: var(--accent-primary);
        font-weight: 900;
        font-size: 2.25rem;
        line-height: 1.15;
        letter-spacing: -0.02em;
        max-width: 640px;

        @media (min-width: 567px) {
            font-size: 3rem;
        }
        @media (min-width: 1199px) {
            font-size: 3.5rem;
        }
    }

    &__text {
        margin-top: 20px;
        max-width: 540px;
        font-size: 1.05rem;
    }

    &__actions {
        margin-top: 32px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;

        @media (min-width: 1199px) {
            justify-content: flex-start;
        }
    }

    &__hint {
        margin-top: 16px;
        font-size: 13px;
        color: var(--label-tertiary);
    }

    &__visual {
        flex: 1;
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid var(--separator-secondary);
        box-shadow: 0 24px 60px -24px rgb(0, 0, 0, 0.35);
        transition: border-color 0.3s;
        max-width: 640px;
        cursor: zoom-in;
        background: none;
        padding: 0;

        @media (hover:hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }
    }

    &__img {
        display: block;
        width: 100%;
    }
}

// ---------- Highlights strip ----------
.highlights {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px 40px;
    border-top: 1px solid var(--separator-secondary);
    border-bottom: 1px solid var(--separator-secondary);
    padding-top: 24px;
    padding-bottom: 24px;

    &__item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 14px;
        color: var(--accent-primary);

        @media (min-width: 567px) {
            font-size: 16px;
        }
    }

    &__icon {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
    }
}

// ---------- Features ----------
.features {
    &__subtitle {
        margin-top: 12px;
        max-width: 640px;
        margin-left: auto;
        margin-right: auto;
    }
    &__list {
        margin-top: 40px;
    }
}

.features-list {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, 1fr);
    text-align: left;

    @media (min-width: 567px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
    }
    @media (min-width: 1199px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 32px;
    }

    &__card {
        border: 1px solid var(--separator-secondary);
        padding: 24px;
        border-radius: 16px;
        transition: border-color 0.3s;

        @media (hover:hover) {
            &:hover {
                border-color: var(--separator-primary);
            }
        }
    }
    &__icon {
        display: inline-flex;
        width: 40px;
        height: 40px;
        padding: 8px;
        border-radius: 10px;
        background-color: var(--fill-secondary);
        color: var(--accent-primary);

        :deep(svg) {
            width: 100%;
            height: 100%;
        }
    }
    &__title {
        margin-top: 16px;
    }
    &__text {
        margin-top: 12px;
        font-size: 15px;
    }
}

// ---------- How it works ----------
.works {
    &__list {
        margin-top: 40px;
    }
}

.works-list {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;

    &__item {
        flex-basis: 100%;

        @media (min-width: 567px) {
            flex-basis: calc(100% / 2);
        }
        @media (min-width: 1199px) {
            flex-basis: calc(100% / 3);
        }
    }
}

.works-list-item {
    padding: 10px;
    &__number {
        color: var(--accent-primary);
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: 1px solid var(--separator-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        font-weight: 700;
        margin-top: 12px;
        margin-bottom: 12px;
        margin-left: auto;
        margin-right: auto;
    }
    &__title {
        margin-top: 16px;
        margin-bottom: 16px;
    }
}

// ---------- Screenshots ----------
.screenshots {
    &__list {
        margin-top: 40px;
    }
}

.screenshots-list {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, 1fr);

    @media (min-width: 567px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
    }
    @media (min-width: 1199px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 32px;
    }
    &__btn {
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid var(--separator-secondary);
        transition: border-color 0.3s;
        cursor: zoom-in;
        background: none;
        padding: 0;

        @media (hover:hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }
    }
    &__img {
        display: block;
        width: 100%;
    }
}

// ---------- Pricing ----------
.pricing {
    &__subtitle {
        margin-top: 12px;
    }
    &__list {
        margin-top: 40px;
    }
}

.pricing-list {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, 1fr);
    text-align: left;
    align-items: stretch;

    @media (min-width: 1199px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 32px;
    }

    &__card {
        position: relative;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--separator-secondary);
        padding: 32px 24px;
        border-radius: 16px;

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
        padding: 4px 12px;
        border-radius: 999px;
        background-color: var(--accent-primary);
        color: var(--background-primary);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
    }

    &__name {
        color: var(--accent-primary);
        font-weight: 700;
        font-size: 18px;
    }

    &__price {
        margin-top: 16px;
        color: var(--accent-primary);
        font-weight: 900;
        font-size: 2.25rem;
    }

    &__interval {
        font-size: 14px;
        font-weight: 400;
        color: var(--label-tertiary);
    }

    &__description {
        margin-top: 8px;
        font-size: 14px;
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

// ---------- FAQ ----------
.faq {
    &__text {
        margin-top: 12px;
    }
    &__list {
        margin-top: 40px;
    }
}

.faq-list {
    text-align: left;
    max-width: 860px;
    margin-left: auto;
    margin-right: auto;

    &__item {
        margin-top: 16px;
    }
    &__link {
        color: var(--accent-primary);
        text-decoration: underline;
    }
    &__title {
        cursor: pointer;

        &--active {
            pointer-events: none;

            &::before {
                content: '• ';
            }
        }
    }
    &__text {
        margin-top: 8px;
        display: none;

        &--active {
            display: block;
        }
    }
}

// ---------- Refund ----------
.refund {
    &__text {
        margin-top: 16px;
        max-width: 720px;
        margin-left: auto;
        margin-right: auto;
    }
    &__link {
        color: var(--accent-primary);
        text-decoration: underline;
    }
}

// ---------- Final CTA ----------
.started {
    border: 1px solid var(--separator-secondary);
    border-radius: 24px;
    margin: 32px 8px;
    background-color: var(--fill-tertiary);

    &__text {
        margin-top: 12px;
        max-width: 640px;
        margin-left: auto;
        margin-right: auto;
    }
    &__btn {
        margin-top: 32px;
        margin-left: auto;
        margin-right: auto;
    }
}
</style>
