<template>
    <div class="main">
        <MainHeader
            :theme="themeType.primary"
            class="main__header"
        />
        <main class="main__content content">
            <slot />
        </main>
        <Footer />
        <!-- Le dialogue global d'unlock du vault manquait ici : le bouton
             « Déverrouiller » (menu vault ou profil) ouvrait un état partagé
             sans rendu sur /profile. -->
        <VaultUnlock v-if="vaultLocked" />
    </div>
</template>
<script setup>
import { themeType } from '~~/constants/theme.constants';

const vaultUnlockDialog = useVaultUnlockDialog();
// Même auto-open que layouts/auth.vue : vault activé mais verrouillé ⇒ la
// modale s'ouvre (session 2 h expirée, navigateur frais).
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
        max-width: 660px;
        width: 100%;
    }
    &__line {
        position: relative;
        z-index: 2;
    }
}
.content {
    padding-left: 10px;
    padding-right: 10px;
}
</style>