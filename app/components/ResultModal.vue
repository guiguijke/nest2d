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
                    :title="altTitle(alt)"
                    @click="selectAlt(alt.altId)"
                >
                    <span v-if="alt.strategy" class="alts__strategy">{{ strategyLabel(alt.strategy) }}</span>
                    {{ t('result.option', { n: alt.altId + 1 }) }} · {{ altQualityLine(alt) }}
                </button>
            </div>
            <!-- C02 (audit UX 2026-09-05) : pourquoi l'option 1 est
                 proposée en premier. AA1 (vérif L1) : la raison doit être
                 VRAIE — « plus grande chute propre » seulement si la chute
                 du rang 0 est bien maximale, sinon la régularité des
                 rangées. -->
            <p v-if="whyFirstLine" class="alts__why">
                {{ whyFirstLine }}
            </p>
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
                    :label="t('result.sheet', { n: activePart + 1, total: currentDxfs.length })"
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
            <div
                v-if="!isHaveError"
                class="modal__headline headline"
            >
                <p class="headline__title">{{ headlineTitle }}</p>
                <!-- C02 : sous-titre explicatif de la méthode d'agencement
                     (Grille vs Compaction). -->
                <p v-if="activeStrategyExplain" class="headline__explain">
                    {{ activeStrategyExplain }}
                </p>
                <p class="headline__slug" :title="t('result.copySlug')">{{ name }}</p>
            </div>
            <div
                v-if="!isHaveError && activeReport && densityPct != null"
                class="modal__summary summary"
            >
                <span class="summary__label">{{ t('result.densityFull') }}</span>
                <div class="summary__bar">
                    <div class="summary__bar-fill" :style="{ width: `${densityPct}%` }" />
                </div>
                <span class="summary__value">{{ densityPct.toFixed(1) }}%</span>
            </div>
            <div
                v-if="hasColorPreview"
                class="view-toggle"
            >
                <button
                    class="view-toggle__btn"
                    :class="{ 'view-toggle__btn--active': viewMode === 'color' }"
                    tracking-tag="result_view_color"
                    @click="selectViewMode('color')"
                >
                    {{ t('result.colorView') }}
                </button>
                <button
                    class="view-toggle__btn"
                    :class="{ 'view-toggle__btn--active': viewMode === 'dxf' }"
                    tracking-tag="result_view_dxf"
                    @click="selectViewMode('dxf')"
                >
                    {{ t('result.dxfView') }}
                </button>
            </div>
            <div class="modal__wrapper">
                <LiveNestingView
                    v-if="isInProgress && resultModalData.liveLayout"
                    :result="resultModalData"
                    class="modal__live"
                />
                <div
                    v-else-if="isHaveError"
                    :class="placeholderClasses"
                    class="modal__placeholder"
                >
                    {{ t('result.failed') }}
                </div>
                <template v-else-if="resultModalData.isMultiSheet">
                    <SheetSvgPreview
                        v-if="showColorPreview"
                        :key="`svg-${activeAlt}-${activePart}`"
                        :src="currentSvgs[activePart]"
                        :width="previewSheet.w"
                        :height="previewSheet.h"
                        :class="displayClasses"
                        class="modal__display modal__svg-preview"
                    />
                    <DxfViewerComponent
                        v-else
                        :key="`dxf-${activeAlt}-${activePart}-${isFullScreen}`"
                        :dxfUrl="currentDxfs[activePart]"
                        :isFullScreen="isFullScreen"
                        :class="displayClasses"
                        class="modal__display"
                    />
                    <MainButton
                        class="modal__part-download"
                        v-if="resultModalData.isMultiSheet && !isLocal"
                        :href="currentDxfs[activePart]"
                        :label="t('result.downloadSheet', { n: activePart + 1 })"
                        tag="a"
                        :isDisable="isHaveError || isUnfit"
                        :size="sizeType.s"
                        :theme="themeType.primary"
                        trackingTag="result_part_download"
                    />
                    <MainButton
                        class="modal__part-download"
                        v-if="resultModalData.isMultiSheet && isLocal"
                        :label="t('result.downloadSheet', { n: activePart + 1 })"
                        :isDisable="isHaveError || isUnfit"
                        :size="sizeType.s"
                        :theme="themeType.primary"
                        trackingTag="result_part_download"
                        @click="downloadLocalSheet"
                    />
                </template>
                <SheetSvgPreview
                    v-else-if="showColorPreview"
                    :key="`svg-${activeAlt}-0`"
                    :src="currentSvgs[0]"
                    :width="previewSheet.w"
                    :height="previewSheet.h"
                    :class="displayClasses"
                    class="modal__display modal__svg-preview"
                />
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
            <div v-if="isHaveError" class="modal__name modal__info info">
                <span class="info__label">
                    {{ t('result.noSolution') }}
                </span>
                <span v-if="resultModalData.information" class="info__label info__label--detail">
                    {{ resultModalData.information }}
                </span>
                <span class="info__label">
                    {{ t('result.neededToPlace', { n: resultModalData.requested }) }}
                </span>
                <span class="info__label">
                    {{ t('result.placed', { n: resultModalData.placed }) }}
                </span>
            </div>
            <div
                v-if="!isHaveError"
                class="modal__info info"
            >
                <span
                    v-if="resultModalData.requested === resultModalData.placed"
                    class="info__label"
                >
                    {{ t('result.allPlaced') }}
                </span>
                <template v-else>
                    <span class="info__label">
                        {{ t('result.neededToPlace', { n: resultModalData.requested }) }}
                    </span>
                    <span class="info__label">
                        {{ t('result.placed', { n: resultModalData.placed }) }}
                    </span>
                </template>
            </div>
            <div
                v-if="!isHaveError && activeReport"
                ref="reportEl"
                class="modal__report report"
            >
                <div class="report__row">
                    <span class="report__label">{{ t('result.densityFull') }}</span>
                    <div class="report__bar">
                        <div
                            class="report__bar-fill"
                            :style="{ width: `${densityPct != null ? densityPct : 0}%` }"
                        />
                    </div>
                    <span class="report__value">{{ densityPct != null ? densityPct.toFixed(1) + '%' : '—' }}</span>
                </div>
                <div class="report__row report__row--detail">
                    <span>{{ t('report.areas', { parts: fmtArea(activeReport.partsAreaMm2), free: fmtArea(freeAreaMm2) }) }}</span>
                    <span v-if="activeReportOffcut" class="report__offcut">
                        {{ t('report.offcut', { w: fmtLengthValue(activeReportOffcut.widthMm), h: fmtLengthValue(activeReportOffcut.heightMm), unit: unitLabel }) }}
                        · {{ fmtArea(activeReportOffcut.areaMm2) }}
                        <span
                            class="report__badge"
                            :class="{ 'report__badge--scrap': !activeReportOffcut.reusable }"
                        >
                            {{ activeReportOffcut.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap') }}
                        </span>
                        <span class="report__hint">&nbsp;({{ t('report.offcut.atLeast') }})</span>
                    </span>
                    <span v-else-if="activeOffcut">{{ t('report.offcut', { w: fmtLengthValue(activeOffcut.width), h: fmtLengthValue(activeOffcut.height), unit: unitLabel }) }}</span>
                </div>
                <div
                    v-if="reportTotals"
                    class="report__row report__row--detail report__material"
                >
                    <span class="report__label">{{ t('report.material') }}</span>
                    <span class="report__value">{{ materialFormats }}</span>
                </div>
                <div
                    v-if="reportSheets.length"
                    class="report__table-wrap"
                >
                    <table class="report__table">
                        <thead>
                            <tr>
                                <th>{{ t('report.sheet.num') }}</th>
                                <th>{{ t('report.sheet.format') }}</th>
                                <th>{{ t('report.sheet.parts') }}</th>
                                <th>{{ t('report.sheet.used') }}</th>
                                <th>{{ t('report.sheet.free') }}</th>
                                <th>{{ t('report.sheet.density') }}</th>
                                <th>{{ t('report.sheet.offcut') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in reportSheets" :key="s.index">
                                <td>{{ s.index + 1 }}</td>
                                <td>{{ fmtLength(s.widthMm) }} × {{ fmtLength(s.heightMm) }}</td>
                                <td>{{ s.partCount }}</td>
                                <td>
                                    <span class="report__area">{{ fmtAreaStacked(s.partsAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.partsAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.partsAreaMm2).sub }}</span>
                                </td>
                                <td>
                                    <span class="report__area">{{ fmtAreaStacked(s.freeAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.freeAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.freeAreaMm2).sub }}</span>
                                </td>
                                <td>{{ s.densityPct != null ? s.densityPct.toFixed(1) + '%' : '—' }}</td>
                                <td>
                                    <template v-if="s.offcut">
                                        {{ fmtLengthValue(s.offcut.widthMm) }} × {{ fmtLengthValue(s.offcut.heightMm) }} {{ unitLabel }}
                                        <span
                                            class="report__badge"
                                            :class="{ 'report__badge--scrap': !s.offcut.reusable }"
                                        >
                                            {{ s.offcut.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap') }}
                                        </span>
                                    </template>
                                    <span v-else>—</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div
                    v-if="activeReport.holesFilled > 0"
                    class="report__row report__row--detail"
                >
                    <span>{{ t('report.holesFilled', { n: activeReport.holesFilled }) }}</span>
                </div>
                <!-- Plan 2026-09-05 §1.2c : verdict unique — un résultat non
                     découpage n'affiche JAMAIS de badge vert. -->
                <div v-if="isUnfit" class="report__unfit">
                    <div class="report__unfit-title">{{ t('report.unfit.title') }}</div>
                    <div class="report__unfit-detail">
                        {{ t('report.unfit.detail', {
                            n: unfitData.overflowMm != null
                                ? fmtLengthValue(unfitData.overflowMm, unitLabel.value === '"' ? 4 : 2)
                                : null,
                            unit: unitLabel,
                        }) }}
                    </div>
                    <ul class="report__unfit-levers">
                        <li v-if="unfitData.sheetsNeeded">
                            {{ t('report.unfit.sheetsNeeded', { n: unfitData.sheetsNeeded }) }}
                        </li>
                        <li v-if="unfitData.maxParts != null">
                            {{ t('report.unfit.maxParts', { n: unfitData.maxParts }) }}
                        </li>
                        <li v-if="unfitData.maxSpacingMm != null">
                            {{ t('report.unfit.maxSpacing', { v: unfitData.maxSpacingMm }) }}
                        </li>
                    </ul>
                    <div class="report__unfit-actions">
                        <MainButton
                            :label="t('report.unfit.addSheet')"
                            :size="sizeType.s"
                            :theme="themeType.primary"
                            @click="$emit('unfit-add-sheet')"
                        />
                        <MainButton
                            v-if="unfitData.maxSpacingMm != null"
                            :label="t('report.unfit.reduceSpacing', { v: unfitData.maxSpacingMm })"
                            :size="sizeType.s"
                            :theme="themeType.secondary"
                            @click="$emit('unfit-reduce-spacing', unfitData.maxSpacingMm)"
                        />
                    </div>
                </div>
                <!-- Z3 (vérif 2026-09-05) : solution partielle UTILE — le
                     résultat posé est découpage (pas de rouge), mais
                     l'utilisateur sait quoi faire du reste : leviers sous le
                     badge « n pièces non placées ». -->
                <div
                    v-if="isPartial && partialHasLevers"
                    class="report__partial"
                    data-testid="report-partial"
                >
                    <div class="report__partial-title">
                        {{ t('report.partial.title', {
                            n: partialUnplacedCount,
                        }) }}
                    </div>
                    <div class="report__partial-detail">{{ t('report.partial.detail') }}</div>
                    <ul class="report__unfit-levers">
                        <li v-if="unfitData.sheetsNeeded">
                            {{ t('report.unfit.sheetsNeeded', { n: unfitData.sheetsNeeded }) }}
                        </li>
                        <li v-if="unfitData.maxParts != null">
                            {{ t('report.unfit.maxParts', { n: unfitData.maxParts }) }}
                        </li>
                        <li v-if="unfitData.maxSpacingMm != null">
                            {{ t('report.unfit.maxSpacing', { v: unfitData.maxSpacingMm }) }}
                        </li>
                    </ul>
                    <div class="report__unfit-actions">
                        <MainButton
                            v-if="unfitData.sheetsNeeded"
                            :label="t('report.unfit.addSheet')"
                            :size="sizeType.s"
                            :theme="themeType.primary"
                            @click="$emit('unfit-add-sheet')"
                        />
                        <MainButton
                            v-if="unfitData.maxSpacingMm != null"
                            :label="t('report.unfit.reduceSpacing', { v: unfitData.maxSpacingMm })"
                            :size="sizeType.s"
                            :theme="themeType.secondary"
                            @click="$emit('unfit-reduce-spacing', unfitData.maxSpacingMm)"
                        />
                    </div>
                </div>
                <div class="report__badges">
                    <span
                        v-for="badge in reportBadges"
                        :key="badge.label"
                        class="report__badge"
                        :class="{ 'report__badge--ko': badge.ok === false }"
                    >
                        {{ badge.ok === false ? '✗' : '✓' }} {{ badge.label }}
                    </span>
                </div>
                <!-- C03/C12 (audit UX 2026-09-05) : le post-pass (rollback
                     compris) et les paramètres moteur ne sont plus des
                     badges — un résultat découpable n'affiche JAMAIS de
                     rouge « Post-pass … rollback ». Ils vivent repliés
                     dans les détails techniques ; seed/cores absents
                     masqués ; « combinations tested » reformulé honnêtement
                     (ce sont les itérations du recuit moteur). -->
                <details v-if="hasTechDetails" class="report__tech" data-testid="report-tech">
                    <summary>{{ t('report.techDetails') }}</summary>
                    <!-- AB2 (L2-bis) : une option écartée au filet final
                         n'est plus perdue en silence — info repliée. -->
                    <p v-if="discardedCount" class="report__tech-line" data-testid="report-discarded">
                        {{ t('report.discarded', { n: discardedCount }) }}
                    </p>
                    <div class="report__engine">
                        nest-engine<template v-if="activeAltSeed"> · seed {{ activeAltSeed }}</template>
                        <template v-if="activeReport.iterations"> · {{ activeReport.iterations === 1 ? t('report.iterationsOne') : t('report.iterations', { n: activeReport.iterations }) }}</template>
                        <template v-if="activeReport.vcores"> · {{ activeReport.vcores === 1 ? t('report.coresOne') : t('report.cores', { n: activeReport.vcores }) }}</template>
                    </div>
                    <p v-for="(line, i) in postPassLines" :key="i" class="report__tech-line">
                        {{ line }}
                    </p>
                </details>
            </div>
            <div class="controls">
                <MainButton
                    v-if="reportSheets.length"
                    :label="exportLocked ? t('report.exportLocked') : (copied ? t('report.copied') : t('report.copy'))"
                    :icon="exportLocked ? iconType.lock : undefined"
                    :isDisable="exportDisabled"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    trackingTag="report_copy"
                    @click="onExportClick(copyReport, 'report_copy_locked_click')"
                />
                <MainButton
                    v-if="reportSheets.length"
                    :label="exportLocked ? t('report.exportLocked') : t('report.csv')"
                    :icon="exportLocked ? iconType.lock : undefined"
                    :isDisable="exportDisabled"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    trackingTag="report_csv"
                    @click="onExportClick(exportCsv, 'report_csv_locked_click')"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && !isLocal"
                    :href="resultModalData.zipDownloadUrl"
                    :label="t('results.downloadAll')"
                    tag="a"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && isLocal"
                    :label="t('results.downloadAll')"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                    @click="downloadLocalAll"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet && !isLocal"
                    :href="currentDxfs[0]"
                    :label="t('results.download')"
                    tag="a"
                    download
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet && isLocal"
                    :label="t('results.download')"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download"
                    @click="downloadLocalSingle"
                />
                <MainButton
                    :label="t('result.tryAgain')"
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
import { altDensityPctOf, whyFirstKind } from '~/utils/resultQuality'
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'
import { statusType } from '~~/constants/status.constants'
import { trackEvent } from '~/utils/track'
import { SQMM_PER_SQIN } from '~/utils/units'
import { displayDirectionArrow } from '~/utils/sheetView'
import { onMounted, nextTick } from 'vue'
import { reportExportState } from '~/utils/reportExport'

// Z1/Z3 (vérif 2026-09-05) : actions correctives des bandeaux unfit /
// partiel — écoutées par UserResults (ajout tôle / réduction espacement).
const emit = defineEmits(['unfit-add-sheet', 'unfit-reduce-spacing'])

const { getters } = globalStore
const resultModalData = computed(() => getters.resultModalData)
const { t } = useLocale()
const { unit, fmtArea, fmtLength, fmtLengthValue, unitLabel } = useUnit()

// J-082 : job Mode Local hydraté depuis IndexedDB — les téléchargements
// passent par les contenus persistés (localDownloads), jamais par une URL
// serveur (il n'y a pas de fichiers GridFS pour ces jobs).
const isLocal = computed(() => Boolean(unref(resultModalData)?.isLocal))
const localRecord = computed(() => unref(resultModalData)?.localRecord || null)
const downloadLocalSingle = () => {
    try {
        downloadLocalDxf(unref(localRecord), unref(activeAlt), 0)
    } catch (e) {
        console.warn('local download failed', e)
    }
}
const downloadLocalSheet = () => {
    try {
        downloadLocalDxf(unref(localRecord), unref(activeAlt), unref(activePart))
    } catch (e) {
        console.warn('local download failed', e)
    }
}
const downloadLocalAll = () => {
    try {
        downloadLocalZip(unref(localRecord))
    } catch (e) {
        console.warn('local download failed', e)
    }
}

// Report export gating (D-RAP-11): content visible on every plan; exports
// (copy / CSV) are Unlimited+. COMMERCIAL gate, 100% client-side — the
// report is on screen anyway, a free user could retype the numbers (A3).
// Plan from the already-loaded user payload (J-044), never a new endpoint.
// useNuxtData returns { data: Ref } — destructure it (same pattern as
// useUnit.js); unref'ing the wrapper itself never sees .compute and locks
// every tier, paid included.
const { data: userData } = useNuxtData('user')
const exportState = computed(() =>
    reportExportState(
        unref(userData)?.compute?.level ?? null,
        useRuntimeConfig().public.paidPlansDisabled === true,
    )
)
const exportLocked = computed(() => unref(exportState) === 'locked')
const exportDisabled = computed(() => unref(exportState) === 'disabled')
const buyCreditsDialog = useBuyCreditsDialog()
// Locked state: the click opens the EXISTING paywall dialog (explicit label
// + CTA, J-054) instead of running the export.
const onExportClick = (action, trackingTag) => {
    if (unref(exportLocked)) {
        trackEvent(trackingTag)
        buyCreditsDialog.value = true
        return
    }
    action()
}

const resultDialog = useResultDialog()

// The "Nesting report" button on a result card opens this modal already
// scrolled to the quoting report (the card click opens the sheet preview).
const scrollToReportFlag = useResultScrollToReport()
const reportEl = ref(null)

const isHaveError = computed(() => {
    return unref(resultModalData).status === statusType.failed
})
// Plan 2026-09-05 §1.2c — verdict UNIQUE calculé depuis le rapport (plus
// jamais de badges contradictoires « Overlap-free ✓ / Inside sheet ✗ /
// All parts placed ✓ » sur un résultat hors tôle).
const activeVerdict = computed(() => {
    const r = unref(activeReport)
    if (!r) return 'valid'
    if (r.insideSheet === false || r.overlapFree === false
        || (r.duplicatePoses || 0) > 0) return 'unfit'
    if ((r.unplaced || 0) > 0) return 'partial'
    if (r.verifyStatus === 'skipped') return 'unverified'
    return 'valid'
})
const isUnfit = computed(() => unref(activeVerdict) === 'unfit')
// Z3 (vérif 2026-09-05) : solution partielle — bandeau ambre avec leviers
// (le posé est découpage : jamais le bandeau rouge unfit).
const isPartial = computed(() => unref(activeVerdict) === 'partial')
const partialUnplacedCount = computed(() =>
    (unref(activeReport)?.unplaced || 0) || unref(unfitData)?.unplaced || 0)
const partialHasLevers = computed(() => {
    const u = unref(unfitData) || {}
    return Boolean(u.sheetsNeeded || u.maxParts != null || u.maxSpacingMm != null)
})
const unfitData = computed(() => {
    // Leviers : du job (pré-contrôle / moteur infaisable) ou dérivés du
    // rapport (gap négatif = dépassement mesuré).
    const jobUnfit = unref(resultModalData).unfit || null
    const r = unref(activeReport) || {}
    const overflowMm = (typeof r.smallestGapMm === 'number' && r.smallestGapMm < 0)
        ? Math.abs(r.smallestGapMm) : null
    return {
        sheetsNeeded: jobUnfit?.sheetsNeeded ?? null,
        maxParts: jobUnfit?.maxPartsAtSpacing ?? null,
        maxSpacingMm: jobUnfit?.maxSpacingForFitMm ?? null,
        unplaced: jobUnfit?.unplaced ?? null,
        overflowMm,
        reason: jobUnfit?.reason ?? (overflowMm != null ? 'strip' : 'layout'),
    }
})
const isInProgress = computed(() => {
    const status = unref(resultModalData).status
    return status === statusType.unfinished || status === statusType.pending
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

watch(resultDialog, async (isOpen) => {
    if (isOpen) {
        activePart.value = 0
        activeAlt.value = 0
        viewMode.value = 'color'
        if (scrollToReportFlag.value) {
            scrollToReportFlag.value = false
            await nextTick()
            // Let the dialog transition settle before scrolling.
            setTimeout(() => {
                reportEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }, 120)
        }
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

// Colored per-part SVG preview (default) vs raw DXF inspection view. The
// SVGs are generated server-side with the same colors as the live view; the
// downloadable production DXF is never recolored.
const viewMode = ref('color') // 'color' | 'dxf'
const currentSvgs = computed(() => {
    const alts = unref(alternatives)
    if (alts.length > 0 && alts[unref(activeAlt)]) {
        return alts[unref(activeAlt)].svgs || []
    }
    return unref(resultModalData).svgs || []
})
// Legacy jobs have no server SVGs — they silently stay on the DXF viewer.
const hasColorPreview = computed(() => !unref(isInProgress) && !unref(isHaveError) && unref(currentSvgs).length > 0)
const showColorPreview = computed(() => unref(hasColorPreview) && unref(viewMode) === 'color')
const selectViewMode = (mode) => {
    viewMode.value = mode
    trackEvent('result_view_mode', { mode })
}

// ---- nesting report (measured verification, per active alternative) ------
const activeReport = computed(() => unref(alternatives)[unref(activeAlt)]?.report || null)
// AB2 (L2-bis) : options écartées au filet final (diagnostic conservé).
const discardedCount = computed(() => unref(resultModalData).discardedCount || 0)
// C03 : seed absent → masqué (pas de « seed — »).
const activeAltSeed = computed(() => unref(alternatives)[unref(activeAlt)]?.seed ?? null)
// C02 (audit UX 2026-09-05) : la barre unique est la DENSITÉ MATIÈRE
// (plus = mieux). L'ancienne « Sheet utilization » (emprise/tôle, MOINS =
// mieux) se lisait à l'envers et dévalorisait la Grille proposée en
// premier ; les jobs antérieurs sans densité n'affichent plus de barre.
// AA1 (vérif L1 2026-09-05) : UNE définition MESURÉE — totals.densityPct
// du rapport vérifié (Σ aires pièces / Σ aires tôles), identique pour la
// grille et le moteur. Repli sur alt.density SEULEMENT si l'alternative
// n'a pas de rapport (jobs antérieurs).
const altDensityPct = altDensityPctOf
const densityPct = computed(() => altDensityPct(unref(alternatives)[unref(activeAlt)]))
const freeAreaMm2 = computed(() => {
    const r = unref(activeReport)
    if (!r) return 0
    return Math.max(0, (r.sheetAreaMm2 || 0) - (r.partsAreaMm2 || 0))
})
const activeOffcut = computed(() => {
    const off = unref(alternatives)[unref(activeAlt)]?.offcut
    return off && off.area > 1 ? off : null
})

// ---- quoting report (per-sheet measured metrics, ADDITIVE report fields) --
// Legacy jobs have no report.sheets: only the classic block above is shown.
const reportSheets = computed(() => {
    const sheets = unref(activeReport)?.sheets
    return Array.isArray(sheets) ? sheets : []
})
const previewSheet = computed(() => {
    const s = unref(reportSheets)[unref(activePart)] || unref(reportSheets)[0]
    if (s?.widthMm && s?.heightMm) return { w: s.widthMm, h: s.heightMm }
    const live = unref(resultModalData)?.liveLayout?.sheets?.[0]
    if (Array.isArray(live) && live.length >= 2) return { w: Number(live[0]), h: Number(live[1]) }
    const p = unref(resultModalData)?.params?.sheets?.[0]
    if (p) return { w: Number(p.width) || 0, h: Number(p.height) || 0 }
    return { w: 0, h: 0 }
})
const reportTotals = computed(() => unref(activeReport)?.totals || null)
// Enriched offcut ({widthMm, heightMm, areaMm2, reusable}) — the legacy
// alternative.offcut {width, height, area} stays the fallback.
const activeReportOffcut = computed(() => {
    const off = unref(activeReport)?.offcut
    return off && off.areaMm2 > 1 ? off : null
})
// "3 × 48\" × 96\"" per distinct sheet format (mixed-format jobs aggregated).
const materialFormats = computed(() => {
    const totals = unref(reportTotals)
    if (!totals || !Array.isArray(totals.formats)) return ''
    return totals.formats
        .map((f) => `${f.count} × ${fmtLength(f.widthMm)} × ${fmtLength(f.heightMm)}`)
        .join(' + ')
})

const offcutText = (off) => {
    if (!off) return '—'
    const label = off.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap')
    return `${fmtLength(off.widthMm)} × ${fmtLength(off.heightMm)} (${fmtArea(off.areaMm2)}, ${label}, ${t('report.offcut.atLeast')})`
}

// "3 376 in² (23.45 ft²)" stacked on two lines in the per-sheet table:
// keeps both units (shop floor reads in², purchasing reads ft²) without
// widening the table past the modal. mm mode: single line, sub is null.
const fmtAreaStacked = (mm2) => {
    const s = fmtArea(mm2)
    const m = s.match(/^(.+?)\s*(\([^)]+\))$/)
    return m ? { main: m[1], sub: m[2] } : { main: s, sub: null }
}

const buildReportText = () => {
    const totals = unref(reportTotals)
    const name = `${unref(resultModalData).slug} · ${t('result.option', { n: unref(activeAlt) + 1 })}`
    const lines = [
        t('report.text.title', { name }),
        t('report.text.material', { formats: unref(materialFormats) }),
        t('report.text.totals', {
            sheets: totals.sheetCount,
            parts: fmtArea(totals.partsAreaMm2),
            free: fmtArea(totals.freeAreaMm2),
            pct: totals.densityPct != null ? totals.densityPct.toFixed(1) : '—',
        }),
    ]
    for (const s of unref(reportSheets)) {
        lines.push(t('report.text.sheetLine', {
            i: s.index + 1,
            w: fmtLength(s.widthMm),
            h: fmtLength(s.heightMm),
            n: s.partCount,
            used: fmtArea(s.partsAreaMm2),
            free: fmtArea(s.freeAreaMm2),
            pct: s.densityPct != null ? s.densityPct.toFixed(1) : '—',
            offcut: offcutText(s.offcut),
        }))
    }
    return lines.join('\n')
}

const copied = ref(false)
let copiedTimer = null
const copyReport = async () => {
    const text = buildReportText()
    try {
        await navigator.clipboard.writeText(text)
    } catch {
        // Clipboard API unavailable (non-secure context): legacy fallback.
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
    }
    copied.value = true
    trackEvent('report_copied', { altId: unref(activeAlt) })
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 2000)
}

// CSV v1: comma separator, dot decimals, i18n headers with the display unit
// in the header name; values in the display unit (in / mm, in² / mm²).
const csvCell = (v) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const exportCsv = () => {
    const sheets = unref(reportSheets)
    const totals = unref(reportTotals)
    const isInch = unref(unit) === 'inch'
    const lenUnit = isInch ? 'in' : 'mm'
    const areaUnit = isInch ? 'in2' : 'mm2'
    const csvLen = (mm) => fmtLengthValue(mm)
    const csvArea = (mm2) => (isInch ? (mm2 / SQMM_PER_SQIN).toFixed(1) : String(Math.round(mm2)))
    const reusableLabel = (off) => (off.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap'))
    const headers = [
        t('report.sheet.num'),
        `${t('report.sheet.format')} W (${lenUnit})`,
        `${t('report.sheet.format')} H (${lenUnit})`,
        t('report.sheet.parts'),
        `${t('report.sheet.used')} (${areaUnit})`,
        `${t('report.sheet.free')} (${areaUnit})`,
        `${t('report.sheet.density')} (%)`,
        `${t('report.sheet.offcut')} W (${lenUnit})`,
        `${t('report.sheet.offcut')} H (${lenUnit})`,
        `${t('report.sheet.offcut')} (${areaUnit})`,
        t('report.offcut.reusable'),
    ]
    const rows = sheets.map((s) => [
        s.index + 1,
        csvLen(s.widthMm), csvLen(s.heightMm),
        s.partCount,
        csvArea(s.partsAreaMm2), csvArea(s.freeAreaMm2),
        s.densityPct != null ? s.densityPct.toFixed(1) : '',
        s.offcut ? csvLen(s.offcut.widthMm) : '',
        s.offcut ? csvLen(s.offcut.heightMm) : '',
        s.offcut ? csvArea(s.offcut.areaMm2) : '',
        s.offcut ? reusableLabel(s.offcut) : '',
    ])
    if (totals) {
        rows.push([
            t('report.total'), '', '',
            sheets.reduce((acc, s) => acc + s.partCount, 0),
            csvArea(totals.partsAreaMm2), csvArea(totals.freeAreaMm2),
            totals.densityPct != null ? totals.densityPct.toFixed(1) : '',
            '', '', '', '',
        ])
    }
    // BOM: Excel opens UTF-8 (French accents) correctly.
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
    const slug = String(unref(resultModalData).slug || 'job').replace(/[^a-zA-Z0-9_-]+/g, '-')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nesting-report-${slug}-alt${unref(activeAlt) + 1}.csv`
    a.click()
    // m-7 (audit 2026-08-31 §R-m.7) : la révocation immédiate pouvait
    // avorter le téléchargement sur certains navigateurs — même filet que
    // localDownloads (grâce 1 s).
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    trackEvent('report_csv_exported', { altId: unref(activeAlt) })
}
const reportBadges = computed(() => {
    const r = unref(activeReport)
    if (!r) return []
    const badges = []
    if (r.overlapFree != null) badges.push({ ok: r.overlapFree, label: t('report.overlapFree') })
    if (r.insideSheet != null) badges.push({ ok: r.insideSheet, label: t('report.insideSheet') })
    if (r.smallestGapMm != null && r.smallestGapMm < 0) {
        // §1.2c : un gap NÉGATIF est un dépassement hors tôle, pas un
        // espacement — libellé dédié, jamais « Gap ≥ −4 mm ».
        const over = fmtLengthValue(Math.abs(r.smallestGapMm), unitLabel.value === '"' ? 4 : 2)
        badges.push({ ok: false, label: t('report.outsideBy', { v: over, unit: unitLabel.value }) })
    } else if (r.spacingOk != null && r.smallestGapMm != null) {
        // Sub-mm resolution: 2 decimals in mm, 4 in inches.
        const gap = fmtLengthValue(r.smallestGapMm, unitLabel.value === '"' ? 4 : 2)
        badges.push({ ok: r.spacingOk, label: t('report.spacing', { v: gap, unit: unitLabel.value }) })
    }
    // A3/U1 : une tôle au-delà du plafond de vérification ne doit JAMAIS
    // paraître « validée par absence de badge » — badge explicite.
    if (r.verifyStatus === 'skipped' || (r.overlapFree == null && r.spacingOk == null)) {
        badges.push({ ok: false, label: t('report.notVerified') })
    }
    // A4 : pose dupliquée = même pièce posée deux fois (la garde anti-perte
    // par total y était aveugle).
    if (r.duplicatePoses > 0) badges.push({ ok: false, label: t('report.duplicates', { n: r.duplicatePoses }) })
    // C03 (audit UX 2026-09-05) : plus de badge post-pass ici — le post-pass
    // (rollback et erreurs compris) vit dans les détails techniques
    // repliés : un résultat découpable n'affiche jamais de rouge
    // « Post-pass … rollback ».
    // §1.2c : « All parts placed » n'est JAMAIS vert quand le verdict est
    // unfit (pièces posées mais hors tôle = pas découpables).
    const allPlaced = unref(resultModalData).requested === unref(resultModalData).placed
    badges.push({
        ok: allPlaced && !unref(isUnfit),
        label: t('report.allPlaced', { n: unref(resultModalData).placed }),
    })
    // X2 (vérif tour 4) : solution partielle — le compte non placé est un
    // badge visible, jamais un job en erreur.
    const unplaced = r.unplaced || 0
    if (unplaced > 0) {
        badges.push({ ok: false, label: t('report.unplaced', { n: unplaced }) })
    }
    return badges
})
// C03 : lignes techniques du post-pass (repliées, jamais en badge).
const postPassLines = computed(() => {
    const pp = unref(activeReport)?.postPass
    if (!pp) return []
    const lines = []
    if ((pp.residualMoved || 0) > 0 || pp.compactRollback || (pp.errors || []).length) {
        lines.push(t('report.postPass', {
            n: pp.residualMoved || 0,
            rb: pp.compactRollback ? ' · rollback' : '',
            e: (pp.errors || []).length ? ` · ${(pp.errors || []).length} err` : '',
        }))
    }
    return lines
})
const hasTechDetails = computed(() => Boolean(
    unref(activeAltSeed)
    || unref(activeReport)?.iterations
    || unref(activeReport)?.vcores
    || unref(postPassLines).length
))
const formatDensity = (density) => {
    if (density == null) return '—'
    return `${(density * 100).toFixed(1)}%`
}
// C02 : un seul indicateur de qualité par option, dans le bon sens —
// tôles · densité matière · chute réutilisable. Remplace « 55% used »
// (emprise, moins = mieux, lu comme une utilisation).
const altQualityLine = (alt) => {
    const parts = [altSheetsCount(alt)]
    const d = altDensityPct(alt)
    if (d != null) parts.push(`${d.toFixed(1)}% ${t('result.densityShort')}`)
    const off = alt?.offcut
    if (off && off.area > 1) {
        parts.push(t('result.offcutShort', {
            w: fmtLength(off.width),
            h: fmtLength(off.height),
        }))
    }
    return parts.join(' · ')
}
// Tooltip: what this option is good for, incl. its clean offcut size.
const strategyLabel = (strategy) => {
    // Directional alternatives are tagged by the engine (left/bottom/
    // balanced); legacy names (max offcut, compact) pass through translated
    // when known, raw otherwise.
    const key = `alts.strategy.${strategy}`
    const translated = t(key)
    const name = translated === key ? strategy : translated
    const arrow = displayDirectionArrow(strategy, previewSheet.value.w, previewSheet.value.h)
    return arrow ? `${arrow} ${name}` : name
}
const altTitle = (alt) => {
    const parts = []
    if (alt.strategy) parts.push(strategyLabel(alt.strategy))
    if (alt.offcut && alt.offcut.area > 1) {
        parts.push(t('result.cleanOffcut', {
            w: fmtLength(alt.offcut.width),
            h: fmtLength(alt.offcut.height),
        }))
    }
    // §2.2d : la chute réutilisable PAR TÔLE — c'est ce que l'utilisateur
    // compare entre deux alternatives multi-tôles (la matière réellement
    // économisée), pas seulement la meilleure chute de l'alternative.
    const sheets = alt?.report?.sheets || []
    sheets.forEach((s, i) => {
        const off = s?.offcut
        if (!off || !(off.areaMm2 > 1)) return
        parts.push(t('result.sheetOffcut', {
            n: i + 1,
            w: fmtLengthValue(off.widthMm, unitLabel.value === '"' ? 4 : 2),
            h: fmtLengthValue(off.heightMm, unitLabel.value === '"' ? 4 : 2),
            unit: unitLabel,
        }) + (off.reusable ? '' : ` · ${t('report.offcut.scrap')}`))
    })
    return parts.join('\n') || t('result.layoutOption')
}
// §2.2d : le nombre de tôles de l'alternative dans la ligne du sélecteur.
const altSheetsCount = (alt) => (alt.layoutCount > 1
    ? t('result.sheetsCount', { n: alt.layoutCount })
    : t('result.sheetsCountOne'))
const displayClasses = computed(() => ({
    'modal__display--is-fullscreen': unref(isFullScreen) && !unref(isHaveError)
}))
const placeholderClasses = computed(() => ({
    'modal__placeholder--is-fullscreen':
        unref(isFullScreen) && !unref(isHaveError)
}))
const name = computed(() => {
    const endPart = unref(resultModalData).isMultiSheet ? `.zip` : `.dxf`
    return unref(resultModalData).slug + endPart
})
const headlineTitle = computed(() => {
    const alts = unref(alternatives)
    const alt = alts[unref(activeAlt)] || alts[0]
    const strategy = alt?.strategy ? strategyLabel(alt.strategy) : t('result.option', { n: (alt?.altId ?? 0) + 1 })
    // C02 : qualité = densité matière (plus = mieux) + chute réutilisable.
    const quality = []
    const density = altDensityPct(alt)
    if (density != null) quality.push(`${t('result.densityFull')} ${density.toFixed(1)}%`)
    if (alt?.offcut && alt.offcut.area > 1) {
        quality.push(t('result.cleanOffcut', { w: fmtLength(alt.offcut.width), h: fmtLength(alt.offcut.height) }))
    }
    const score = quality.join(' · ')
    return score ? `${strategy} · ${score}` : strategy
})
// C02 : sous-titre explicatif de la méthode (Grille vs Compaction) —
// masqué quand la stratégie est inconnue.
const activeStrategyExplain = computed(() => {
    const alts = unref(alternatives)
    const alt = alts[unref(activeAlt)] || alts[0]
    const s = alt?.strategy
    if (!s) return null
    const key = `alts.explain.${s}`
    const translated = t(key)
    return translated === key ? null : translated
})

// AA1 (vérif L1 2026-09-05) : justification du rang 0, VÉRIFIÉE — « plus
// grande chute propre » si et seulement si la chute du rang 0 est
// maximale (à 1 mm² près) ; sinon la vraie raison de proposer la Grille
// en premier : des rangées régulières, des découpes prévisibles.
const whyFirstLine = computed(() => {
    const alts = unref(alternatives)
    if (!alts || alts.length < 2 || unref(isHaveError)) return null
    if (unref(activeAlt) !== 0) return null
    const kind = whyFirstKind(alts)
    return kind === 'offcut' ? t('result.whyFirst') : t('result.whyFirstGrid')
})
const activePart = ref(0)
const updatePartPage = (partIndex) => {
    if (partIndex < 0 || partIndex >= unref(currentDxfs).length) return
    activePart.value = partIndex
}
</script>

<style lang="scss" scoped>

.report__unfit {
    grid-column: 1 / -1;
    border: 1px solid #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border-radius: 8px;
    padding: 10px 12px;
    margin: 6px 0;
}
.report__unfit-title {
    color: #dc2626;
    font-weight: 600;
}
.report__unfit-levers {
    margin: 6px 0 0 18px;
    padding: 0;
}
.report__unfit-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
}

/* Z3 (vérif 2026-09-05) : solution partielle — ambre, pas rouge : le
   résultat posé est utilisable et découpage. */
.report__partial {
    grid-column: 1 / -1;
    border: 1px solid #d97706;
    background: rgba(217, 119, 6, 0.08);
    border-radius: 8px;
    padding: 10px 12px;
    margin: 6px 0;
}
.report__partial-title {
    color: #b45309;
    font-weight: 600;
}
.report__partial-detail {
    margin-top: 2px;
    font-size: 12px;
}

.modal {
    padding: 48px 24px 24px;

    max-width: 368px;
    @media (min-width: 567px) {
        max-width: initial;
        min-width: 368px;
        // Roomy enough for the per-sheet quoting table (7 columns with
        // in² + ft² areas) without a horizontal scrollbar.
        width: min(800px, 94vw);
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

    // Colored sheet preview (server SVG, per-part colors): keeps its own
    // white CAD background, never upscaled beyond its box.
    &__svg-preview {
        object-fit: contain;
        background: #ffffff;
        border: 1px solid #d5dbe3;
        border-radius: 8px;
    }

    &__display,
    &__placeholder {
        max-width: 100%;
        max-height: 100%;

        width: 320px;
        height: 320px;

        @media (min-width: 567px) {
            width: min(620px, 78vw);
            height: min(280px, 42vh);
        }

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
            max-width: 620px;
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

    &__headline {
        margin: 0 auto 10px;
        text-align: center;
    }

    &__summary {
        margin: 0 auto 12px;
        max-width: 520px;
    }

    &__list-sheets {
        margin: 10px auto 8px;
    }

    &__part-download {
        margin-left: auto;
        margin-right: auto;
        margin-top: 8px;
    }
}

.view-toggle {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin: 0 auto 10px;

    &__btn {
        padding: 5px 14px;
        border-radius: 999px;
        border: 1px solid var(--separator-secondary);
        background-color: var(--fill-tertiary);
        color: var(--label-secondary);
        font-size: 12px;
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
    margin: 0 auto 14px;

    &__strategy {
        padding: 2px 7px;
        border-radius: 999px;
        background-color: color-mix(in srgb, var(--accent-primary) 14%, transparent);
        color: var(--accent-primary);
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    &__tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
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

    /* C02 (audit UX 2026-09-05) : pourquoi l'option 1 est proposée en
       premier — la Grille (chute propre) ne doit pas paraître « moins
       bonne » que la Compaction. */
    &__why {
        margin: -6px auto 12px;
        font-size: 12px;
        color: var(--label-tertiary);
        text-align: center;
    }
}
.report {
    margin-top: 12px;
    padding: 14px 16px;
    border: 1px solid var(--separator-secondary);
    border-radius: 12px;
    background-color: var(--background-primary);
    text-align: left;
    font-size: 14px;
    line-height: 1.45;
    color: var(--label-secondary);

    &__row {
        display: flex;
        align-items: center;
        gap: 8px;

        &:not(:last-child) {
            margin-bottom: 8px;
        }

        &--detail {
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 12px;
            font-variant-numeric: tabular-nums;
        }
    }

    &__label {
        flex-shrink: 0;
        font-weight: 600;
        color: var(--label-primary);
    }

    &__bar {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background-color: var(--fill-tertiary);
        overflow: hidden;
    }

    &__bar-fill {
        height: 100%;
        border-radius: 3px;
        background-color: var(--accent-primary);
        transition: width 0.4s ease;
    }

    &__value {
        flex-shrink: 0;
        font-weight: 700;
        color: var(--label-primary);
        font-variant-numeric: tabular-nums;
    }

    &__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
    }

    &__badge {
        padding: 2px 9px;
        border-radius: 9px;
        font-size: 11px;
        font-weight: 700;
        background-color: color-mix(in srgb, var(--system-green, #2e7d32) 12%, transparent);
        color: var(--system-green, #2e7d32);

        &--ko {
            background-color: color-mix(in srgb, var(--error-border, #c62828) 12%, transparent);
            color: var(--error-text, #c62828);
        }

        // Scrap offcut: informational, never alarming (not an error).
        &--scrap {
            background-color: color-mix(in srgb, var(--label-tertiary, #8a939f) 14%, transparent);
            color: var(--label-tertiary, #8a939f);
        }
    }

    &__hint {
        font-size: 11px;
        color: var(--label-tertiary);
    }

    // ft² under in² in the per-sheet table (both units, narrow columns).
    &__area-sub {
        display: block;
        font-size: 11px;
        color: var(--label-tertiary);
    }

    &__material {
        padding-top: 10px;
        margin-top: 2px;
        border-top: 1px solid var(--separator-secondary);
        font-size: 15px;
    }

    &__table-wrap {
        overflow-x: auto;
        margin-bottom: 8px;
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;

        th,
        td {
            padding: 5px 8px;
            text-align: right;
        }

        // Sheet number and format read left-to-right.
        th:first-child,
        td:first-child,
        th:nth-child(2),
        td:nth-child(2) {
            text-align: left;
        }

        thead th {
            color: var(--label-tertiary);
            font-weight: 600;
            border-bottom: 1px solid var(--separator-secondary);
        }

        tbody tr:not(:last-child) td {
            border-bottom: 1px solid var(--fill-tertiary);
        }
    }

    &__engine {
        font-size: 11px;
        color: var(--label-tertiary);
        font-variant-numeric: tabular-nums;
    }
}
.headline {
    &__title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--label-primary);
    }

    &__slug {
        margin: 4px 0 0;
        font-size: 11px;
        color: var(--label-tertiary);
        word-break: break-all;
        font-family: $sf_mono;
    }
}

.summary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;

    &__label {
        flex-shrink: 0;
        font-weight: 600;
        color: var(--label-primary);
    }

    &__bar {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background-color: var(--fill-tertiary);
        overflow: hidden;
    }

    &__bar-fill {
        height: 100%;
        border-radius: 3px;
        background-color: var(--accent-primary);
    }

    &__value {
        flex-shrink: 0;
        font-weight: 700;
        color: var(--label-primary);
        font-variant-numeric: tabular-nums;
    }
}

.controls {
    display: flex;
    flex-wrap: wrap;
    row-gap: 8px;
    align-items: center;
    justify-content: center;

    &>* {
        margin-left: 4px;
        margin-right: 4px;
    }
}

/* C02 (audit UX 2026-09-05) : sous-titre explicatif de la méthode
   d'agencement sous le titre de l'option. */
.headline__explain {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--label-tertiary);
    text-align: center;
}

/* C03/C12 : détails techniques REPLIÉS — post-pass (rollback compris),
   seed/itérations/cœurs moteur. Un résultat découpable n'affiche jamais
   de rouge « Post-pass … rollback ». */
.report__tech {
    margin: 6px 0;

    & summary {
        cursor: pointer;
        font-size: 12px;
        color: var(--label-tertiary);
        user-select: none;
    }

    & .report__engine {
        margin: 4px 0 0;
        font-size: 11px;
        color: var(--label-tertiary);
        font-variant-numeric: tabular-nums;
    }

    & .report__tech-line {
        margin: 2px 0 0;
        font-size: 11px;
        color: var(--label-tertiary);
    }
}
</style>
