<template>
    <div class="settings">
        <MainTitle label="Nesting settings" class="settings__title" />
        <div class="settings__content content">
            <div class="content__size size">
                <div
                    v-for="(sheet, index) in sheets"
                    :key="index"
                    class="size__sheet sheet"
                >
                    <div class="sheet__header">
                        <span class="sheet__label">Sheet {{ index + 1 }}</span>
                        <button
                            v-if="sheets.length > 1"
                            class="sheet__remove"
                            @click="removeSheet(index)"
                            title="Remove this sheet type"
                        >
                            ✕
                        </button>
                    </div>
                    <div class="size__line">
                        <InputField prefix="W" suffix="mm" :modelValue="sheet.width" @update:modelValue="value => updateSheet(index, { width: value })" class="size__input" />
                        <InputField prefix="H" suffix="mm" :modelValue="sheet.height" @update:modelValue="value => updateSheet(index, { height: value })" class="size__input" />
                    </div>
                    <InputField prefix="Count" suffix="units" :modelValue="sheet.count" @update:modelValue="value => updateSheet(index, { count: value })" class="size__input" />
                </div>
                <button class="size__add" @click="addSheet">
                    + Add sheet type
                </button>
                <InputField prefix="Spacing" suffix="mm" v-model="localSpace" class="size__input" />
                <div class="size__rotations rotations">
                    <InputField prefix="Rotations" suffix="steps" v-model="localRotationCount" class="rotations__input" />
                    <p class="rotations__hint">{{ rotationHint }}</p>
                </div>
                <label class="size__checkbox">
                    <input type="checkbox" v-model="localAddOutShape">
                    Add out shape
                </label>
            </div>
        </div>
    </div>
</template>

<script setup>
const { getters, actions } = filesStore;
const { updateParams, updateSheet, addSheet, removeSheet } = actions;
const params = computed(() => getters.params);

const sheets = computed(() => {
    const p = unref(params);
    if (Array.isArray(p.sheets) && p.sheets.length > 0) return p.sheets;
    // Legacy params shape (before multi-sheet).
    return [{ width: p.widthPlate ?? '400', height: p.heightPlate ?? '560', count: p.sheetCount ?? '1' }];
});

const localSpace = computed({
    get: () => unref(params).space,
    set: value => updateParams({ space: value }),
});

const localAddOutShape = computed({
    get: () => unref(params).addOutShape,
    set: value => updateParams({ addOutShape: value }),
});

const localRotationCount = computed({
    get: () => unref(params).rotationCount,
    set: value => updateParams({ rotationCount: value }),
});

// Preview the angles that the current rotation count produces, so the user
// understands what "N rotations" means (e.g. 8 -> 0°, 45°, 90°, ... 315°).
const rotationHint = computed(() => {
    const n = Math.min(360, Math.max(1, Math.floor(Number(unref(params).rotationCount) || 4)))
    if (n === 1) return 'No rotation (0° only)'
    const step = 360 / n
    const angles = Array.from({ length: n }, (_, i) => Math.round(i * step))
    return `→ ${angles.map(a => a + '°').join(', ')}`
});
</script>

<style lang="scss" scoped>
.settings {
    text-align: center;

    &__title {
        margin-bottom: 16px;
    }

    &__content {
        width: 360px;
        max-width: 100%;
        margin-left: auto;
        margin-right: auto;
    }

}

.content {
    display: flex;
    justify-content: center;

    &__size {
        width: 100%;
        max-width: 320px;
    }
}

.size {
    &>*:not(:last-child) {
        margin-bottom: 12px;
    }

    &__line {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
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
        transition: border-color 0.3s, color 0.3s, background-color 0.3s;

        @media (hover:hover) {
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
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        padding: 0 4px;

        input {
            width: 16px;
            height: 16px;
            cursor: pointer;
            accent-color: var(--accent-primary);
        }
    }
}

.sheet {
    border: 1px solid var(--separator-secondary);
    border-radius: 14px;
    padding: 14px;
    background-color: var(--background-primary);
    box-shadow:
        0 1px 2px color-mix(in srgb, var(--label-primary) 4%, transparent),
        0 4px 12px color-mix(in srgb, var(--label-primary) 5%, transparent);

    &>*:not(:last-child) {
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

        @media (hover:hover) {
            &:hover {
                color: var(--error-border);
            }
        }
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
