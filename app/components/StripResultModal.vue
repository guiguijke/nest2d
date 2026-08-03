<template>
    <DialogWrapper trackingTag="strip_result">
        <div class="modal">
            <div class="modal__wrapper">
                <DxfViewerComponent
                    :dxfUrl="resultModalData.dxfUrl"
                    :isFullScreen="true"
                    class="modal__display modal__display--is-fullscreen"
                />
            </div>
            <div class="modal__name">
                {{ resultModalData.slug }}.dxf
            </div>
            <div class="modal__meta">
                <span class="modal__tag">H {{ fmtLength(resultModalData.height) }}</span>
                <span v-if="resultModalData.width != null" class="modal__tag">W {{ roundedWidth }}</span>
                <span class="modal__tag">{{ resultModalData.fileCount }} files</span>
            </div>
            <div class="controls">
                <MainButton
                    :href="resultModalData.dxfUrl"
                    :label="t('results.download')" 
                    tag="a"
                    download
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="strip_result_download"
                />
            </div>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants';
import { themeType } from '~~/constants/theme.constants';

const { t } = useLocale()
const { getters } = stripStore;
const resultModalData = computed(() => getters.resultModalData);

const { fmtLength } = useUnit()
const roundedWidth = computed(() => fmtLength(unref(resultModalData)?.width ?? 0));
</script>

<style lang="scss" scoped>
.modal {
    padding: 48px 24px 24px;

    max-width: 368px;
    @media (min-width: 567px) {
        max-width: initial;
        min-width: 368px;
    }

    &__wrapper {
        position: relative;
        display: flex;
    }
    &__display {
        max-width: 100%;
        max-height: 100%;

        width: 320px;
        height: 320px;

        &--is-fullscreen {
            @media (min-width: 567px) {
                width: calc(80vw - 48px);
                height: calc(80vh - 148px);
            }
        }
    }
    &__name {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
        margin-top: 10px;
        min-height: 42px;
        color: var(--label-primary);
        margin-left: auto;
        margin-right: auto;

        @media (min-width: 567px) {
            max-width: 320px;
        }
    }
    &__meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
        margin-bottom: 10px;
    }
    &__tag {
        font-size: 12px;
        color: var(--label-tertiary);
        background-color: var(--fill-tertiary);
        border-radius: 4px;
        padding: 2px 8px;
    }
}

.controls {
    display: flex;
    align-items: center;
    justify-content: center;

    &>* {
        margin-left: 4px;
        margin-right: 4px;
    }
}
</style>
