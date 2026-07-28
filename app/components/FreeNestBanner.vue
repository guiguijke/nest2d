<template>
    <div v-if="show" class="free-nest" :class="{ 'free-nest--empty': isEmpty }">
        <template v-if="isAdmin">
            <span class="free-nest__text">Unlimited nesting (admin)</span>
        </template>
        <template v-else-if="isEmpty">
            <span class="free-nest__text">You've used all your free nestings for this month.</span>
            <button type="button" class="free-nest__link" @click="openPaywall">
                Start free trial
            </button>
        </template>
        <template v-else>
            <span class="free-nest__text">
                <template v-if="freeRemaining > 0">
                    {{ freeRemaining }} free nesting operation{{ freeRemaining === 1 ? '' : 's' }} left this month
                </template>
                <template v-if="freeRemaining > 0 && creditsRemaining > 0"> · </template>
                <template v-if="creditsRemaining > 0">
                    {{ creditsRemaining }} credit{{ creditsRemaining === 1 ? '' : 's' }}
                </template>
            </span>
        </template>
    </div>
</template>

<script setup>
const { getters } = authStore;

const user = computed(() => unref(getters.user) || {});

const isAdmin = computed(() => Boolean(user.value.isAdmin));

const isSubscribed = computed(() => {
    const status = user.value.subscriptionStatus;
    return status === 'active' || status === 'trialing';
});

const freeRemaining = computed(() => Number(user.value.freeRemaining || 0));
const creditsRemaining = computed(() => Number(user.value.creditsRemaining || 0));

// Only relevant for feature-flagged users who are not yet subscribed.
const show = computed(() =>
    Boolean(user.value.isStripFeatureEnable) && !isSubscribed.value
);

const isEmpty = computed(() =>
    !isAdmin.value && freeRemaining.value <= 0 && creditsRemaining.value <= 0
);

const buyCreditsDialog = useBuyCreditsDialog();
const openPaywall = () => {
    buyCreditsDialog.value = true;
};
</script>

<style lang="scss" scoped>
.free-nest {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 13px;
    color: var(--label-secondary);

    &--empty {
        color: var(--accent-primary);
    }

    &__link {
        font-weight: 700;
        color: var(--accent-primary);
        text-decoration: underline;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        font-size: 13px;
    }
}
</style>
