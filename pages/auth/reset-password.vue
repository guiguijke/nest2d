<template>
    <div class="reset-password">
        <MainTitle label="Choose a new password" class="reset-password__title" />

        <template v-if="!token">
            <p class="reset-password__subtitle">
                This reset link is invalid. Please request a new one.
            </p>
        </template>

        <template v-else-if="!done">
            <form class="reset-password__form" @submit.prevent="onSubmit">
                <InputField
                    v-model="password"
                    type="password"
                    placeholder="New password (min. 8 characters)"
                    :is-error="!!fieldError"
                    class="reset-password__field"
                />
                <InputField
                    v-model="passwordConfirm"
                    type="password"
                    placeholder="Confirm new password"
                    :is-error="!!fieldError"
                    class="reset-password__field"
                />

                <p v-if="fieldError" class="reset-password__error">{{ fieldError }}</p>

                <MainButton
                    :theme="themeType.primary"
                    label="Reset password"
                    :isDisable="loading"
                    trackingTag="reset_password_submit"
                    tag="button"
                    type="submit"
                    class="reset-password__btn"
                />
            </form>
        </template>

        <p v-else class="reset-password__success">
            Your password has been updated. You can now log in with your new password.
        </p>

        <NuxtLink to="/auth/local" class="reset-password__back">
            Go to login
        </NuxtLink>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { trackEvent } from '~~/utils/track'

definePageMeta({
    layout: 'doc',
})

const route = useRoute()
const token = computed(() => String(route.query.token || ''))

const password = ref('')
const passwordConfirm = ref('')
const fieldError = ref('')
const loading = ref(false)
const done = ref(false)

const onSubmit = async () => {
    fieldError.value = ''
    if (password.value !== passwordConfirm.value) {
        fieldError.value = 'Passwords do not match'
        return
    }
    loading.value = true
    trackEvent('click_reset_password', { page: 'reset_password' })
    try {
        await $fetch('/api/auth/local/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.value, password: password.value }),
        })
        done.value = true
    } catch (err) {
        fieldError.value = err?.data?.statusMessage || err?.statusMessage || 'Something went wrong. Please try again.'
    } finally {
        loading.value = false
    }
}
</script>

<style lang="scss" scoped>
.reset-password {
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
