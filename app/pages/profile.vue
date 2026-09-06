<template>
    <div
        v-if="user.name"
        class="profile"
    >
        <!-- 3.1.5 : bannière e-mail non vérifié (comptes locaux). -->
        <VerifyEmailBanner />
        <MainTitle
            :label="user.name"
            class="profile__title"
        />
        <!-- 3.1.5 (A7) : badge de vérification e-mail à côté du nom. -->
        <span
            v-if="user.provider === 'local' ? user.emailVerified === true : true"
            class="profile__verified"
        >{{ t('verify.badge') }}</span>
        <div class="profile__content">
            <Avatar />
            <MainButton
                :theme="themeType.primary"
                trackingTag="logout"
                @click="logoutHandler"
                :label="t('nav.logout')"
                class="profile__btn"
            />
        </div>
        <UserStats class="profile__stats" />
        <Subscription />
        <PromoCodeSettings />
        <NewsletterSettings />
        <VaultSettings v-if="isStripFeatureEnable" />
        <DeleteAccount />
    </div>
</template>
<script setup>
    import { themeType } from '~~/constants/theme.constants'

    const router = useRouter()
    const { t } = useLocale()

    definePageMeta({
        layout: 'profile',
        middleware: 'auth',
    })

    const { getters, actions } = authStore
    const { logout } = actions
    const user = computed(() => getters.user)

    const isStripFeatureEnable = computed(() => {
        return Boolean(unref(getters.user)?.isStripFeatureEnable)
    })

    const logoutHandler = async () => {
        await logout()
        router.push({ path: '/' })
    }
</script>
<style lang="scss" scoped>
    .profile {
    &__verified {
        display: inline-block;
        margin: 2px 0 8px;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        color: var(--accent-primary);
        background-color: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    }

        &__title {
            margin-bottom: 16px;
        }

        &__content {
            display: flex;
            align-items: center;
        }

        &__btn {
            margin-left: 24px;
        }

        &__stats {
            margin-top: 24px;
            margin-bottom: 24px;
        }
    }
</style>
