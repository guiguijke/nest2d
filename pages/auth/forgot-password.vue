<template>
    <div class="forgot-password">
        <MainTitle label="Reset your password" class="forgot-password__title" />
        <p class="forgot-password__subtitle">
            Enter your account email and we will send you a reset link.
        </p>

        <template v-if="!sent">
            <form class="forgot-password__form" @submit.prevent="onSubmit">
                <InputField
                    v-model="email"
                    type="email"
                    placeholder="Email"
                    :is-error="!!fieldError"
                    class="forgot-password__field"
                />

                <p v-if="fieldError" class="forgot-password__error">{{ fieldError }}</p>

                <MainButton
                    :theme="themeType.primary"
                    label="Send reset link"
                    :isDisable="loading"
                    trackingTag="forgot_password_submit"
                    tag="button"
                    type="submit"
                    class="forgot-password__btn"
                />
            </form>
        </template>
        <p v-else class="forgot-password__success">
            If an account exists for this email, a reset link is on its way.
            Check your inbox (and spam folder).
        </p>

        <NuxtLink to="/auth/local" class="forgot-password__back">
            Back to login
        </NuxtLink>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { trackEvent } from '~~/utils/track'

definePageMeta({
    layout: 'doc',
})

const email = ref('')
const fieldError = ref('')
const loading = ref(false)
const sent = ref(false)

const onSubmit = async () => {
    fieldError.value = ''
    loading.value = true
    trackEvent('click_forgot_password', { page: 'forgot_password' })
    try {
        await $fetch('/api/auth/local/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.value }),
        })
        sent.value = true
    } catch (err) {
        fieldError.value = err?.data?.statusMessage || err?.statusMessage || 'Something went wrong. Please try again.'
    } finally {
        loading.value = false
    }
}
</script>

<style lang="scss" scoped>
.forgot-password {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 24px;
    max-width: 380px;
    margin: 0 auto;

    &__title {
        text-align: center;
    }
    &__subtitle {
        margin-top: 8px;
        color: var(--label-secondary);
        text-align: center;
    }
    &__form {
        width: 100%;
        margin-top: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    &__field {
        width: 100%;
    }
    &__error {
        color: var(--error-border, #ef4444);
        font-size: 14px;
        margin: 4px 0;
    }
    &__btn {
        margin-top: 8px;
        width: 100%;
    }
    &__success {
        margin-top: 24px;
        color: var(--label-secondary);
        text-align: center;
    }
    &__back {
        margin-top: 24px;
        color: var(--accent-primary);
        font-size: 14px;
        text-decoration: underline;

        @media (hover:hover) {
            &:hover {
                opacity: 0.8;
            }
        }
    }
}
</style>
