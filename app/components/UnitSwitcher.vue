<template>
    <div
        v-if="enabled"
        class="unit-switch"
        role="group"
        :aria-label="t('units.label')"
        :title="t('units.label')"
    >
        <span
            class="unit-switch__thumb"
            :style="{ transform: unit === 'inch' ? 'translateX(100%)' : 'translateX(0)' }"
            aria-hidden="true"
        />
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            :class="['unit-switch__segment', { 'unit-switch__segment--active': unit === opt.value }]"
            :aria-pressed="unit === opt.value"
            :title="opt.label"
            @click="choose(opt.value)"
        >
            {{ opt.short }}
        </button>
    </div>
</template>

<script setup>
const { t } = useLocale()
const { unit, setUnit, enabled } = useUnit()

const options = computed(() => [
    { value: 'mm', short: 'mm', label: t('units.mm') },
    { value: 'inch', short: 'in', label: t('units.inch') },
])

function choose(code) {
    setUnit(code)
}

// Bring the in-progress form values to the current unit — on manual switch,
// on cookie init, and on account preference synced from the DB. immediate
// covers the load path (the unit is set BEFORE this watcher registers, so
// without it no change event ever fires); the stores' paramsUnit tracking
// keeps the sync idempotent across remounts.
watch(
    unit,
    (to) => {
        if (!enabled.value || !to) return
        filesStore.actions.syncParamsToUnit(to)
        stripStore.actions.syncParamsToUnit(to)
    },
    { immediate: true }
)
</script>

<style lang="scss" scoped>
.unit-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
    padding: 2px;
    border: 1px solid var(--separator-primary);
    border-radius: 999px;
    background-color: var(--fill-tertiary);

    &__thumb {
        position: absolute;
        top: 2px;
        bottom: 2px;
        left: 2px;
        width: calc(50% - 2px);
        border-radius: 999px;
        background-color: var(--background-primary);
        box-shadow:
            0 1px 2px color-mix(in srgb, var(--label-primary) 10%, transparent),
            0 2px 6px color-mix(in srgb, var(--label-primary) 10%, transparent);
        transition: transform 0.28s cubic-bezier(0.34, 1.3, 0.5, 1);
        pointer-events: none;
    }

    &__segment {
        position: relative;
        z-index: 1;
        flex: 1 1 0;
        min-width: 34px;
        padding: 5px 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--label-tertiary);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        text-align: center;
        cursor: pointer;
        transition: color 0.25s;

        @media (hover: hover) {
            &:not(.unit-switch__segment--active):hover {
                color: var(--label-primary);
            }
        }

        &--active {
            color: var(--accent-primary);
        }
    }
}
</style>
