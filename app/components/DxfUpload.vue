<template>
    <div
        class="upload"
        @dragover.prevent="updateDragStatus()"
        @dragenter.prevent="updateDragStatus()"
        @dragleave.prevent="updateDragStatus(false)"
        @drop.prevent="onDrop"
    >
        <label
            class="upload__label"
            :class="labelClasses"
        >
            <input
                type="file"
                name="dxf"
                :accept="extensions.join(',')"
                multiple
                @change="onDXFChange"
                class="upload__input"
            />
            <MainButton
                :label="t('upload.choose')"
                tag="div"
                :theme="themeType.primary"
                trackingTag="choose_files"
                class="upload__btn"
            />
            <span class="upload__text">
                {{ t('upload.drop') }}
            </span>
            <span class="upload__text upload__text--gray">
                {{ t('upload.limit') }}
            </span>
        </label>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants';

const { t } = useLocale()

const props = defineProps({
    extensions: {
        type: Array,
        default: () => [".dxf", ".svg", ".dwg"],
    },
    compact: {
        type: Boolean,
        default: false,
    },
});
const emit = defineEmits(["files"]);

const { extensions } = toRefs(props);
const isDragOver = ref(false);

const updateDragStatus = (newValue = true) => {
    isDragOver.value = newValue;
};
const setFiles = (newFiles) => {
    const filesList = newFiles.filter((file) => unref(extensions).includes(file.name.slice(-4).toLowerCase()));
    emit("files", filesList);
};
const onDrop = (event) => {
    updateDragStatus(false);
    const droppedFiles = Array.from(event.dataTransfer.files);
    setFiles(droppedFiles);
};
const onDXFChange = (event) => {
    const addedFiles = Array.from(event.target.files);
    setFiles(addedFiles);
};

const labelClasses = computed(() => ({
    'upload__label--hover': unref(isDragOver),
    'upload__label--compact': unref(props.compact),
}));
</script>

<style lang="scss" scoped>
.upload {
    $self: &;
    position: relative;
    text-align: center;

    &__label {
        padding: 10px;
        cursor: pointer;
        display: flex;
        justify-content: center;
        flex-direction: column;
        align-items: center;
        min-height: 164px;
        background-color: var(--fill-tertiary);
        border: dashed 1px var(--accent-primary);
        border-radius: 12px;
        transition: background-color 0.3s;

        &--hover {
            background-color: var(--fill-secondary);
        }

        &--compact {
            min-height: 88px;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 8px 16px;
            padding: 16px 20px;

            .upload__btn {
                margin-bottom: 0;
            }

            .upload__text--gray {
                margin-top: 0;
                flex-basis: 100%;
            }
        }
    }
    &__btn {
        position: relative;
        z-index: 1;
        margin-bottom: 16px;
    }
    &__text {
        color: var(--label-primary);

        &--gray {
            margin-top: 8px;
            color: var(--label-secondary);
        }
    }
    &__input {
        opacity: 0;
        width: 0;
        height: 0;
        overflow: hidden;
        position: absolute;
        z-index: -1;
        top: 0;
        left: 0;
    }

    @media (hover:hover) {
        &:hover {
            #{$self}__label {
                background-color: var(--fill-secondary);
            }
        }
    }
}
</style>
