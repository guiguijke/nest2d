<template>
    <DialogWrapper v-model:isModalOpen="modelValue" trackingTag="login">
        <div class="modal">
            <MainTitle
                label="Login to your account"
                class="modal__title"
            />
            <div v-if="googleEnabled" class="modal__item item">
                <img
                    src="/google-logo.svg"
                    loading="lazy"
                    alt="google logo"
                    class="item__img"
                />
                <MainButton
                    :theme="themeType.secondary"
                    trackingTag="login_google"
                    @click="doAuth('google')"
                    label="Login with Google"
                />
            </div>
            <template v-if="localAuthEnabled">
                <div v-if="googleEnabled" class="modal__divider">
                    <span>or</span>
                </div>
                <MainButton
                    :theme="themeType.primary"
                    trackingTag="login_email"
                    tag="a"
                    href="/auth/local"
                    label="Login with email"
                    class="modal__email"
                />
            </template>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { themeType } from "~~/constants/theme.constants";

const modelValue = useLoginDialog()

const config = useRuntimeConfig()
const localAuthEnabled = computed(() => config.public.localAuthEnabled !== false && config.public.localAuthEnabled !== 'false')
const googleEnabled = computed(() => Boolean(config.public.googleClientId))

const doAuth = async (provider) => {
    const response = await $fetch(API_ROUTES.AUTH(provider), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    navigateTo(response.url, { external: true });
}
</script>
<style lang="scss" scoped>
.modal {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 24px;
    min-width: 280px;

    &__title {
        text-align: center;
    }
    &__item {
        margin-top: 14px;
    }
    &__divider {
        margin: 20px 0 8px;
        color: var(--label-secondary);
        font-size: 13px;
        position: relative;
        width: 100%;
        text-align: center;

        &::before,
        &::after {
            content: '';
            position: absolute;
            top: 50%;
            width: calc(50% - 24px);
            height: 1px;
            background-color: var(--separator-secondary);
        }
        &::before { left: 0; }
        &::after { right: 0; }
    }
    &__email {
        width: 100%;
    }
}
.item {
    display: flex;
    align-items: center;
    &__img {
        margin-right: 10px;
        width: 24px;
        height: auto;
    }
}
</style>
