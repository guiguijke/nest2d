<template>
    <div class="settings">
        <MainTitle
            :label="t('settings.nesting')"
            class="settings__title"
        />
        <div class="settings__content content">
            <div class="content__size size">
                <div
                    v-for="(sheet, index) in sheets"
                    :key="index"
                    class="size__sheet sheet"
                >
                    <div class="sheet__header">
                        <span class="sheet__label">{{ t('settings.sheet', { n: index + 1 }) }}</span>
                        <button
                            v-if="sheets.length > 1"
                            class="sheet__remove"
                            @click="removeSheet(index)"
                            :title="t('settings.removeSheet')"
                        >
                            ✕
                        </button>
                    </div>
                    <div
                        v-if="sheetPresets.length"
                        class="sheet__presets presets"
                    >
                        <button
                            v-for="preset in sheetPresets"
                            :key="`${preset.width}x${preset.height}`"
                            :class="[
                                'presets__chip',
                                { 'presets__chip--active': isPresetActive(sheet, preset) },
                            ]"
                            :title="t('settings.sheetPreset.hint')"
                            @click="applyPreset(index, preset)"
                        >
                            {{ preset.width }}×{{ preset.height }}
                        </button>
                    </div>
                    <div class="size__line">
                        <InputField
                            :prefix="t('settings.width')"
                            :suffix="unitLabel"
                            :modelValue="sheet.width"
                            @update:modelValue="(value) => updateSheet(index, { width: value })"
                            class="size__input"
                        />
                        <InputField
                            :prefix="t('settings.height')"
                            :suffix="unitLabel"
                            :modelValue="sheet.height"
                            @update:modelValue="(value) => updateSheet(index, { height: value })"
                            class="size__input"
                        />
                    </div>
                    <InputField
                        :prefix="t('settings.count')"
                        :suffix="t('settings.units')"
                        :modelValue="sheet.count"
                        @update:modelValue="(value) => updateSheet(index, { count: value })"
                        class="size__input"
                    />
                </div>
                <button
                    class="size__add"
                    @click="addSheet"
                >
                    {{ t('settings.addSheet') }}
                </button>
                <InputField
                    :prefix="t('settings.spacing')"
                    :suffix="unitLabel"
                    v-model="localSpace"
                    class="size__input"
                />
                <div class="size__rotations rotations">
                    <InputField
                        :prefix="t('settings.rotations')"
                        :suffix="t('settings.steps')"
                        v-model="localRotationCount"
                        class="rotations__input"
                    />
                    <p class="rotations__hint">{{ rotationHint }}</p>
                </div>
                <div class="size__compute compute">
                    <span class="compute__label">
                        {{ t('settings.directions') }}
                        <span
                            class="compute__help"
                            :title="t('settings.directions.help')"
                            >?</span
                        >
                    </span>
                    <div class="compute__options">
                        <button
                            v-for="option in directionOptions"
                            :key="option.value"
                            :class="[
                                'compute__option',
                                { 'compute__option--active': option.active },
                            ]"
                            :title="option.hint"
                            @click="toggleDirection(option.value)"
                        >
                            <span class="compute__arrow">{{ option.arrow }}</span>
                            {{ option.label }}
                        </button>
                    </div>
                    <p class="compute__hint">{{ directionsHint }}</p>
                </div>
                <div v-if="isDemoProject" class="size__compute compute">
                    <span class="compute__label">
                        {{ t('settings.demoPower') }}
                        <span
                            class="compute__help"
                            :title="t('settings.demoPower.help')"
                            >?</span
                        >
                    </span>
                    <div class="compute__options">
                        <button
                            v-for="option in demoPowerOptions"
                            :key="option.walks"
                            :class="[
                                'compute__option',
                                { 'compute__option--active': option.active },
                            ]"
                            :title="option.hint"
                            @click="setDemoWalks(option.walks)"
                        >
                            <span class="compute__arrow">×{{ option.walks }}</span>
                            {{ option.label }}
                        </button>
                    </div>
                    <p class="compute__hint">{{ t('settings.demoPower.hint') }}</p>
                </div>
                <label class="size__checkbox" :title="t('settings.addOutShapeHint')">
                    <input
                        type="checkbox"
                        v-model="localAddOutShape"
                    />
                    {{ t('settings.addOutShape') }}
                </label>
                <label class="size__checkbox" :title="t('settings.fillHolesHint')">
                    <input
                        type="checkbox"
                        v-model="localFillHoles"
                    />
                    {{ t('settings.fillHoles') }}
                </label>
            </div>
        </div>
    </div>
</template>

<script setup>
    import { SHEET_PRESETS } from '~/utils/units'
    import { DEMO_MAX_DIRECTIONS, DEMO_PROJECT_SLUG, DEMO_WALK_CHOICES, resolveDemoWalks } from '~~/shared/constants/demo.constants'
    import { displayDirectionArrow } from '~/utils/sheetView'

    const { t } = useLocale()
    const { unit, unitLabel, enabled: unitsEnabled } = useUnit()
    const { getters, actions } = filesStore
    const { updateParams, updateSheet, addSheet, removeSheet } = actions
    const params = computed(() => getters.params)

    // Standard sheet sizes of the current unit (a US user picks 48×96 from a
    // list, never types it). Hidden when the units feature is off.
    const sheetPresets = computed(() => (unitsEnabled.value ? SHEET_PRESETS[unit.value] || [] : []))
    const isPresetActive = (sheet, preset) =>
        Number(String(sheet.width).replace(',', '.')) === preset.width &&
        Number(String(sheet.height).replace(',', '.')) === preset.height
    const applyPreset = (index, preset) =>
        updateSheet(index, { width: String(preset.width), height: String(preset.height) })

    const sheets = computed(() => {
        const p = unref(params)
        if (Array.isArray(p.sheets) && p.sheets.length > 0) return p.sheets
        // Legacy params shape (before multi-sheet).
        return [{ width: p.widthPlate ?? '400', height: p.heightPlate ?? '560', count: p.sheetCount ?? '1' }]
    })

    const localSpace = computed({
        get: () => unref(params).space,
        set: (value) => updateParams({ space: value }),
    })

    const localAddOutShape = computed({
        get: () => unref(params).addOutShape,
        set: (value) => updateParams({ addOutShape: value }),
    })

    const localFillHoles = computed({
        get: () => unref(params).fillHoles !== false,
        set: (value) => updateParams({ fillHoles: value }),
    })

    const localRotationCount = computed({
        get: () => unref(params).rotationCount,
        set: (value) => updateParams({ rotationCount: value }),
    })

    // Layout directions: each checked direction is one result option.
    // Default is 1 (left) = the best of that search. Paid can check up to
    // 3 to compare. Free is radio (1 per nesting). Server re-validates.
    const DIRECTION_ORDER = ['left', 'bottom', 'balanced']
    const { getters: authGetters } = authStore
    const route = useRoute()
    // The shared demo project runs at standard power (4 vcores) but computes
    // ONE direction per nesting — all 3 stay selectable (radio) so newcomers
    // can try each, and the checkboxes always show what the server will
    // actually compute.
    const isDemoProject = computed(() => route.params.slug === DEMO_PROJECT_SLUG)
    const maxDirections = computed(() => {
        if (unref(isDemoProject)) return DEMO_MAX_DIRECTIONS
        const n = unref(authGetters.user)?.compute?.maxDirections
        return Math.min(3, Math.max(1, Number(n) || 1))
    })
    const localDirections = computed(() => {
        const dirs = unref(params).directions
        const valid = Array.isArray(dirs) ? dirs.filter((d) => DIRECTION_ORDER.includes(d)) : []
        return valid.length ? valid : ['left']
    })
    const toggleDirection = (value) => {
        const current = localDirections.value
        if (maxDirections.value === 1) {
            // Free plan: radio behaviour — one direction per nesting.
            updateParams({ directions: [value] })
            return
        }
        if (current.includes(value)) {
            if (current.length === 1) return // at least one direction
            updateParams({ directions: current.filter((d) => d !== value) })
        } else {
            updateParams({
                directions: DIRECTION_ORDER.filter((d) => current.includes(d) || d === value),
            })
        }
    }
    const firstSheet = computed(() => {
        const s = sheets.value[0] || {}
        return {
            width: Number(String(s.width).replace(',', '.')) || 0,
            height: Number(String(s.height).replace(',', '.')) || 0,
        }
    })
    const directionOptions = computed(() =>
        DIRECTION_ORDER.map((value) => ({
            value,
            arrow: displayDirectionArrow(value, firstSheet.value.width, firstSheet.value.height),
            label: t(`settings.directions.${value}`),
            hint: t(`settings.directions.${value}Hint`),
            active: localDirections.value.includes(value),
        }))
    )
    const directionsHint = computed(() =>
        maxDirections.value === 1
            ? t('settings.directions.freeHint')
            : t('settings.directions.paidHint')
    )

    const DEMO_POWER_KEYS = { 1: 'free', 4: 'unlimited', 8: 'pro' }
    const demoWalks = computed(() => resolveDemoWalks(unref(params).demoWalks))
    const setDemoWalks = (n) => updateParams({ demoWalks: resolveDemoWalks(n) })
    const demoPowerOptions = computed(() =>
        DEMO_WALK_CHOICES.map((walks) => ({
            walks,
            label: t(`settings.demoPower.${DEMO_POWER_KEYS[walks]}`),
            hint: t(`settings.demoPower.${DEMO_POWER_KEYS[walks]}Hint`),
            active: demoWalks.value === walks,
        })),
    )

    // Preview the angles that the current rotation count produces, so the user
    // understands what "N rotations" means (e.g. 8 -> 0°, 45°, 90°, ... 315°).
    const rotationHint = computed(() => {
        const n = Math.min(360, Math.max(1, Math.floor(Number(unref(params).rotationCount) || 4)))
        if (n === 1) return t('settings.noRotation')
        const step = 360 / n
        const angles = Array.from({ length: n }, (_, i) => Math.round(i * step))
        return `→ ${angles.map((a) => a + '°').join(', ')}`
    })
</script>

<style lang="scss" scoped>
    .settings {
        text-align: left;

        &__title {
            margin-bottom: 12px;
        }

        &__content {
            width: 100%;
        }
    }

    .content {
        display: block;

        &__size {
            width: 100%;
        }
    }

    .size {
        & > *:not(:last-child) {
            margin-bottom: 10px;
        }

        &__line {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
        }

        &__input {
            flex-grow: 1;
            min-width: 80px;
        }

        &__add {
            width: 100%;
            padding: 11px;
            border: 1.5px dashed var(--separator-primary);
            border-radius: 10px;
            background-color: transparent;
            color: var(--label-secondary);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition:
                border-color 0.3s,
                color 0.3s,
                background-color 0.3s;

            @media (hover: hover) {
                &:hover {
                    border-color: var(--accent-primary);
                    color: var(--accent-primary);
                    background-color: color-mix(in srgb, var(--accent-primary) 5%, transparent);
                }
            }
        }

        &__checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--label-primary);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            padding: 0 4px;

            input {
                width: 16px;
                height: 16px;
                margin-top: 2px;
                flex-shrink: 0;
                cursor: pointer;
                accent-color: var(--accent-primary);
            }
        }
    }

    .sheet {
        border: 1px solid var(--separator-secondary);
        border-radius: 12px;
        padding: 12px;
        background-color: var(--background-primary);
        box-shadow:
            0 1px 2px color-mix(in srgb, var(--label-primary) 4%, transparent),
            0 4px 12px color-mix(in srgb, var(--label-primary) 5%, transparent);

        & > *:not(:last-child) {
            margin-bottom: 10px;
        }

        &__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 4px 2px;
        }

        &__label {
            font-size: 13px;
            font-weight: 700;
            color: var(--label-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        &__remove {
            border: none;
            background: none;
            color: var(--label-tertiary);
            cursor: pointer;
            font-size: 14px;
            padding: 2px 6px;
            border-radius: 4px;
            transition: color 0.3s;

            @media (hover: hover) {
                &:hover {
                    color: var(--error-border);
                }
            }
        }
    }

    .presets {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;

        &__chip {
            padding: 5px 10px;
            border: 1px solid var(--separator-secondary);
            border-radius: 999px;
            background-color: transparent;
            color: var(--label-secondary);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition:
                border-color 0.2s,
                color 0.2s,
                background-color 0.2s;

            @media (hover: hover) {
                &:hover {
                    border-color: var(--accent-primary);
                    color: var(--accent-primary);
                }
            }

            &--active {
                border-color: var(--accent-primary);
                color: var(--accent-primary);
                background-color: color-mix(in srgb, var(--accent-primary) 8%, transparent);
            }
        }
    }

    .compute {
        &__label {
            display: block;
            font-size: 13px;
            font-weight: 700;
            color: var(--label-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
            padding: 0 4px;
            text-align: left;
        }

        &__help {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            margin-left: 6px;
            border-radius: 50%;
            border: 1px solid var(--label-tertiary);
            color: var(--label-tertiary);
            font-size: 11px;
            font-weight: 700;
            text-transform: none;
            cursor: help;
            vertical-align: 1px;
        }

        &__arrow {
            display: block;
            font-size: 16px;
            line-height: 1;
            margin-bottom: 2px;
        }

        &__options {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            padding: 4px;
            border-radius: 12px;
            background-color: var(--fill-tertiary);
        }

        &__option {
            padding: 8px 4px;
            border: none;
            border-radius: 9px;
            background-color: transparent;
            color: var(--label-secondary);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition:
                background-color 0.2s,
                color 0.2s,
                box-shadow 0.2s;

            &--active {
                background-color: var(--background-primary);
                color: var(--accent-primary);
                box-shadow: 0 1px 3px color-mix(in srgb, var(--label-primary) 12%, transparent);
            }

            &--locked {
                opacity: 0.4;
                cursor: not-allowed;
            }

            @media (hover: hover) {
                &:not(&--active):not(&--locked):hover {
                    color: var(--label-primary);
                }
            }
        }

        &__hint {
            margin-top: 6px;
            font-size: 12px;
            color: var(--label-tertiary);
            text-align: left;
            padding: 0 4px;
        }
    }

    .rotations {
        &__hint {
            margin-top: 6px;
            font-size: 13px;
            color: var(--label-secondary);
            font-family: $sf_mono;
            word-break: break-word;
            line-height: 1.4;
        }
    }
</style>
