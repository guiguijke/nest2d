<template>
    <div class="newsletter">
        <MainTitle :label="t('newsletter.title')" class="newsletter__title" />
        <p class="newsletter__desc">
            {{ t('newsletter.desc') }}
        </p>
        <label class="newsletter__optin optin">
            <input
                type="checkbox"
                :checked="optIn"
                @change="toggle"
                :disabled="loading"
                class="optin__checkbox"
            />
            <span class="optin__label">{{ t('newsletter.toggle') }}</span>
        </label>
        <p v-if="saved" class="newsletter__saved">
            {{ optIn ? t('newsletter.subscribed') : t('newsletter.notSubscribed') }}
        </p>
    </div>
</template>

<script setup>
const { t } = useLocale()

const { getters } = authStore
const optIn = computed(() => getters.user?.newsletterOptIn === true)
const loading = ref(false)
const saved = ref(false)

const toggle = async (event) => {
    const value = event.target.checked
    loading.value = true
    try {
        await $fetch('/api/user/preferences', {
            method: 'PATCH',
            credentials: 'include',
            body: { newsletterOptIn: value },
        })
        // Sync the local auth store so the UI reflects the new state
        // (setUser() reads the useAsyncData('user') cache — refresh it first).
        await refreshNuxtData('user')
        await authStore.actions.setUser()
        saved.value = true
        setTimeout(() => (saved.value = false), 3000)
    } catch {
        event.target.checked = !value
    } finally {
        loading.value = false
    }
}
</script>

<style lang="scss" scoped>
.newsletter {
    margin-top: 24px;
    padding: 20px;
    border: 1px solid var(--separator-secondary);
    border-radius: 14px;

    &__title {
        font-size: 18px;
    }

    &__desc {
        margin: 8px 0 16px;
        color: var(--label-secondary);
        font-size: 14px;
        line-height: 1.5;
    }

    &__saved {
        margin-top: 10px;
        color: var(--accent-primary);
        font-size: 13px;
        font-weight: 600;
    }
}

.optin {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;

    &__checkbox {
        margin-top: 3px;
        width: 16px;
        height: 16px;
        accent-color: var(--accent-primary);
        cursor: pointer;
        flex-shrink: 0;
    }

    &__label {
        font-size: 14px;
        color: var(--label-primary);
        line-height: 1.4;
    }
}
</style>
