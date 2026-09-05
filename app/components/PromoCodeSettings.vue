<template>
    <div class="promo">
        <MainTitle
            :label="t('account.promo.label')"
            class="promo__title"
        />
        <template v-if="activePromo">
            <p class="promo__desc">
                {{ t('account.promo.active', { code: activePromo.code, n: activePromo.freeNestingLimit }) }}
                <template v-if="activePromo.expiresAt">
                    {{ t('account.promo.until', { date: fmtDate(activePromo.expiresAt) }) }}
                </template>
            </p>
        </template>
        <template v-else>
            <p
                v-if="endedPromo"
                class="promo__desc"
            >
                {{
                    t('account.promo.ended', {
                        code: endedPromo.code,
                        date: fmtDate(endedPromo.expiresAt),
                        n: FREE_NESTING_LIMIT,
                    })
                }}
            </p>
            <p
                v-else
                class="promo__desc"
            >
                {{ t('account.promo.desc') }}
            </p>
            <form
                class="promo__form"
                @submit.prevent="apply"
            >
                <InputField
                    v-model="code"
                    type="text"
                    :placeholder="t('account.promo.placeholder')"
                    :is-error="!!error"
                    :is-disable="loading"
                    class="promo__input"
                />
                <MainButton
                    :label="t('account.promo.apply')"
                    type="submit"
                    :is-disable="loading"
                />
            </form>
        </template>
        <p
            v-if="error"
            class="promo__error"
        >
            {{ error }}
        </p>
        <p
            v-if="notice"
            class="promo__notice"
        >
            {{ notice }}
        </p>
    </div>
</template>

<script setup>
    import { FREE_NESTING_LIMIT } from '~~/shared/constants/payment.constants'

    const { t, locale } = useLocale()

    const { getters } = authStore
    const promo = computed(() => unref(getters.user)?.promo || null)
    // The server computes promo.active from the snapshotted campaign end date.
    // An expired promo shows the form again — the user may redeem a new code.
    const activePromo = computed(() => (promo.value?.active ? promo.value : null))
    const endedPromo = computed(() => (promo.value && !promo.value.active ? promo.value : null))

    const fmtDate = (d) =>
        new Date(d).toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        })

    const code = ref('')
    const loading = ref(false)
    const error = ref('')
    const notice = ref('')

    const apply = async () => {
        error.value = ''
        notice.value = ''
        loading.value = true
        try {
            const res = await $fetch(API_ROUTES.USER_PROMO_REDEEM, {
                method: 'POST',
                credentials: 'include',
                body: { code: code.value },
            })
            notice.value = t('account.promo.success', { code: res.code, n: res.freeNestingLimit })
            code.value = ''
            // Sync the local auth store so the UI reflects the new quota
            // (setUser() reads the useAsyncData('user') cache — refresh it first).
            await refreshNuxtData('user')
            await authStore.actions.setUser()
        } catch (err) {
            const status = err?.data?.statusMessage
            if (status === 'promo_already') {
                error.value = t('account.promo.already')
            } else if (status === 'promo_expired') {
                error.value = t('account.promo.expired')
            } else if (status === 'promo_maxed') {
                error.value = t('account.promo.maxed')
            } else if (status === 'promo_invalid') {
                error.value = t('account.promo.invalid')
            } else {
                error.value = t('account.promo.generic')
            }
        } finally {
            loading.value = false
        }
    }
</script>

<style lang="scss" scoped>
    .promo {
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

        &__form {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }

        &__input {
            max-width: 220px;
            text-transform: uppercase;
        }

        &__error {
            margin-top: 10px;
            font-size: 13px;
            color: var(--error-text, #ef4444);
        }

        &__notice {
            margin-top: 10px;
            font-size: 13px;
            font-weight: 600;
            color: var(--accent-primary);
        }
    }
</style>
