<template>
    <!-- 3.1.5 (lot 3, A6/A7) : bannière persistante « e-mail non vérifié » —
         les comptes locaux doivent cliquer le lien avant de nester. -->
    <div v-if="visible" class="verify-banner" role="status" data-testid="verify-banner">
        <p class="verify-banner__text">
            {{ t('verify.banner', { email: user.email || '' }) }}
        </p>
        <button
            type="button"
            class="verify-banner__resend"
            :disabled="resent || sending"
            data-testid="verify-banner-resend"
            @click="resend"
        >
            {{ resent ? t('verify.bannerResent') : t('verify.bannerResend') }}
        </button>
    </div>
</template>

<script setup>
const { t } = useLocale()
const { getters } = authStore

const user = computed(() => unref(getters.user) || {})
const visible = computed(() =>
    user.value.provider === 'local' && user.value.emailVerified === false)

const resent = ref(false)
const sending = ref(false)
const resend = async () => {
    if (sending.value || resent.value) return
    sending.value = true
    try {
        await $fetch('/api/auth/local/resend-verification', { method: 'POST' })
        resent.value = true
    } catch {
        // Best-effort : rate-limit 10/h — le lien check-email reste l'autre
        // voie (aucune erreur crue affichée dans la bannière).
    } finally {
        sending.value = false
    }
}
</script>

<style lang="scss" scoped>
.verify-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 10px 14px;
    margin-bottom: 14px;
    border: 1px solid var(--warning, #d97706);
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--warning, #d97706) 8%, transparent);

    &__text {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.45;
        color: var(--label-primary);
        flex: 1 1 320px;
    }

    &__resend {
        border: 1px solid var(--warning, #d97706);
        border-radius: 8px;
        background: transparent;
        color: var(--label-primary);
        font-size: 13px;
        font-weight: 600;
        padding: 7px 12px;
        cursor: pointer;

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }
}
</style>
