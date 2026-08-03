<template>
    <div v-if="enabled" class="unit" ref="root">
        <button
            class="unit__trigger"
            @click="toggle"
            :aria-label="t('units.label')"
            :aria-expanded="isOpen"
            :title="t('units.label')"
        >
            <span class="unit__code">{{ unit === 'inch' ? 'in' : 'mm' }}</span>
            <svg class="unit__chevron" :class="{ 'unit__chevron--open': isOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
            </svg>
        </button>
        <transition name="unit-fade">
            <ul v-if="isOpen" class="unit__menu" role="listbox">
                <li
                    v-for="opt in options"
                    :key="opt.value"
                    :class="['unit__item', { 'unit__item--active': opt.value === unit }]"
                    @click="choose(opt.value)"
                    role="option"
                    :aria-selected="opt.value === unit"
                >
                    <span class="unit__name">{{ opt.label }}</span>
                    <svg v-if="opt.value === unit" class="unit__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </li>
            </ul>
        </transition>
    </div>
</template>

<script setup>
import { UNITS } from '~/utils/units'

const { t } = useLocale()
const { unit, setUnit, enabled } = useUnit()

const options = computed(() =>
    UNITS.map((value) => ({ value, label: t(`units.${value}`) }))
)

const isOpen = ref(false)
const root = ref(null)

function toggle() {
    isOpen.value = !isOpen.value
}

function choose(code) {
    setUnit(code)
    isOpen.value = false
}

// Convert the in-progress form values whenever the unit changes — manual
// switch here, cookie init, or account preference synced from the DB. The
// stores keep display-unit strings; converting avoids forcing the user to
// retype sheet dimensions after a switch.
watch(unit, (to, from) => {
    if (!enabled.value || !to || !from || to === from) return
    filesStore.actions.convertParamsUnits(from, to)
    stripStore.actions.convertParamsUnits(from, to)
})

// Close on outside click / Escape.
function onClickOutside(e) {
    if (root.value && !root.value.contains(e.target)) {
        isOpen.value = false
    }
}
function onKey(e) {
    if (e.key === 'Escape') isOpen.value = false
}
onMounted(() => {
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside)
    document.removeEventListener('keydown', onKey)
})
</script>

<style lang="scss" scoped>
.unit {
    position: relative;
    display: inline-flex;
    margin-left: 8px;

    &__trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--separator-primary);
        background-color: var(--background-primary);
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        color: var(--label-primary);
        transition: border-color 0.2s, background-color 0.2s;
        white-space: nowrap;

        &:hover {
            border-color: var(--label-tertiary);
        }
    }

    &__code {
        line-height: 1;
        min-width: 20px;
        text-align: center;
    }

    &__chevron {
        width: 14px;
        height: 14px;
        color: var(--label-tertiary);
        transition: transform 0.2s;

        &--open {
            transform: rotate(180deg);
        }
    }

    &__menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 168px;
        margin: 0;
        padding: 4px;
        list-style: none;
        border-radius: 10px;
        border: 1px solid var(--separator-primary);
        background-color: var(--background-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        z-index: 100;
    }

    &__item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        color: var(--label-secondary);
        transition: background-color 0.15s, color 0.15s;

        &:hover {
            background-color: var(--fill-tertiary);
            color: var(--label-primary);
        }

        &--active {
            color: var(--label-primary);
        }
    }

    &__name {
        flex-grow: 1;
    }

    &__check {
        width: 16px;
        height: 16px;
        color: var(--accent-primary);
        flex-shrink: 0;
    }
}

.unit-fade-enter-active,
.unit-fade-leave-active {
    transition: opacity 0.15s, transform 0.15s;
}
.unit-fade-enter-from,
.unit-fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>
