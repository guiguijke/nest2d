<template>
    <div class="local-auth">
        <MainTitle :label="isRegister ? 'Create your account' : 'Login to your account'" class="local-auth__title" />
        <p class="local-auth__subtitle">
            {{ isRegister ? 'Sign up to start nesting your DXF files.' : 'Welcome back.' }}
        </p>

        <form class="local-auth__form" @submit.prevent="onSubmit">
            <InputField
                v-if="isRegister"
                v-model="name"
                type="text"
                placeholder="Your name"
                :is-error="!!fieldError"
                class="local-auth__field"
            />
            <InputField
                v-model="email"
                type="email"
                placeholder="Email"
                :is-error="!!fieldError"
                class="local-auth__field"
            />
            <InputField
                v-model="password"
                type="password"
                :placeholder="isRegister ? 'Password (min. 8 characters)' : 'Password'"
                :is-error="!!fieldError"
                class="local-auth__field"
            />

            <p v-if="fieldError" class="local-auth__error">{{ fieldError }}</p>

            <MainButton
                :theme="themeType.primary"
                :label="isRegister ? 'Sign up' : 'Login'"
                :isDisable="loading"
                trackingTag="local_auth_submit"
                tag="button"
                type="submit"
                class="local-auth__btn"
            />
        </form>

        <button class="local-auth__toggle" @click="toggleMode">
            {{ isRegister ? 'Already have an account? Login' : "Don't have an account? Sign up" }}
        </button>
        <NuxtLink v-if="!isRegister" to="/auth/forgot-password" class="local-auth__forgot">
            Forgot password?
        </NuxtLink>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { trackEvent } from '~~/utils/track'

definePageMeta({
    layout: 'doc',
})

const router = useRouter()
const config = useRuntimeConfig()

const isRegister = ref(true)
const name = ref('')
const email = ref('')
const password = ref('')
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
        await $fetch(`/api/auth/local/${isRegister.value ? 'register' : 'login'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                name: name.value,
                email: email.value,
                password: password.value,
            }),
        })
        router.push({ path: '/home' })
    } catch (err) {
        fieldError.value = err?.data?.statusMessage || err?.statusMessage || 'Something went wrong. Please try again.'
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
</style>
