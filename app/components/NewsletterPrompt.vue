<template>
    <DialogWrapper v-model:isModalOpen="isOpen" trackingTag="newsletter_prompt">
        <div class="prompt">
            <MainTitle :label="t('newsletter.promptTitle')" class="prompt__title" />
            <p class="prompt__text">
                {{ t('newsletter.promptText') }}
            </p>
            <div class="prompt__actions">
                <MainButton
                    :theme="themeType.primary"
                    :label="t('newsletter.yes')"
                    trackingTag="newsletter_prompt_yes"
                    @click="answer(true)"
                />
                <MainButton
                    :theme="themeType.secondary"
                    :label="t('newsletter.no')"
                    trackingTag="newsletter_prompt_no"
                    @click="answer(false)"
                />
            </div>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'

// One-time newsletter prompt shown to users who never answered (Google
// signups don't see the local-form checkbox). The PATCH writes true OR
// false — either way the field is set and the prompt never shows again.
const { t } = useLocale()
const { getters } = authStore

// Closing without answering (X) dismisses for the session only — the field
// stays null and the prompt will gently reappear at the next login.
const dismissed = ref(false)

const isOpen = computed({
    get: () => !unref(dismissed) && unref(getters.userIsSet) && unref(getters.user)?.newsletterOptIn == null,
    set: (v) => {
        if (!v) dismissed.value = true
    },
})

const answer = async (value) => {
    try {
        await $fetch('/api/user/preferences', {
            method: 'PATCH',
            credentials: 'include',
            body: { newsletterOptIn: value },
        })
        // setUser() reads the useAsyncData('user') cache — refresh it first,
        // otherwise the modal sees the stale null opt-in and stays open.
        await refreshNuxtData('user')
    } catch {
        // Even on failure, don't pester the user again this session.
    } finally {
        await authStore.actions.setUser()
    }
}
</script>

<style lang="scss" scoped>
.prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 28px 28px;
    max-width: 380px;
    text-align: center;

    &__text {
        margin-top: 8px;
        color: var(--label-secondary);
        font-size: 14px;
        line-height: 1.6;
    }

    &__actions {
        display: flex;
        gap: 12px;
        margin-top: 24px;
    }
}
</style>
