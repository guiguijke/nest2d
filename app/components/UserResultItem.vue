<template>
    <div class="result">
        <template v-if="isResultNexting">
            <MainLoader
                :size="sizeType.s"
                :theme="themeType.secondary"
                class="result__display"
            />
            <template v-if="progress">
                <div class="result__progress progress">
                    <div
                        class="progress__bar"
                        :style="{ width: `${progressPercent}%` }"
                    />
                </div>
                <p class="result__text result__text--count">
                    <CoresSpinner
                        v-if="cores"
                        :cores="cores"
                        :size="14"
                        class="result__cores"
                    />
                    {{ progressPercent }}%<template v-if="progress.elapsed_sec != null"> · {{ formatElapsed(progress.elapsed_sec) }}</template>
                </p>
            </template>
            <p v-else class="result__text">
                {{ t('results.nesting') }}
            </p>
            <button
                class="result__cancel"
                :disabled="cancelling"
                :title="t('results.cancel')"
                @click.stop="cancelNesting"
            >
                {{ cancelling ? t('results.cancelling') : t('results.cancel') }}
            </button>
        </template>
        <template v-else>
            <div v-if="isResultFailed" class="result__placeholder" :title="result.information || undefined">
                {{ failureTitle }}
            </div>
            <template v-else>
                <div
                    v-if="!result.purgedAt"
                    :class="svgRowClasses"
                    class="result__svg-row"
                >
                    <SheetSvgPreview
                        v-for="(svg, svgIndex) in result.svgs"
                        :key="`svg-${svgIndex}`"
                        :src="svg"
                        :width="sheetSizeAt(svgIndex).w"
                        :height="sheetSizeAt(svgIndex).h"
                        class="result__display"
                    />
                </div>
                <div v-else class="result__placeholder" :title="t('results.expired')" />
            </template>
            <p class="result__name">
                {{ resultTitle }}
                <PrivacyChip
                    v-if="privacyMode"
                    :mode="privacyMode"
                    class="result__chip"
                />
            </p>
            <p v-if="timeAgo" class="result__when">
                {{ timeAgo }}
            </p>
            <p v-if="isLocal" class="result__local" :title="t('localMode.done')">
                {{ t('localMode.done') }}
            </p>
            <!-- D-PRV-10 : blobs résultats purgés à 24 h — téléchargements
                 masqués, le rapport (scalaires) reste consultable. -->
            <p v-if="result.purgedAt" class="result__expired">
                {{ t('results.expired') }}
            </p>
            <div class="result__controls controls">
                <MainButton
                    v-if="hasReport"
                    :label="t('result.nestingReport')"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    class="controls__report"
                    @click="openReport"
                />
                <!-- Job serveur : href GridFS. Job local (J-082) : contenus
                     persistés en IndexedDB, téléchargement 100 % navigateur. -->
                <MainButton
                    v-if="isResultCompleted && !isLocal && !result.purgedAt"
                    :href="downloadUrl"
                    :label="downloadButtonText"
                    tag="a"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    class="controls__download"
                    @click="onDownload"
                />
                <MainButton
                    v-if="isResultCompleted && isLocal"
                    :label="downloadButtonText"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    class="controls__download"
                    @click="downloadLocal"
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
import { altDensityPctOf } from '~/utils/resultQuality';
import { computed, ref } from "vue";

const props = defineProps({
    result: {
        type: Object,
        required: true
    },
    privacyMode: {
        type: String,
        default: null,
    },
});

const emit = defineEmits(["openModal"]);

const { t } = useLocale();

// Cancel a running nesting: asks the API to flag the job; the worker kills
// the engine within ~2s and the SSE stream updates the card to failed with
// the cancellation note.
const cancelling = ref(false);
const cancelNesting = async () => {
    if (cancelling.value) return;
    cancelling.value = true;
    try {
        // R-3 (audit 2026-08-31 §R-2) : passer par le REGISTRE de solves
        // locaux — cancelJob fait le POST /cancel (le serveur finalise +
        // refund, le worker tue l'engine sous ~2 s), termine les pools par
        // PRÉFIXE (zones du pass structurel comprises) ET retire un
        // éventuel job EN FILE (l'ancien chemin POST+cancelPool ne voyait
        // pas la file : le job relancé par pump() échouait ensuite en 409
        // avec un bandeau d'erreur mensonger sur un job annulé).
        const { cancelJob } = await import('~/composables/localSolverRegistry');
        await cancelJob(props.result.slug);
        // AA2 (vérif L1 2026-09-05) : annulation depuis la carte — le bouton
        // Nest doit redevenir actif avec les MÊMES paramètres.
        const { filesStore } = await import('~/composables/files');
        filesStore.actions.resetLastParams();
    } catch (e) {
        console.warn('cancel failed', e);
        cancelling.value = false;
    }
};

const isMultiSheet = computed(() => {
    return props.result?.isMultiSheet ?? false;
});

// J-082 : résultat hydraté depuis IndexedDB (Mode Local productisé) — les
// artefacts ne viennent JAMAIS du serveur pour ces jobs.
const isLocal = computed(() => Boolean(props.result?.isLocal));

const downloadLocal = () => {
    const record = props.result?.localRecord;
    if (!record) return;
    trackEvent('click_download_button', {
        slug: props.result?.slug,
        isMultiSheet: isMultiSheet.value,
        isLocal: true,
    });
    try {
        downloadLocalResult(record);
    } catch (e) {
        console.warn('local download failed', e);
    }
};

const downloadUrl = computed(() => {
    return props.result?.downloadUrl ?? '';
});

const downloadButtonText = computed(() => {
    return isMultiSheet.value ? t('results.downloadAll') : t('results.download');
});

const hasMultipleSvgs = computed(() => {
    return (props.result?.svgs?.length ?? 0) > 1;
});

const sheetSizeAt = (index) => {
    const sheets = props.result?.alternatives?.[0]?.report?.sheets
    const s = Array.isArray(sheets) ? sheets[index] || sheets[0] : null
    if (s?.widthMm && s?.heightMm) return { w: s.widthMm, h: s.heightMm }
    return { w: 0, h: 0 }
}

const svgRowClasses = computed(() => {
    return ['result__svg-row', { 'result__svg-row--multi': hasMultipleSvgs.value }];
});

const isResultNexting = computed(() => {
    const status = props.result?.status;
    // C01 (audit UX 2026-09-05) : awaiting_local = calcul navigateur EN
    // COURS — carte « en cours » (loader + Annuler), pas « échec fantôme ».
    return status === statusType.unfinished
        || status === statusType.pending
        || status === statusType.awaitingLocal;
});

// Live progress pushed by the nesting worker ({stage, label, done, total}).
const progress = computed(() => {
    const p = props.result?.progress;
    return p && p.total > 0 ? p : null;
});

// Vcores at work on this job (tier compute profile); null on legacy jobs.
const cores = computed(() => {
    const n = props.result?.compute?.vcores;
    return n ? Math.min(8, Math.max(1, Number(n) || 1)) : null;
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

const primaryAlt = computed(() => {
    const alts = props.result?.alternatives
    return Array.isArray(alts) && alts.length ? alts[0] : null
})

const isNoFit = computed(() => {
    const info = String(props.result?.information || '')
    return /no feasible solution|Not all items could be placed/i.test(info)
})
const failureTitle = computed(() =>
    isNoFit.value ? t('result.failed.nofit') : t('result.failed')
)

const resultTitle = computed(() => {
    if (isResultFailed.value) {
        return isNoFit.value ? t('result.failed.nofitHint') : t('result.failed')
    }
    const alt = primaryAlt.value
    // AA1 (vérif L1 2026-09-05) : densité MESURÉE du rapport vérifié —
    // même définition pour toutes les options ; plus jamais « % used ».
    const densityPct = altDensityPctOf(alt)
    const densityLabel = densityPct != null
        ? `${densityPct.toFixed(1)}% ${t('result.densityShort')}`
        : t('results.title')
    const sheetN = alt?.layoutCount
        || (props.result?.isMultiSheet ? (props.result?.svgs?.length || 0) : 1)
    // Plan 2026-09-05 §1.2c : un résultat unfit (hors tôle mesuré) est
    // étiqueté « ne tient pas » — jamais « Results · 1 sheet ».
    const r0 = props.result?.alternatives?.[0]?.report
    if (r0 && (r0.insideSheet === false || r0.overlapFree === false
        || (r0.duplicatePoses || 0) > 0)) {
        return t('results.unfit')
    }
    const sheetsLabel = sheetN === 1
        ? t('result.sheetCountOne')
        : t('result.sheetCount', { n: sheetN })
    return `${densityLabel} · ${sheetsLabel}`
})

const timeAgo = computed(() => {
    const raw = props.result?.createdAt
    if (!raw) return ''
    const past = new Date(raw)
    if (Number.isNaN(past.getTime())) return ''
    const diffMinutes = Math.floor((Date.now() - past.getTime()) / 60000)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffMinutes / 1440)
    if (diffMinutes < 1) return t('time.justNow')
    if (diffHours >= 1 && diffHours < 24) return t('time.hoursAgo', { n: diffHours })
    if (diffDays >= 1) return diffDays === 1 ? t('time.dayAgo') : t('time.daysAgo', { n: diffDays })
    return t('time.minAgo', { n: diffMinutes })
})

const isResultCompleted = computed(() => {
    const status = props.result?.status;
    return status === statusType.completed || status === statusType.done;
});

const openModal = () => {
    emit('openModal');
};

// Quoting report (per-sheet measured metrics) available on this result?
// Drives the dedicated "Nesting report" button: it opens the same result
// modal but scrolled straight to the report block.
const hasReport = computed(() => {
    if (!isResultCompleted.value) return false;
    return (props.result?.alternatives || []).some(
        (alt) => Array.isArray(alt?.report?.sheets) && alt.report.sheets.length > 0
    );
});

const scrollToReport = useResultScrollToReport();
const openReport = () => {
    scrollToReport.value = true;
    trackEvent('click_nesting_report_button', { slug: props.result?.slug });
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
    padding: 14px;
    border: 1px solid var(--separator-secondary);
    border-radius: 12px;
    transition: border-color 0.3s;

    &__cancel {
        margin-top: 8px;
        padding: 3px 10px;
        font-size: 11px;
        border: 1px solid var(--separator-secondary);
        border-radius: 6px;
        color: var(--label-secondary);
        background: transparent;
        cursor: pointer;
        transition: color 0.2s, border-color 0.2s;

        &:hover:not(:disabled) {
            color: var(--system-red, #d32f2f);
            border-color: var(--system-red, #d32f2f);
        }

        &:disabled {
            opacity: 0.5;
            cursor: default;
        }
    }

    &__svg-row {
        max-width: 160px;
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
        width: 72px;
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
        font-size: 10px;
        font-weight: 700;
        padding: 4px;
        line-height: 1.2;
        width: auto;
        min-width: 40px;
        max-width: 120px;
        height: auto;
        min-height: 40px;
    }

    &__name {
        max-width: 240px;
        word-break: break-word;
        font-weight: 600;
        color: var(--label-primary);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }

    &__when {
        margin-top: 4px;
        font-size: 12px;
        color: var(--label-tertiary);
    }

    // J-082 : mention « calculé localement » des jobs Mode Local.
    &__local {
        margin-top: 4px;
        font-size: 11px;
        color: var(--label-tertiary);
    }

    // D-PRV-10 : mention « expiré » des résultats purgés (24 h).
    &__expired {
        margin-top: 4px;
        font-size: 11px;
        color: var(--label-tertiary);
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

    &__report {
        margin-right: 5px;
    }
}
</style>
