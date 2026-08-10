<template>
    <div class="result">
        <template v-if="isInProgress">
            <MainLoader :size="sizeType.s" :theme="themeType.secondary" class="result__display" />
            <p class="result__text">
                Nesting
            </p>
        </template>
        <template v-else>
            <div v-if="isFailed" class="result__placeholder">
                Err
            </div>
            <!-- D-PRV-10 : blobs purgés à 24 h → preview/téléchargement
                 masqués, mention « expiré ». -->
            <div v-else-if="result.purgedAt" class="result__placeholder">∅</div>
            <DxfViewerComponent
                v-else-if="result.dxfUrl"
                :size="sizeType.s"
                :dxfUrl="result.dxfUrl"
                class="result__display"
            />
            <p class="result__name">
                {{ result.slug }}.dxf
            </p>
            <p v-if="result.purgedAt" class="result__expired">
                {{ t('results.expired') }}
            </p>
        </template>
        <div class="result__meta">
            <span class="result__tag">H {{ fmtLength(result.height) }}</span>
            <span v-if="result.width != null" class="result__tag">W {{ roundedWidth }}</span>
            <span class="result__tag">{{ result.fileCount }} files</span>
        </div>
        <div class="result__controls controls">
            <MainButton
                v-if="canPreview"
                :href="result.dxfUrl"
                :label="t('results.download')" 
                tag="a"
                download
                :size="sizeType.s"
                :theme="themeType.primary"
                @click="onDownload"
            />
        </div>
        <div v-if="canPreview" @click="openModal()" class="result__area" />
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants';
import { themeType } from '~~/constants/theme.constants';
import { statusType } from '~~/constants/status.constants';
import { trackEvent } from '~/utils/track';

const { t } = useLocale()

const props = defineProps({
    result: {
        type: Object,
        required: true,
    },
});

const emit = defineEmits(['openModal']);

const isInProgress = computed(() => {
    const status = props.result?.status;
    return status === statusType.pending || status === statusType.unfinished;
});

const isFailed = computed(() => {
    const status = props.result?.status;
    return status === statusType.failed || status === 'error';
});

const canPreview = computed(() => Boolean(props.result?.dxfUrl) && !props.result?.purgedAt && !isInProgress.value && !isFailed.value);

const { fmtLength } = useUnit()
const roundedWidth = computed(() => fmtLength(props.result?.width ?? 0));

const openModal = () => {
    emit('openModal');
};

const onDownload = () => {
    trackEvent('click_download_button', {
        slug: props.result?.slug,
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

    &__display,
    &__placeholder {
        width: 100%;
        min-height: 120px;
        overflow: hidden;
        pointer-events: none;
    }

    &__placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        min-height: 40px;
        border-radius: 6px;
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-primary);
    }

    // D-PRV-10 : mention « expiré » (purge 24 h).
    &__expired {
        margin-top: 4px;
        font-size: 11px;
        color: var(--label-tertiary);
    }

    &__name {
        max-width: 240px;
        word-break: break-all;
        margin-top: 10px;
        color: var(--label-secondary);
        transition: color 0.3s;
    }

    &__text {
        margin-top: 10px;
        color: var(--label-secondary);

        &::after {
            content: '';
            animation: dots 2s infinite linear;
        }
    }

    &__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
    }

    &__tag {
        font-size: 12px;
        color: var(--label-tertiary);
        background-color: var(--fill-tertiary);
        border-radius: 4px;
        padding: 2px 8px;
    }

    &__controls {
        z-index: 1;
        position: absolute;
        top: 8px;
        right: 8px;
    }

    &__area {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        cursor: pointer;
    }

    @media (hover: hover) {
        &:hover {
            border-color: var(--separator-primary);

            #{$self}__name {
                color: var(--label-primary);
            }
        }
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
</style>
