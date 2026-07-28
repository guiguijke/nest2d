<template>
    <div class="main">
        <MainHeader
            :theme="themeType.primary"
            class="main__header"
        />
        <main class="main__content content">
            <StripProjects class="content__projects" />
            <slot />
            <StripResults class="content__results" />
        </main>
        <Footer />
        <BuyCreditsDialog v-model:isModalOpen="buyCreditsDialog" />
        <VaultUnlock v-if="vaultLocked" />
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants';
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
</script>
<style lang="scss" scoped>
.main {
    background-color: var(--background-primary);
    flex-direction: column;
    display: flex;
    min-height: 100vh;

    &__header {
        margin-left: auto;
        margin-right: auto;
        max-width: 1300px;
        width: 100%;
    }
    &__content {
        flex-grow: 1;
        margin: 40px auto;
        max-width: 1300px;
        width: 100%;
    }
}
.content {
    padding-left: 10px;
    padding-right: 10px;
    display: grid;
    grid-template-columns: 1fr 640px 1fr;
    gap: 40px;
}
</style>
