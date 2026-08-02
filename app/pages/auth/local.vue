<template>
    <div class="local-auth">
        <MainTitle :label="isRegister ? t('auth.registerTitle') : t('auth.loginAccount')" class="local-auth__title" />
        <p class="local-auth__subtitle">
            {{ isRegister ? t('auth.signUpHint') : t('auth.welcomeBack') }}
        </p>

        <form class="local-auth__form" @submit.prevent="onSubmit">
            <InputField
                v-if="isRegister"
                v-model="name"
                type="text"
                :placeholder="t('auth.namePlaceholder')"
                :is-error="!!fieldError"
                class="local-auth__field"
            />
            <InputField
                v-model="email"
                type="email"
                :placeholder="t('auth.email')"
                :is-error="!!fieldError"
                class="local-auth__field"
            />
            <InputField
                v-model="password"
                type="password"
                :placeholder="isRegister ? t('auth.passwordMinPlaceholder') : t('auth.passwordPlaceholder')"
                :is-error="!!fieldError"
                class="local-auth__field"
            />

            <label v-if="isRegister" class="local-auth__optin optin">
                <input type="checkbox" v-model="newsletterOptIn" class="optin__checkbox" />
                <span class="optin__label">{{ t('auth.newsletterOptIn') }}</span>
            </label>

            <p v-if="fieldError" class="local-auth__error">{{ fieldError }}</p>

            <MainButton
                :theme="themeType.primary"
                :label="isRegister ? t('auth.register') : t('auth.login')"
                :isDisable="loading"
                trackingTag="local_auth_submit"
                tag="button"
                type="submit"
                class="local-auth__btn"
            />
        </form>

        <button class="local-auth__toggle" @click="toggleMode">
            {{ isRegister ? t('auth.toggleToLogin') : t('auth.toggleToRegister') }}
        </button>
        <NuxtLink v-if="!isRegister" to="/auth/forgot-password" class="local-auth__forgot">
            {{ t('auth.forgotPassword') }}
        </NuxtLink>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { trackEvent } from '~/utils/track'

const { t } = useLocale()

definePageMeta({
    layout: 'doc',
})

const router = useRouter()
const config = useRuntimeConfig()

const isRegister = ref(true)
const name = ref('')
const email = ref('')
const password = ref('')
const newsletterOptIn = ref(false)
const fieldError = ref('')
const loading = ref(false)

const toggleMode = () => {
    isRegister.value = !isRegister.value
    fieldError.value = ''
}

const onSubmit = async () => {
    fieldError.value = ''
    loading.value = true
    trackEvent(isRegister.value ? 'click_local_register' : 'click_local_login', { page: 'local_auth' })
    try {
        const response = await $fetch(`/api/auth/local/${isRegister.value ? 'register' : 'login'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                name: name.value,
                email: email.value,
                password: password.value,
                newsletterOptIn: isRegister.value ? newsletterOptIn.value : undefined,
            }),
        })
        // New local accounts must confirm their email before nesting.
        if (isRegister.value && response?.needsVerification) {
            router.push({ path: '/auth/check-email' })
            return
        }
        router.push({ path: '/home' })
    } catch (err) {
        fieldError.value = err?.data?.statusMessage || err?.statusMessage || t('auth.errorGeneric')
    } finally {
        loading.value = false
    }
}

// Redirect already-authenticated users away from the auth page.
onMounted(async () => {
    const { getters, actions } = authStore
    await actions.setUser()
    if (getters.userIsSet) {
        router.push({ path: '/home' })
    }
})
</script>

<style lang="scss" scoped>
.local-auth {
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
    &__toggle {
        margin-top: 24px;
        background: none;
        border: none;
        color: var(--accent-primary);
        cursor: pointer;
        font-size: 14px;
        text-decoration: underline;

        @media (hover:hover) {
            &:hover {
                opacity: 0.8;
            }
        }
    }
    &__forgot {
        margin-top: 12px;
        color: var(--label-secondary);
        font-size: 14px;
        text-decoration: underline;

        @media (hover:hover) {
            &:hover {
                color: var(--accent-primary);
            }
        }
    }
}

.optin {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    text-align: left;

    &__checkbox {
        margin-top: 3px;
        width: 16px;
        height: 16px;
        accent-color: var(--accent-primary);
        cursor: pointer;
        flex-shrink: 0;
    }

    &__label {
        font-size: 13px;
        color: var(--label-secondary);
        line-height: 1.4;
    }
}
</style>
