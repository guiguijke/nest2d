<template>
    <div class="welcome">
        <div class="welcome__card card">
            <img src="/brand/n-mark.png" alt="NestorCut" class="card__logo" />
            <MainTitle :label="t('auth.loginAccount')" class="card__title" />
            <p class="card__tagline">{{ t('auth.tagline') }}</p>
            <p class="card__hint">{{ t('auth.demoHint') }}</p>
            <div v-if="googleEnabled" class="card__item">
                <MainButton
                    :theme="themeType.secondary"
                    trackingTag="login_google"
                    @click="doAuth('google')"
                    :label="t('auth.loginGoogle')"
                />
            </div>
            <template v-if="localAuthEnabled">
                <div v-if="googleEnabled" class="card__divider">
                    <span>{{ t('auth.or') }}</span>
                </div>
                <MainButton
                    :theme="themeType.primary"
                    trackingTag="login_email"
                    tag="a"
                    href="/auth/local"
                    :label="t('auth.loginEmail')"
                />
            </template>
        </div>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'

// The marketing site lives at nestorcut.com — the app root is only an entry
// point: signed-in users go straight to their workspace, everyone else gets
// the sign-in screen.
definePageMeta({
    middleware: 'auth'
})

const { getters } = authStore
const { userIsSet } = toRefs(getters)

if (unref(userIsSet)) {
    await navigateTo('/home')
}

const { t } = useLocale()

const config = useRuntimeConfig()
const localAuthEnabled = computed(() => config.public.localAuthEnabled !== false && config.public.localAuthEnabled !== 'false')
const googleEnabled = computed(() => Boolean(config.public.googleClientId))

const doAuth = async (provider) => {
    const response = await $fetch(API_ROUTES.AUTH(provider), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    })
    navigateTo(response.url, { external: true })
}

onMounted(() => {
    trackEvent('page_view', { page: 'signin' })
})
</script>

<style lang="scss" scoped>
.welcome {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    padding: 24px;

    &__card {
        width: 100%;
        max-width: 380px;
    }
}

.card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 40px 32px;
    background: var(--main-white);
    border: 1px solid var(--separator-secondary);
    border-radius: 8px;

    &__logo {
        width: 56px;
        height: 56px;
        border-radius: 4px;
        margin-bottom: 4px;
    }

    &__title {
        text-align: center;
        margin-bottom: 4px;
    }

    &__tagline {
        text-align: center;
        color: #4a5568;
        font-size: 14px;
        line-height: 1.45;
        margin: 0;
        max-width: 28rem;
    }

    &__hint {
        text-align: center;
        color: #6b7280;
        font-size: 13px;
        line-height: 1.45;
        margin: 0 0 8px;
        max-width: 28rem;
    }

    &__item {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    &__divider {
        color: var(--label-secondary);
        font-size: 13px;
    }
}
</style>
