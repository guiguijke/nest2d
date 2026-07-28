<template>
    <DialogWrapper trackingTag="result">
        <div class="modal">
            <div
                v-if="alternatives.length > 1 && !isHaveError"
                class="modal__alts alts"
            >
                <button
                    v-for="alt in alternatives"
                    :key="alt.altId"
                    :class="{ 'alts__tab--active': alt.altId === activeAlt }"
                    class="alts__tab"
                    @click="selectAlt(alt.altId)"
                >
                    Option {{ alt.altId + 1 }} · {{ formatScore(alt) }}
                </button>
            </div>
            <div
                v-if="resultModalData.isMultiSheet && !isHaveError"
                class="modal__list-sheets list-sheets"
            >
                <MainButton
                    :theme="themeType.primary"
                    :icon="iconType.arrowPrev"
                    :isLabelShow=false
                    :size="sizeType.s"
                    trackingTag="result_part_prev"
                    @click="updatePartPage(activePart - 1)"
                    :isDisable="activePart === 0"
                    label="prev"
                    class="controls__prev"
                />
                <MainButton
                    :label="`Part ${activePart + 1} / ${currentDxfs.length}`"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    isNotClickable
                    class="list-sheets__item"
                />
                <MainButton
                    :theme="themeType.primary"
                    :icon="iconType.arrowNext"
                    :size="sizeType.s"
                    :isLabelShow=false
                    :isDisable="activePart === currentDxfs.length - 1"
                    trackingTag="result_part_next"
                    @click="updatePartPage(activePart + 1)"
                    label="next"
                    class="controls__next"
                />
            </div>
            <div class="modal__wrapper">
                <div
                    v-if="isHaveError"
                    :class="placeholderClasses"
                    class="modal__placeholder"
                >
                    Err
                </div>
                <template v-else-if="resultModalData.isMultiSheet">
                    <DxfViewerComponent
                        :key="`dxf-${activeAlt}-${activePart}-${isFullScreen}`"
                        :dxfUrl="currentDxfs[activePart]"
                        :isFullScreen="isFullScreen"
                        :class="displayClasses"
                        class="modal__display"
                    />
                    <MainButton
                        class="modal__part-download"
                        v-if="resultModalData.isMultiSheet"
                        :href="currentDxfs[activePart]"
                        :label="`Download part ${activePart + 1}`"
                        tag="a"
                        :isDisable="isHaveError"
                        :size="sizeType.s"
                        :theme="themeType.primary"
                        trackingTag="result_part_download"
                    />
                </template>
                <DxfViewerComponent
                    v-else
                    :key="`dxf-${activeAlt}-0-${isFullScreen}`"
                    :dxfUrl="currentDxfs[0]"
                    :isFullScreen="isFullScreen"
                    :class="displayClasses"
                    class="modal__display"
                />
                <MainButton
                    v-if="!isHaveError"
                    label="fullscreen"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    :isLabelShow="false"
                    :icon="iconType.fullscreen"
                    trackingTag="result_fullscreen"
                    @click="updateFullScreen"
                    class="modal__fullscreen"
                />
            </div>
            <div class="modal__name modal__info info">
                <template v-if="isHaveError">
                    <span class="info__label">
                        No solution found try to increase plate size or reduce
                        requested object count
                    </span>
                    <span class="info__label">
                        {{ resultModalData.requested }} parts needed to be
                        placed
                    </span>
                    <span class="info__label">
                        {{ resultModalData.placed }} parts placed
                    </span>
                </template>
                <template v-else> 
                    {{ name }}
                </template>
            </div>
            <div
                v-if="!isHaveError"
                class="modal__info info"
            >
                <span
                    v-if="resultModalData.requested === resultModalData.placed"
                    class="info__label"
                >
                    All details are placed
                </span>
                <template v-else>
                    <span class="info__label">
                        {{ resultModalData.requested }} parts needed to be
                        placed
                    </span>
                    <span class="info__label">
                        {{ resultModalData.placed }} parts placed
                    </span>
                </template>
            </div>
            <div class="controls">
                <MainButton 
                    v-if="resultModalData.isMultiSheet" 
                    :href="resultModalData.zipDownloadUrl"
                    label="Download All"
                    tag="a"
                    :isDisable="isHaveError"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet"
                    :href="currentDxfs[0]"
                    label="Download"
                    tag="a"
                    download
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download"
                />
                <MainButton
                    label="Try again"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    trackingTag="result_try_again"
                    @click="resultDialog = false"
                />
            </div>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'
import { statusType } from '~~/constants/status.constants'
import { trackEvent } from '~/utils/track'
import { onMounted } from 'vue'

const { getters } = globalStore
const resultModalData = computed(() => getters.resultModalData)

const resultDialog = useResultDialog()

const isHaveError = computed(() => {
    return unref(resultModalData).status === statusType.failed
})
const isFullScreen = useFullScreen()
const updateFullScreen = () => {
    isFullScreen.value = !unref(isFullScreen)
    localStorage.setItem('isFullScreen', unref(isFullScreen))
}
onMounted(() => {
    activePart.value = 0
    isFullScreen.value = localStorage.getItem('isFullScreen') === 'true'
})

watch(resultDialog, (isOpen) => {
    if (isOpen) {
        activePart.value = 0
        activeAlt.value = 0
    }
})

// Alternative layouts (best density first). When empty (legacy jobs), the
// flat dxfs/svgs of the result are used.
const alternatives = computed(() => unref(resultModalData).alternatives || [])
const activeAlt = ref(0)
const currentDxfs = computed(() => {
    const alts = unref(alternatives)
    if (alts.length > 0 && alts[unref(activeAlt)]) {
        return alts[unref(activeAlt)].dxfs
    }
    return unref(resultModalData).dxfs || []
})
const selectAlt = (altId) => {
    activeAlt.value = altId
    activePart.value = 0
    trackEvent('result_alt_selected', { altId })
}
const formatDensity = (density) => {
    if (density == null) return '—'
    return `${(density * 100).toFixed(1)}%`
}
// Share of the sheet actually consumed by the layout (lower = better: the
// rest is a clean reusable offcut). Falls back to solver density on jobs
// run before the metric existed.
const formatScore = (alt) => {
    if (alt.usedSheetShare != null) return `${(alt.usedSheetShare * 100).toFixed(1)}% used`
    return formatDensity(alt.density)
}
const displayClasses = computed(() => ({
    'modal__display--is-fullscreen': unref(isFullScreen) && !unref(isHaveError)
}))
const placeholderClasses = computed(() => ({
    'modal__placeholder--is-fullscreen':
        unref(isFullScreen) && !unref(isHaveError)
}))
const name = computed(() => {
    const endPart = unref(resultModalData).isMultiSheet ? `.zip` : `.dxf ` 
    return unref(resultModalData).slug + endPart
})
const activePart = ref(0)
const updatePartPage = (partIndex) => {
    if (partIndex < 0 || partIndex >= unref(currentDxfs).length) return
    activePart.value = partIndex
}
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
    }

    &__fullscreen {
        display: none;

        @media (min-width: 567px) {
            position: absolute;
            top: 8px;
            right: 8px;
            display: block;
        }
    }

    &__display {
        cursor: pointer;
    }

    &__display,
    &__placeholder {
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

    &__placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-radius: 8px;
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-primary);
    }

    &__name {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
        margin-top: 10px;
        margin-bottom: 10px;
        min-height: 42px;
        color: var(--label-primary);
        margin-left: auto;
        margin-right: auto;
        word-break: break-all;

        @media (min-width: 567px) {
            max-width: 320px;
        }
    }

    &__info {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        color: var(--label-primary);

        &>* {
            margin-bottom: 10px;
        }
    }

    &__list-sheets {
        margin: -42px auto 5px;

        @media (min-width: 567px) {
            max-width: 300px;
        }
    }

    &__part-download {
        margin-left: auto;
        margin-right: auto;
        margin-top: 8px;
    }
}

.list-sheets {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;

    &__item {
        margin-left: 10px;
        margin-right: 10px;
    }
}
.alts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: -36px auto 12px;

    @media (min-width: 567px) {
        max-width: 420px;
    }

    &__tab {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--separator-secondary);
        background-color: var(--fill-tertiary);
        color: var(--label-secondary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.3s, background-color 0.3s;

        @media (hover:hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }

        &--active {
            color: var(--background-primary);
            background-color: var(--accent-primary);
            border-color: var(--accent-primary);
        }
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
