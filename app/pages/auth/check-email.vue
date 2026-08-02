<template>
    <div class="check-email">
        <img src="/brand/n-mark.png" alt="NestorCut" class="check-email__logo" />
        <MainTitle :label="t('auth.checkEmail.title')" class="check-email__title" />
        <p class="check-email__text">
            {{ t('auth.checkEmail.text') }}
        </p>
        <MainButton
            :theme="themeType.primary"
            :label="resent ? t('auth.checkEmail.resent') : t('auth.checkEmail.resend')"
            :isDisable="resent || loading"
            trackingTag="resend_verification"
            @click="resend"
            class="check-email__btn"
        />
        <NuxtLink to="/home" class="check-email__skip">
            {{ t('auth.checkEmail.skip') }}
        </NuxtLink>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'

definePageMeta({
    layout: 'doc',
    middleware: 'auth',
})

const { t } = useLocale()
const resent = ref(false)
const loading = ref(false)

const resend = async () => {
    loading.value = true
    try {
        await $fetch('/api/auth/local/resend-verification', {
            method: 'POST',
            credentials: 'include',
        })
        resent.value = true
    } catch {
        // Silently ignore — the user can retry.
    } finally {
        loading.value = false
    }
}
</script>

<style lang="scss" scoped>
.check-email {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 24px;
    max-width: 420px;
    margin: 0 auto;
    text-align: center;

    &__logo {
        width: 56px;
        height: 56px;
        border-radius: 4px;
        margin-bottom: 16px;
    }

    &__text {
        margin-top: 8px;
        color: var(--label-secondary);
        line-height: 1.6;
    }

    &__btn {
        margin-top: 24px;
    }

    &__skip {
        margin-top: 16px;
        color: var(--label-tertiary);
        font-size: 13px;
        text-decoration: underline;
    }
}
</style>
