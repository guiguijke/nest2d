<template>
    <span
        class="chip"
        :class="`chip--${mode}`"
    >{{ label }}</span>
</template>

<script setup>
import { PRIVACY_CHIP_KEY } from '~/utils/privacyMode'

const props = defineProps({
    mode: {
        type: String,
        required: true,
        validator: (v) => ['demo', 'device', 'cloud', 'vault'].includes(v),
    },
})

const { t } = useLocale()
const label = computed(() => t(PRIVACY_CHIP_KEY[props.mode]))
</script>

<style lang="scss" scoped>
.chip {
    display: inline-block;
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
    line-height: 1.4;

    &--demo,
    &--device {
        background: var(--accent-primary);
        color: var(--background-primary);
    }
    &--cloud {
        background: var(--fill-tertiary);
        color: var(--label-secondary);
        box-shadow: inset 0 0 0 1px var(--separator-secondary);
    }
    &--vault {
        background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
        color: var(--accent-primary);
    }
}
</style>
