<template>
    <div class="local-auth">
        <MainTitle :label="isRegister ? t('auth.registerTitle') : t('auth.loginAccount')" class="local-auth__title" />
        <p class="local-auth__subtitle">
            {{ isRegister ? t('auth.signUpHint') : t('auth.welcomeBack') }}
        </p>

        <form class="local-auth__form" novalidate @submit.prevent="onSubmit">
            <InputField
                v-if="isRegister"
                v-model="name"
                type="text"
                id="local-auth-name"
                name="name"
                autocomplete="name"
                :placeholder="t('auth.namePlaceholder')"
                :is-error="!!nameError"
                :aria-invalid="nameError ? 'true' : undefined"
                aria-describedby="local-auth-name-error"
                class="local-auth__field"
            />
            <p v-if="nameError" id="local-auth-name-error" class="local-auth__fielderror">
                {{ nameError }}
            </p>
            <InputField
                v-model="email"
                type="email"
                id="local-auth-email"
                name="email"
                autocomplete="email"
                :placeholder="t('auth.email')"
                :is-error="!!emailError"
                :aria-invalid="emailError ? 'true' : undefined"
                aria-describedby="local-auth-email-error"
                class="local-auth__field"
            />
            <p v-if="emailError" id="local-auth-email-error" class="local-auth__fielderror">
                {{ emailError }}
            </p>
            <div class="local-auth__password">
                <InputField
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    id="local-auth-password"
                    name="password"
                    :autocomplete="isRegister ? 'new-password' : 'current-password'"
                    :placeholder="isRegister ? t('auth.passwordMinPlaceholder') : t('auth.passwordPlaceholder')"
                    :is-error="!!passwordError"
                    :aria-invalid="passwordError ? 'true' : undefined"
                    aria-describedby="local-auth-password-error"
                    class="local-auth__field"
                />
                <button
                    type="button"
                    class="local-auth__eye"
                    :aria-label="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
                    @click="showPassword = !showPassword"
                >
                    {{ showPassword ? '🙈' : '👁' }}
                </button>
            </div>
            <p v-if="passwordError" id="local-auth-password-error" class="local-auth__fielderror">
                {{ passwordError }}
            </p>

            <label v-if="isRegister" class="local-auth__optin optin">
                <input type="checkbox" v-model="newsletterOptIn" class="optin__checkbox" />
                <span class="optin__label">{{ t('auth.newsletterOptIn') }}</span>
            </label>

            <p v-if="fieldError" class="local-auth__error" role="alert">{{ fieldError }}</p>

            <MainButton
                :theme="themeType.primary"
                :label="isRegister ? t('auth.register') : t('auth.login')"
                :isDisable="loading"
                trackingTag="local_auth_submit"
                tag="button"
                type="submit"
                class="local-auth__btn"
            />
            <!-- 3.1.3 : mention CGU/confidentialité à l'inscription. -->
            <p v-if="isRegister" class="local-auth__legal">
                {{ t('auth.legalPrefix') }}
                <NuxtLink to="/terms-and-conditions" class="local-auth__legal-link">{{ t('auth.legalTerms') }}</NuxtLink>
                {{ t('auth.legalAnd') }}
                <NuxtLink to="/privacy" class="local-auth__legal-link">{{ t('auth.legalPrivacy') }}</NuxtLink>.
            </p>
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
const nameError = ref('')
const emailError = ref('')
const passwordError = ref('')
const showPassword = ref(false)
const loading = ref(false)

const toggleMode = () => {
    isRegister.value = !isRegister.value
    fieldError.value = ''
    nameError.value = ''
    emailError.value = ''
    passwordError.value = ''
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 3.1.3 (lot 3) : validation côté client, erreur ciblée SUR LE CHAMP —
// le message anglais brut du serveur ne s'affiche plus tel quel.
const validateForm = () => {
    nameError.value = ''
    emailError.value = ''
    passwordError.value = ''
    if (isRegister.value && !name.value.trim()) {
        nameError.value = t('auth.error.name_required')
    }
    if (!EMAIL_RE.test(email.value.trim())) {
        emailError.value = t('auth.error.invalid_email')
    }
    if (isRegister.value && password.value.length < 8) {
        passwordError.value = t('auth.error.password_too_short')
    } else if (!isRegister.value && !password.value) {
        passwordError.value = t('auth.error.password_required')
    }
    return !nameError.value && !emailError.value && !passwordError.value
}

// 3.1.3 : codes d'erreur STABLES du serveur → clés i18n.
const SERVER_ERROR_KEYS = {
    invalid_email: { key: 'auth.error.invalid_email', field: 'email' },
    name_required: { key: 'auth.error.name_required', field: 'name' },
    password_too_short: { key: 'auth.error.password_too_short', field: 'password' },
    email_taken: { key: 'auth.error.email_taken', field: 'email' },
    invalid_credentials: { key: 'auth.error.invalid_credentials' },
    account_suspended: { key: 'auth.error.account_suspended' },
    fields_required: { key: 'auth.error.fields_required' },
    auth_disabled: { key: 'auth.error.auth_disabled' },
}
const mapServerError = (err) => {
    // A2 (audit compte 2026-09-05) : le 429 rate-limit porte un code
    // stable + le délai réel — message traduit avec les minutes.
    if (err?.data?.code === 'rate_limited') {
        const min = Math.max(1, Math.ceil((err?.data?.retryAfterSec || 900) / 60))
        return { text: t('auth.rateLimited', { n: min }) }
    }
    const mapped = err?.data?.code ? SERVER_ERROR_KEYS[err.data.code] : null
    if (mapped) return { text: t(mapped.key), field: mapped.field }
    return { text: t('auth.errorGeneric') }
}

const onSubmit = async () => {
    fieldError.value = ''
    if (!validateForm()) return
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
        const mapped = mapServerError(err)
        if (mapped.field === 'email') emailError.value = mapped.text
        else if (mapped.field === 'password') passwordError.value = mapped.text
        else if (mapped.field === 'name') nameError.value = mapped.text
        else fieldError.value = mapped.text
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
        color: var(--error-text, #ef4444);
        font-size: 14px;
        margin: 4px 0;
    }

    // 3.1.3 : erreur ciblée sous SON champ (aria-describedby pointe ici).
    &__fielderror {
        color: var(--error-text, #ef4444);
        font-size: 12.5px;
        margin: -4px 0 4px;
        text-align: left;
        width: 100%;
    }

    &__password {
        position: relative;
        width: 100%;
    }

    &__eye {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        border: none;
        background: none;
        cursor: pointer;
        font-size: 15px;
        padding: 4px;
        line-height: 1;
    }

    &__legal {
        font-size: 12px;
        color: var(--label-tertiary);
        margin: 6px 0 0;
        line-height: 1.5;
    }

    &__legal-link {
        color: var(--accent-primary);
        text-decoration: underline;
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
