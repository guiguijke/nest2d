<template>
    <div class="parts">
        <h4 class="parts__title">
            {{ partsTitle}}
        </h4>
        <UiScrollbar class="parts__scrollbar">
            <ul class="parts__list">
                <li
                    v-for="(part, index) in parts"
                    :key="index"
                    class="parts__item"
                >
                    <span
                        v-if="part.color"
                        class="parts__dot"
                        :style="{ backgroundColor: part.color }"
                    />
                    {{ fmtLengthValue(part.width) }} x {{ fmtLengthValue(part.height) }} {{ unitLabel }}
                </li>
            </ul>
        </UiScrollbar>
    </div>
</template>
<script setup>

const { t } = useLocale()
// Part dims arrive from the server in canonical mm — display converts.
const { fmtLengthValue, unitLabel } = useUnit()

const props = defineProps({
    parts: {
        type: Array,
        required: true,
    },
})
const partsTitle = computed(() => {
    return props.parts.length === 1 ? t('parts.label') : t('parts.count', { n: props.parts.length })
})
</script>
<style lang="scss" scoped>
.parts {
    color: var(--label-secondary);
    transition: color 0.3s;
    text-align: left;

    &__scrollbar {
        height: calc(100% - 19px);
    }
    &__title {
        margin-bottom: 4px;
    }

    @media (hover: hover) {
        &:hover {
            color: var(--label-primary);
        }
    }

    &__item {
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 5px;
    }

    // Per-part display color assigned at import — matches the live view and
    // the colored result preview.
    &__dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
    }
}
</style>
