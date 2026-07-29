<template>
    <header class="header">
        <component :is="logoTag" v-bind="logoHref" class="header__logo logo">
            <img :src="logoMarkSrc" alt="APlasma" class="logo__mark" />
            <span class="logo__label">
                APlasma <span class="logo__label--light">Nesting</span>
            </span>
        </component>
        <nav v-if="isPrimaryTheme" class="header__tabs tabs">
            <NuxtLink to="/" class="tabs__link" active-class="tabs__link--active">
                APlasma
            </NuxtLink>
            <NuxtLink to="/home" class="tabs__link" active-class="tabs__link--active">
                {{ t('nav.workspace') }}
            </NuxtLink>
            <NuxtLink v-if="isStripFeatureEnabled" to="/strip" class="tabs__link" active-class="tabs__link--active">
                {{ t('nav.strip') }}
            </NuxtLink>
        </nav>
        <nav v-if="isSecondaryTheme" :class="navClasses" class="header__nav nav">
            <ul class="nav__list">
                <li v-for="(navItem, navIndex) in nav" :key="navIndex" @click="toggleMenu" class="nav__item">
                    <NuxtLink :to="navItem.href" class="nav__link">
                        {{ navItem.label }}
                    </NuxtLink>
                </li>
            </ul>
            <div @click="toggleMenu" class="nav__background" />
        </nav>
        <div :class="{ 'header__wrapper--is-primary': isPrimaryTheme }" class="header__wrapper">
            <div class="header__theme">
                <MainButton :theme="themeType.primary" :icon="themeIcon" :isLabelShow=false trackingTag="toggle_theme"
                    @click="updateTheme" :label="t('nav.toggleTheme')" />
            </div>
            <LocaleSwitcher class="header__btn" />
            <MainButton :href="githubIssues" target="_blank"
                :label="t('nav.reportProblem')" tag="a" trackingTag="report_problem" class="header__btn" v-if="isSecondaryTheme" />
            <UserBalance class="header__btn" v-if="isPrimaryTheme && !isStripPage && !isStripFeatureEnabled" />
            <MainButton v-if="isSecondaryTheme && userIsLoggedIn"
                :theme="themeType.primary" :label="t('nav.openWorkspace')"
                trackingTag="open_workspace" @click="openWorkspace"
                class="header__btn" />
            <MainButton v-if="isSecondaryTheme && !userIsLoggedIn" :theme="themeType.primary" @click="onLoginClick" :label="t('nav.login')"
                class="header__btn header__btn--login" />
            <LoginView />
            <Avatar v-if="isPrimaryTheme || userIsLoggedIn" :size="sizeType.s" class="header__avatar" />
            <div v-if="isSecondaryTheme" class="header__toggler">
                <MainButton :theme="themeType.secondary" :icon="iconType.menu" :isLabelShow=false trackingTag="menu_toggle"
                    @click="toggleMenu" :label="t('nav.menu')" />
            </div>
        </div>
    </header>
</template>
<script setup>
import { NuxtLink } from '#components';
import { defaultThemeType, themeType } from "~~/constants/theme.constants";
import { iconType } from '~~/constants/icon.constants';
import { sizeType } from '~~/constants/size.constants';
import { trackEvent } from '~/utils/track';
import { useSiteConfig } from '~~/data/siteConfig';

const { githubIssues } = useSiteConfig()

const { t } = useLocale()

const loginDialog = useLoginDialog()

async function onLoginClick() {
    trackEvent('click_login', { page: 'main_header' })
    loginDialog.value = true
}

function openWorkspace() {
    trackEvent('click_open_workspace', { page: 'main_header' })
    navigateTo('/home')
}

const { theme } = defineProps({
    theme: {
        type: String,
        default: defaultThemeType,
    },
})

const route = useRoute()

const menuIsOpen = ref(false);
const nav = computed(() => [
    {
        label: t('nav.features'),
        href: '/#features',
    },
    {
        label: t('nav.howItWorks'),
        href: '/#how-it-works',
    },
    {
        label: t('nav.pricing'),
        href: '/plans',
    },
    {
        label: t('nav.faq'),
        href: '/#faq',
    },
    {
        label: t('nav.changelog'),
        href: '/changelog',
    },
])

const { getters: authGetters } = authStore;
const isStripFeatureEnabled = computed(() => {
    return Boolean(unref(authGetters.user)?.isStripFeatureEnable)
})
const userIsLoggedIn = computed(() => Boolean(unref(authGetters.userIsSet)))

const isPrimaryTheme = computed(() => {
    return unref(theme) === themeType.primary
})
const isSecondaryTheme = computed(() => {
    return unref(theme) === themeType.secondary
})
const isHomePage = computed(() => {
    return route.path === '/home' || route.path === '/'
})
const isStripPage = computed(() => {
    return route.path === '/strip' || route.path.startsWith('/strip/')
})
// The logo is always a link back to a meaningful home: the tool's workspace
// when already inside the app (primary theme), the marketing landing
// otherwise. Previously it was a non-clickable <div> on the landing and on
// /home, which stranded the user.
const logoTag = computed(() => NuxtLink)
const logoHref = computed(() => {
    const hrefValue = unref(isPrimaryTheme) ? '/home' : '/'
    return { to: hrefValue }
})
const navClasses = computed(() => ({
    'nav--is-open': unref(menuIsOpen),
    'header__nav--is-open': unref(menuIsOpen)
}))
const toggleMenu = () => {
    menuIsOpen.value = !unref(menuIsOpen)
}

const { actions } = themeStore;
const { updateTheme } = actions;

const themeCookie = useCookie('theme');
const themeGlobal = computed(() => {
    return themeCookie.value || defaultThemeType
})
const themeIcon = computed(() => {
    return unref(themeGlobal) === themeType.primary ? iconType.light : iconType.dark
})

// Brand lockup follows the theme: anthracite+rust on light, white on dark.
const logoMarkSrc = computed(() => {
    return unref(themeGlobal) === themeType.primary
        ? '/brand/logo-blanc.png'
        : '/brand/logo-gr.png'
})

</script>
<style lang="scss" scoped>
.header {
    position: relative;
    display: flex;
    justify-content: space-between;
    padding: 12px 8px;
    flex-direction: column;

    @media (min-width: 567px) {
        flex-direction: row;
        align-items: center;
        padding: 16px 10px;
    }

    &__wrapper {
        margin-top: 16px;
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        align-items: center;

        &>*:not(:first-child) {
            margin: 4px;

            @media (min-width: 567px) {
                margin: 0 0 0 16px;
            }
        }

        @media (min-width: 567px) {
            flex-direction: initial;
            margin-top: initial;
        }

        &--is-primary {
            flex-direction: row-reverse;
            justify-content: space-between;

            @media (min-width: 567px) {
                flex-direction: initial
            }
        }
    }

    &__theme {
        @media (min-width: 567px) {
            margin-bottom: initial;
        }
    }

    &__avatar {
        position: absolute;
        top: 8px;
        right: 4px;

        @media (min-width: 567px) {
            position: initial;
            top: initial;
            right: initial;
        }
    }

    &__nav {
        z-index: 1;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        transform: translate3d(120%, 0, 0);
        transition: transform 0.3s;

        @media (min-width: 1199px) {
            position: initial;
            top: initial;
            left: initial;
            right: initial;
            bottom: initial;
            transform: initial;
        }

        &--is-open {
            transform: translate3d(0, 0, 0);

            @media (min-width: 1199px) {
                transform: initial;
            }
        }
    }

    &__toggler {
        @media (min-width: 1199px) {
            display: none;
        }
    }

    &__btn {
        &--login {
            position: absolute;
            top: 8px;
            right: 4px;

            @media (min-width: 567px) {
                position: initial;
                top: initial;
                right: initial;
            }
        }
    }
}

.tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;

    @media (min-width: 567px) {
        margin-top: initial;
    }

    &__link {
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 14px;
        font-weight: 700;
        color: var(--label-secondary);
        background-color: var(--fill-tertiary);
        transition: color 0.3s, background-color 0.3s;

        @media (hover:hover) {
            &:hover {
                color: var(--accent-primary);
                background-color: var(--fill-secondary);
            }
        }

        &--active {
            color: var(--background-primary);
            background-color: var(--accent-primary);

            @media (hover:hover) {
                &:hover {
                    color: var(--background-primary);
                    background-color: var(--accent-secondary);
                }
            }
        }
    }
}

.logo {
    display: flex;
    align-items: center;
    gap: 10px;

    &__mark {
        height: 42px;
        width: auto;
        object-fit: contain;
    }

    &__label {
        display: block;
        font-size: 22px;
        font-weight: 700;
        color: var(--accent-primary);
        white-space: nowrap;

        &--light {
            font-weight: 400;
            color: var(--label-secondary);
        }
    }
}

.nav {
    padding-top: 80px;

    @media (min-width: 1199px) {
        padding-top: initial;
    }

    &__list {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;

        @media (min-width: 1199px) {
            position: initial;
            z-index: initial;
            justify-content: initial;
            flex-direction: initial;
        }
    }

    &__item {
        width: 100%;

        @media (min-width: 1199px) {
            margin-left: 5px;
            margin-right: 5px;
            width: initial;
        }

        &:not(:last-child) {
            margin-bottom: 20px;

            @media (min-width: 1199px) {
                margin-bottom: initial;
            }
        }
    }

    &__link {
        text-align: center;
        border-radius: 6px;
        padding: 6px 12px;
        display: block;
        font-size: 20px;
        color: var(--main-white);
        transition: color 0.3s, background-color 0.3s;

        @media (min-width: 1199px) {
            font-size: 12px;
            color: var(--label-secondary);
            background-color: var(--fill-tertiary);
        }

        @media (hover:hover) {
            &:hover {
                color: var(--accent-primary);
                background-color: var(--fill-secondary);
            }
        }
    }

    &__background {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        background-color: var(--menu-background);

        @media (min-width: 1199px) {
            display: none;
        }
    }
}
</style>