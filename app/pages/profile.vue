<template>
    <div
        v-if="user.name"
        class="profile"
    >
        <MainTitle
            :label="user.name"
            class="profile__title"
        />
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
        <VaultSettings v-if="isStripFeatureEnable" />
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
