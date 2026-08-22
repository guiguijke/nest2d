<template>
    <div class="files">
        <DxfUpload
            v-if="!readonly"
            compact
            :extensions="uploadExtensions"
            class="files__upload"
            @files="addFiles"
            @rejected="onRejected"
            @oversize="rejectError = 'upload.tooLarge'"
        />
        <p v-if="rejectError" class="files__error">{{ t(rejectError) }}</p>
        <div class="files__grid">
            <template
                v-for="(file, fileIndex) in projectFiles"
                :key="file.slug"
            >
                <FileDone
                    :file="file"
                    :fileIndex="fileIndex"
                    @openModal="openModal(file)"
                    v-if="fileIsDone(file.processingStatus)"
                    class="files__item file"
                />
                <FileInProgress
                    :file="file"
                    v-if="fileIsProcessing(file.processingStatus)"
                    class="files__item file"
                />
                <FileError
                    :file="file"
                    v-if="fileIsError(file.processingStatus)"
                    class="files__item file"
                />
            </template>
        </div>
        <FileModal v-model:isModalOpen="fileDialog" />
    </div>
</template>
<script setup>
import { processingType } from "~~/constants/files.constants";
import FileError from "./FileError.vue";

const props = defineProps({
    projectFiles: {
        type: Array,
        required: true
    },
    // Read-only mode (shared demo project): no upload dropzone.
    readonly: {
        type: Boolean,
        default: false
    },
    // Projet « cet appareil » : DXF/SVG seulement (DWG = serveurs).
    local: {
        type: Boolean,
        default: false
    }
})

const uploadExtensions = computed(() =>
    props.local ? ['.dxf', '.svg'] : ['.dxf', '.svg', '.dwg']
)

const emit = defineEmits(["addFiles"])
const { t } = useLocale()
const rejectError = ref('')

const addFiles = (files) => {
    rejectError.value = ''
    emit("addFiles", files)
}

const onRejected = (files) => {
    const names = (files || []).map((f) => String(f.name || '').toLowerCase())
    if (props.local && names.some((n) => n.endsWith('.dwg'))) {
        rejectError.value = 'localImport.dwgRejected'
        return
    }
    rejectError.value = props.local ? 'localImport.unsupportedType' : 'upload.unsupported'
}

const fileIsDone = (status) => status === processingType.done
const fileIsProcessing = (status) => status === processingType.inProgress
const fileIsError = (status) => status === processingType.error

const { actions } = globalStore;
const { setModalFileData } = actions;

const fileDialog = useFileDialog();
const openModal = (file) => {
    setModalFileData(file)
    fileDialog.value = true
}
</script>

<style lang="scss" scoped>
.files {
    display: flex;
    flex-direction: column;
    gap: 12px;

    &__upload {
        width: 100%;
    }

    &__error {
        margin: 0;
        padding: 10px 12px;
        font-size: 13px;
        line-height: 1.4;
        color: var(--label-secondary);
        background-color: var(--error-background);
        border: 1px solid var(--error-border);
        border-radius: 8px;
    }

    &__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;

        @media (min-width: 880px) {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
}
.file {
    position: relative;
    $self: &;
    padding: 15px;
    border-radius: 8px;
    border: 1px solid var(--separator-secondary);
    transition: border-color 0.3s;

    &__display {
        width: 56px;
        height: 56px;
    }
    &__name {
        margin-top: 16px;
        margin-bottom: 16px;
        color: var(--label-secondary);
        transition: color 0.3s;
    }
    &__btn {
        opacity: 0;
        position: absolute;
        top: 8px;
        right: 8px;
        transition: opacity 0.3s;
    }

    @media (hover:hover) {
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
        color: var(--label-secondary);
        margin-left: 8px;
        margin-right: 8px;
        min-width: 24px;
        text-align: center;
    }
}
</style>
