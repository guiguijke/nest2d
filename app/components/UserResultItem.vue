<template>
    <div class="result">
        <template v-if="isResultNexting">
            <MainLoader 
                :size="sizeType.s" 
                :theme="themeType.secondary" 
                class="result__display"
            />
            <template v-if="progress">
                <p class="result__text result__text--stage">
                    {{ stageLabel }}
                </p>
                <div class="result__progress progress">
                    <div
                        class="progress__bar"
                        :style="{ width: `${progressPercent}%` }"
                    />
                </div>
                <p class="result__text result__text--count">
                    {{ progressPercent }}%<template v-if="showDoneTotal"> · {{ progress.done }}/{{ progress.total }}</template><template v-if="progress.elapsed_sec != null"> · {{ formatElapsed(progress.elapsed_sec) }}</template>
                </p>
            </template>
            <p v-else class="result__text">
                {{ t('results.nesting') }}
            </p>
        </template>
        <template v-else>
            <div v-if="isResultFailed" class="result__placeholder">
                Err
            </div>
            <template v-else>
                <div 
                    :class="svgRowClasses"
                    class="result__svg-row"
                >
                    <SvgDisplay 
                        v-for="(svg, svgIndex) in result.svgs" 
                        :key="`svg-${svgIndex}`" 
                        :src="svg"
                        :size="sizeType.s"
                        class="result__display" 
                    />
                </div>
            </template>
            <p class="result__name">
                {{ result.slug }}.dxf
            </p>
            <div class="result__controls controls">
                <MainButton 
                    v-if="isResultCompleted" 
                    :href="downloadUrl" 
                    :label="downloadButtonText" 
                    tag="a"
                    :size="sizeType.s" 
                    :theme="themeType.primary" 
                    class="controls__download" 
                    @click="onDownload" 
                />
            </div>
            <button 
                type="button"
                @click="openModal" 
                class="result__area" 
                aria-label="Open result details"
            />
        </template>
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants';
import { themeType } from '~~/constants/theme.constants';
import { statusType } from "~~/constants/status.constants";
import { trackEvent } from '~/utils/track';
import { computed } from "vue";

const props = defineProps({
    result: {
        type: Object,
        required: true
    }
});

const emit = defineEmits(["openModal"]);

const { t } = useLocale();

const isMultiSheet = computed(() => {
    return props.result?.isMultiSheet ?? false;
});

const downloadUrl = computed(() => {
    return props.result?.downloadUrl ?? '';
});

const downloadButtonText = computed(() => {
    return isMultiSheet.value ? 'Download All' : 'Download';
});

const hasMultipleSvgs = computed(() => {
    return (props.result?.svgs?.length ?? 0) > 1;
});

const svgRowClasses = computed(() => {
    return ['result__svg-row', { 'result__svg-row--multi': hasMultipleSvgs.value }];
});

const isResultNexting = computed(() => {
    const status = props.result?.status;
    return status === statusType.unfinished || status === statusType.pending;
});

// Live progress pushed by the nesting worker ({stage, label, done, total}).
const progress = computed(() => {
    const p = props.result?.progress;
    return p && p.total > 0 ? p : null;
});

const progressPercent = computed(() => {
    if (!progress.value) return 0;
    // Live percentage from the engine's time budget when available.
    if (progress.value.pct != null) return Math.min(100, progress.value.pct);
    return Math.min(100, Math.round((progress.value.done / progress.value.total) * 100));
});

// Stage label: translated when we know the stage, worker-provided label
// otherwise (forward-compatible with future stages).
const stageLabel = computed(() => {
    const p = progress.value;
    if (!p) return '';
    const key = `progress.stage.${p.stage}`;
    const translated = t(key);
    return translated === key ? (p.label || key) : translated;
});

// done/total duplicates the elapsed seconds for engine-driven jobs (pct
// present) — only show it for count-based progress (legacy readers).
const showDoneTotal = computed(() => {
    return progress.value && progress.value.pct == null;
});

const formatElapsed = (sec) => {
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m${String(sec % 60).padStart(2, '0')}`;
};

const isResultFailed = computed(() => {
    return props.result?.status === statusType.failed;
});

const isResultCompleted = computed(() => {
    const status = props.result?.status;
    return status === statusType.completed || status === statusType.done;
});

const openModal = () => {
    emit('openModal');
};

const onDownload = () => {
    trackEvent('click_download_button', {
        slug: props.result?.slug,
        isMultiSheet: isMultiSheet.value
    });
};
</script>
<style lang="scss" scoped>
.result {
    $self: &;
    position: relative;
    display: block;
    padding: 15px;
    border: 1px solid var(--separator-secondary);
    border-radius: 8px;
    transition: border-color 0.3s;

    &__svg-row {
        max-width: 128px;
        display: grid;
        grid-template-columns: 1fr;
        gap: 4px;
        margin-bottom: 8px;

        &--multi {
            grid-template-columns: repeat(3, 1fr);
        }
    }

    &__display,
    &__placeholder {
        width: 40px;
        height: 40px;
        min-height: 40px;
        overflow: hidden;
    }

    &__placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-radius: 6px;
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-primary);
    }

    &__name {
        max-width: 240px;
        word-break: break-all;
    }

    &__name,
    &__text {
        margin-top: 10px;
        color: var(--label-secondary);
        transition: color 0.3s;
    }

    &__text {
        &::after {
            content: '';
            animation: dots 2s infinite linear;
        }

        &--stage {
            font-weight: 600;
            color: var(--label-primary);

            &::after {
                content: none;
            }
        }

        &--count {
            font-size: 12px;
            font-variant-numeric: tabular-nums;

            &::after {
                content: none;
            }
        }
    }

    &__progress {
        margin-top: 8px;
    }

    &__area {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        cursor: pointer;
        border: none;
        background: transparent;
        padding: 0;
    }

    &__controls {
        z-index: 1;
        position: absolute;
        top: 8px;
        right: 8px;
    }

    @media (hover:hover) {
        &:hover {
            .controls {
                &__delete {
                    opacity: 1;
                }
            }

            border-color: var(--separator-primary);

            #{$self}__name {
                color: var(--label-primary);
            }
        }
    }
}

.progress {
    height: 6px;
    border-radius: 3px;
    background-color: var(--fill-tertiary);
    overflow: hidden;

    &__bar {
        height: 100%;
        border-radius: 3px;
        background-color: var(--accent-primary);
        transition: width 0.6s ease;
    }
}

@keyframes dots {
    0% {
        content: '';
    }

    33.33% {
        content: '.';
    }

    66.66% {
        content: '..';
    }

    100% {
        content: '...';
    }
}

.controls {
    display: flex;
    align-items: center;

    &__delete {
        opacity: 0;
        transition: opacity 0.3s;
    }

    &__download {
        margin-left: 5px;
    }
}
</style>
