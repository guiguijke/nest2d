<template>
    <div class="file">
        <!-- D-PRV-10 : fichier expiré (géométrie purgée à 24 h) — compteur
             et preview masqués, réimport nécessaire pour renester. -->
        <template v-if="file.expired">
            <div class="file__display file__placeholder" :title="t('files.expired')" />
            <p class="file__name">
                {{ file.name }}
            </p>
            <p class="file__expired">{{ t('files.expired') }}</p>
        </template>
        <template v-else>
            <SvgDisplay :size="sizeType.s" :src="file.svgUrl" class="file__display" preserve-colors />
            <FileParts @click="openModal()" :parts="file.parts" class="file__parts" />
            <p class="file__name">
                {{ file.name }}
            </p>
            <div class="file__counter counter">
                <MainButton :size="sizeType.s" :icon="iconType.minus" :isDisable="file.count < 1" :isLabelShow="false"
                    trackingTag="file_decrement" @click="decrement(fileIndex, $event)" label="decrement" class="counter__btn" />
                <input type="number" v-model="count" min="0" max="999" class="counter__value" @blur="onCountBlur" />
                <MainButton :size="sizeType.s" :icon="iconType.plus" :isLabelShow="false" :isDisable="file.count >= 999"
                    trackingTag="file_increment" @click="increment(fileIndex, $event)" label="increment" class="counter__btn" />
            </div>
            <div @click="openModal()" class="file__area" />
        </template>
    </div>
</template>
<script setup>
import { sizeType } from '~~/constants/size.constants'
import { iconType } from '~~/constants/icon.constants'

const { t } = useLocale()

const props = defineProps({
    file: {
        type: Object,
        required: true,
    },
    fileIndex: {
        type: Number,
        required: true,
    },
})

const count = computed({
    get: () => props.file.count,
    set: value => updateCount(value, props.fileIndex),
});

const emit = defineEmits(['openModal'])

const { actions } = filesStore
const { increment, decrement, updateCount } = actions

const openModal = () => {
    emit('openModal')
}
</script>

<style lang="scss" scoped>
.file {
    display: flex;
    flex-wrap: wrap;
    position: relative;
    $self: &;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--separator-secondary);
    box-shadow:
        0 1px 2px color-mix(in srgb, var(--label-primary) 4%, transparent),
        0 4px 12px color-mix(in srgb, var(--label-primary) 5%, transparent);
    transition: border-color 0.3s;

    &__parts {
        width: calc(100% - 80px);
        margin-left: 12px;
        height: 64px;
        position: relative;
        z-index: 1;
    }

    &__display {
        width: 64px;
        height: 64px;
    }

    &__name {
        width: 100%;
        margin-top: 10px;
        margin-bottom: 10px;
        color: var(--label-secondary);
        transition: color 0.3s;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    &__btn {
        opacity: 0;
        position: absolute;
        top: 8px;
        right: 8px;
        transition: opacity 0.3s;
    }

    &__area {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        cursor: pointer;
    }

    &__placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background-color: var(--fill-tertiary, rgba(127, 127, 127, 0.12));
        color: var(--label-tertiary);
        font-size: 11px;
        text-align: center;
        padding: 4px;
    }

    &__expired {
        width: 100%;
        margin-top: 8px;
        font-size: 11px;
        color: var(--label-tertiary);
    }

    &__counter {
        position: relative;
        z-index: 1;
    }

    @media (hover: hover) {
        &:hover {
            border-color: var(--separator-primary);

            #{$self}__name {
                color: var(--label-primary);
            }

            #{$self}__btn {
                opacity: 1;
            }
        }
    }
}

.counter {
    display: flex;
    align-items: center;

    &__value {
        padding-left: 4px;
        padding-right: 4px;
        color: var(--label-secondary);
        margin-left: 8px;
        margin-right: 8px;
        text-align: center;
        width: 36px;
        height: 30px;
        border: solid 1px var(--separator-secondary);
        border-radius: 4px;
        color: var(--accent-primary);
        outline: none;
        background-color: transparent;
        font-family: $sf_mono;

        &::-webkit-outer-spin-button,
        &::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        -moz-appearance: textfield;
    }
}
</style>
