<template>
    <div class="verify-email">
        <img src="/brand/n-mark.png" alt="NestorCut" class="verify-email__logo" />
        <MainTitle
            :label="isOk ? t('auth.verify.okTitle') : t('auth.verify.errTitle')"
            class="verify-email__title"
        />
        <p class="verify-email__text">
            {{ isOk ? t('auth.verify.okText') : t('auth.verify.errText') }}
        </p>
        <MainButton
            :theme="themeType.primary"
            :label="isOk ? t('auth.verify.cta') : t('auth.verify.errCta')"
            trackingTag="verify_email_cta"
            tag="a"
            :href="isOk ? '/home' : '/auth/check-email'"
            class="verify-email__btn"
        />
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'

definePageMeta({
    layout: 'doc',
})

const { t } = useLocale()
const route = useRoute()
const isOk = computed(() => route.query.status === 'ok')
</script>

<style lang="scss" scoped>
.verify-email {
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
}
</style>
