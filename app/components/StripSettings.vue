<template>
    <div class="settings">
        <MainTitle :label="t('settings.nesting')" class="settings__title" />
        <div class="settings__content content">
            <div class="content__size size">
                <InputField :prefix="t('settings.height')" :suffix="unitLabel" v-model="localHeight" :isError="isHeightTooSmall"
                    class="size__input" />
            </div>
        </div>
        <p
            v-if="requiredHeight != null"
            :class="{ 'settings__hint--error': isHeightTooSmall }"
            class="settings__hint"
        >
            {{ t('settings.requiredHeight', { h: requiredHeight }) }}
        </p>
    </div>
</template>

<script setup>
const { t } = useLocale()
const { unitLabel, fmtLength } = useUnit()
const { getters, actions } = stripStore;
const { updateParams } = actions;
const params = computed(() => getters.params);
const isHeightTooSmall = computed(() => getters.isHeightTooSmall);
// requiredHeight arrives in canonical mm — format it in the user's unit.
const requiredHeight = computed(() => {
    const value = unref(getters.requiredHeight);
    if (value == null) {
        return null;
    }
    return fmtLength(value);
});

const localHeight = computed({
    get: () => unref(params).height,
    set: value => updateParams({ height: value }),
});
</script>

<style lang="scss" scoped>
.settings {
    text-align: center;

    &__title {
        margin-bottom: 16px;
    }

    &__content {
        width: 320px;
        margin-left: auto;
        margin-right: auto;
    }

    &__hint {
        margin-top: 8px;
        font-size: 13px;
        color: var(--label-secondary);

        &--error {
            color: rgb(222, 0, 54);
        }
    }
}

.content {
    display: flex;
    justify-content: center;

    &__size {
        width: 221px;
    }
}

.size {
    &__input {
        flex-grow: 1;
        min-width: 80px;
    }
}
</style>
