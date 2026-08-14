<template>
    <div class="main">
        <MainHeader
            :theme="themeType.primary"
            class="main__header"
        />
        <main class="main__content content">
            <div class="content__controls controls">
                <div :class="{'controls__bg--open': projectsIsOpen || resultsIsOpen}" @click="close" class="controls__bg"></div>
                <MainButton
                    @click="openProjects"
                    trackingTag="open_projects"
                    class="controls__btn controls__btn--projects"
                    :theme="themeType.secondary"
                    :label="t('common.openProjects')"
                />
                <MainButton
                    @click="openResults"
                    trackingTag="open_results"
                    class="controls__btn controls__btn--results"
                    :theme="themeType.secondary"
                    :label="isHomePage ? t('common.openAllResults') : t('common.openResults')"
                />
            </div>
            <UserProjects @closeAside="close" :class="{'content__projects--open': projectsIsOpen}" class="content__projects"/>
            <slot />
            <UserResults @closeAside="close" :class="{'content__results--open': resultsIsOpen}" class="content__results" />
        </main>
        <ChatSupport v-if="supportDialog" />
        <button
            v-if="!supportDialog"
            type="button"
            class="main__btn btn"
            @click="supportDialog = true"
        >
            <span class="btn__label">{{ t('common.support') }}</span>
        </button>
        <Footer />
        <BuyCreditsDialog v-model:isModalOpen="buyCreditsDialog" />
        <VaultUnlock v-if="vaultLocked" />
    </div>
</template>
<script setup>
import { themeType } from '~~/constants/theme.constants';
const route = useRoute()
const { t } = useLocale()
const supportDialog = useSupportDialog();
const buyCreditsDialog = useBuyCreditsDialog();
const vaultUnlockDialog = useVaultUnlockDialog();

// Auto-open the unlock modal whenever the vault is enabled but locked
// (e.g. after the 2h session TTL expired or on a fresh browser).
const { getters: authGetters } = authStore;
const vaultLocked = computed(() => {
    const encryption = unref(authGetters.user)?.encryption;
    return Boolean(encryption?.enabled && encryption?.locked);
});
watch(vaultLocked, (locked) => {
    if (locked) vaultUnlockDialog.value = true;
}, { immediate: true });

// Orange "secure environment" border around the whole screen while the user
// is actively working inside an unlocked vault. Toggled via a reactive
// htmlAttrs so it is SSR-friendly and auto-syncs when the lock state changes.
const vaultActive = computed(() => {
    const encryption = unref(authGetters.user)?.encryption;
    return Boolean(encryption?.enabled && !encryption?.locked);
});
useHead({
    htmlAttrs: {
        'data-vault-active': computed(() => (vaultActive.value ? 'true' : null)),
    },
});
const projectsIsOpen = ref(false);
const resultsIsOpen = ref(false);
const openProjects = () => {
    projectsIsOpen.value = true;
}
const openResults = () => {
    resultsIsOpen.value = true;
}
const close = () => {
    projectsIsOpen.value = false;
    resultsIsOpen.value = false;
}
const isHomePage = computed(() => {
    return route.path === '/home'
})
</script>
<style lang="scss" scoped>
.main {
    overflow: hidden;
    background-color: var(--background-primary);
    flex-direction: column;
    display: flex;
    min-height: 100vh;

    &__header {
        margin-left: auto;
        margin-right: auto;
        max-width: 1760px;
        width: 100%;
    }
    &__content {
        flex-grow: 1;
        margin: 24px auto;
        max-width: 1760px;
        width: 100%;
    }
    &__line {
        position: relative;
        z-index: 2;
    }
    &__btn {
        position: fixed;
        bottom: 120px;
        right: 40px;
        z-index: 3;

        @media (min-width: 1199px) {
            bottom: 60px;
            right: 60px;
        }
    }
}
.content {
    padding-left: 10px;
    padding-right: 10px;
    position: relative;
    
    @media (min-width: 1319px) {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 260px;
        gap: 28px;
        align-items: start;
    }

    &__controls {
        margin-bottom: 16px;
    }
    &__projects {
        z-index: 4;
        position: absolute;
        left: 0;
        top: 0;
        width: 280px;
        transform: translateX(-200%);
        transition: transform 0.3s ease;

        @media (min-width: 1319px) {
            position: initial;
            left: initial;
            top: initial;
            width: initial;
            transform: initial;
        }

        &--open {
            transform: translateX(10px);

            @media (min-width: 1319px) {
                transform: initial;
            }
        }

        &::after {
            z-index: -1;
            content: '';
            position: absolute;
            top: -10px;
            left: -10px;
            right: -10px;
            bottom: -10px;
            border-radius: 0 10px 10px 0;
            background-color: var(--background-primary);

            @media (min-width: 1319px) {
                display: none;
            }
        }
    }
    &__results {
        z-index: 4;
        top: 0;
        right: 0;
        position: absolute;
        width: 280px;
        transform: translateX(200%);
        transition: transform 0.3s ease;

        @media (min-width: 1319px) {
            position: initial;
            right: initial;
            top: initial;
            width: initial;
            transform: initial;
        }

        &--open {
            transform: translateX(-10px);

            @media (min-width: 1319px) {
                transform: initial;
            }
        }

        &::after {
            z-index: -1;
            content: '';
            position: absolute;
            top: -10px;
            left: -10px;
            right: -10px;
            bottom: -10px;
            border-radius: 10px 0 0 10px;
            background-color: var(--background-primary);

            @media (min-width: 1319px) {
                display: none;
            }
        }
    }
}
.controls {
    display: flex;
    justify-content: space-between;

    @media (min-width: 1319px) {
        display: none;
    }

    &__bg {
        z-index: 4;    
        position: fixed;
        top: 0;
        height: 100vh;
        left: 0;
        width: 100vw;
        background-color: var(--label-tertiary);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;

        &--open {
            opacity: 1;
            pointer-events: all;
        }
    }
}
.btn {
    display: flex;
    align-items: center;
    border-radius: 999px;
    padding: 8px 16px;
    transition: opacity 0.2s, box-shadow 0.2s;
    width: max-content;
    background-color: var(--background-secondary);
    box-shadow: 0 2px 10px color-mix(in srgb, var(--label-primary) 18%, transparent);

    &__label {
        color: var(--background-primary);
        display: block;
        font-size: 13px;
        font-weight: 700;
    }

    @media (hover:hover) {
        &:hover {
            opacity: 0.88;
        }
    }
}
</style>