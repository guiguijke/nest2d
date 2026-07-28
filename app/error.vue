<template>
    <div class="error-page">
        <h1 class="error-page__code">{{ statusCode }}</h1>
        <p class="error-page__message">{{ statusMessage }}</p>
        <a href="/" class="error-page__link" @click.prevent="handleError">
            Go Home
        </a>
    </div>
</template>

<script setup>
const props = defineProps({
    error: {
        type: Object,
        default: () => ({}),
    },
})

const statusCode = computed(() => props.error?.statusCode || 500)
const statusMessage = computed(() => {
    if (statusCode.value === 404) return 'Page Not Found'
    return props.error?.statusMessage || 'Something went wrong'
})

// Clear the error so navigation back to the app works.
const handleError = () => clearError({ redirect: '/' })
</script>

<style lang="scss" scoped>
.error-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: var(--background-primary);
    color: var(--label-secondary);
    text-align: center;
    padding: 24px;

    &__code {
        font-size: 6rem;
        font-weight: 900;
        letter-spacing: 0.05em;
        color: var(--accent-primary);

        @media (min-width: 567px) {
            font-size: 9rem;
        }
    }

    &__message {
        margin-top: 16px;
        font-size: 18px;
        font-weight: 300;
        text-transform: uppercase;
        letter-spacing: 0.2em;
    }

    &__link {
        margin-top: 32px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 700;
        color: var(--background-primary);
        background-color: var(--accent-primary);
        border-radius: 8px;
        transition: background-color 0.3s;

        @media (hover:hover) {
            &:hover {
                background-color: var(--accent-secondary);
            }
        }
    }
}
</style>
