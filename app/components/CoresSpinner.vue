<template>
    <span
        class="cores-spinner"
        :title="title"
    >
        <svg
            :width="size"
            :height="size"
            viewBox="0 0 18 18"
            aria-hidden="true"
        >
            <circle
                cx="9"
                cy="9"
                r="7"
                class="cores-spinner__track"
            />
            <circle
                cx="9"
                cy="9"
                r="7"
                class="cores-spinner__segments"
                :stroke-dasharray="dashArray"
                :style="{ animationDuration: duration }"
            />
        </svg>
        <span
            v-if="showCount"
            class="cores-spinner__count"
            >×{{ cores }}</span
        >
    </span>
</template>

<script setup>
    // Spinning wheel showing how many vcores are working on the nesting.
    // The ring is split into N dashes (one per core) and rotates faster the
    // more cores are at work — 1 core turns slowly, 8 spin briskly.
    const props = defineProps({
        cores: { type: Number, default: 1 },
        size: { type: Number, default: 18 },
        showCount: { type: Boolean, default: false },
        title: { type: String, default: '' },
    })

    const n = computed(() => Math.min(8, Math.max(1, Math.round(props.cores) || 1)))

    // Ring circumference is 2*pi*7 ~ 43.98: N dashes with a small gap.
    const dashArray = computed(() => {
        const c = 2 * Math.PI * 7
        const seg = c / n.value
        return `${(seg * 0.68).toFixed(2)} ${(seg * 0.32).toFixed(2)}`
    })

    const duration = computed(() => `${(4.5 - 0.45 * n.value).toFixed(2)}s`)
</script>

<style lang="scss" scoped>
    .cores-spinner {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        vertical-align: middle;

        svg {
            display: block;
        }

        &__track {
            fill: none;
            stroke: var(--fill-tertiary);
            stroke-width: 2.4;
        }

        &__segments {
            fill: none;
            stroke: var(--accent-primary);
            stroke-width: 2.4;
            stroke-linecap: round;
            transform-origin: 50% 50%;
            animation: cores-spinner-rotate linear infinite;
        }

        &__count {
            font-size: 12px;
            font-weight: 700;
            color: var(--accent-primary);
            font-variant-numeric: tabular-nums;
        }
    }

    @keyframes cores-spinner-rotate {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
</style>
