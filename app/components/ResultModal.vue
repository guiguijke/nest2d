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
                    {{ t('result.option', { n: alt.altId + 1 }) }} · {{ formatScore(alt) }}
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
                <p class="headline__slug" :title="t('result.copySlug')">{{ name }}</p>
            </div>
            <div
                v-if="!isHaveError && activeReport"
                class="modal__summary summary"
            >
                <span class="summary__label">{{ t('report.utilization') }}</span>
                <div class="summary__bar">
                    <div class="summary__bar-fill" :style="{ width: `${usedPct}%` }" />
                </div>
                <span class="summary__value">{{ usedPct.toFixed(1) }}%</span>
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
                        :isDisable="isHaveError"
                        :size="sizeType.s"
                        :theme="themeType.primary"
                        trackingTag="result_part_download"
                    />
                    <MainButton
                        class="modal__part-download"
                        v-if="resultModalData.isMultiSheet && isLocal"
                        :label="t('result.downloadSheet', { n: activePart + 1 })"
                        :isDisable="isHaveError"
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
                    <span class="report__label">{{ t('report.utilization') }}</span>
                    <div class="report__bar">
                        <div
                            class="report__bar-fill"
                            :style="{ width: `${usedPct}%` }"
                        />
                    </div>
                    <span class="report__value">{{ usedPct.toFixed(1) }}%</span>
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
                <div class="report__engine">
                    nest-engine · seed {{ activeAltSeed }}
                    <template v-if="activeReport.iterations"> · {{ t('report.iterations', { n: activeReport.iterations }) }}</template>
                    <template v-if="activeReport.vcores"> · {{ t('report.cores', { n: activeReport.vcores }) }}</template>
                </div>
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
                    :isDisable="isHaveError"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && isLocal"
                    :label="t('results.downloadAll')"
                    :isDisable="isHaveError"
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
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'
import { statusType } from '~~/constants/status.constants'
import { trackEvent } from '~/utils/track'
import { SQMM_PER_SQIN } from '~/utils/units'
import { displayDirectionArrow } from '~/utils/sheetView'
import { onMounted, nextTick } from 'vue'
import { reportExportState } from '~/utils/reportExport'

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
const activeAltSeed = computed(() => unref(alternatives)[unref(activeAlt)]?.seed ?? '—')
const usedPct = computed(() => {
    const alt = unref(alternatives)[unref(activeAlt)]
    const share = alt?.usedSheetShare ?? alt?.density
    return share != null ? share * 100 : 0
})
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
    URL.revokeObjectURL(url)
    trackEvent('report_csv_exported', { altId: unref(activeAlt) })
}
const reportBadges = computed(() => {
    const r = unref(activeReport)
    if (!r) return []
    const badges = []
    if (r.overlapFree != null) badges.push({ ok: r.overlapFree, label: t('report.overlapFree') })
    if (r.insideSheet != null) badges.push({ ok: r.insideSheet, label: t('report.insideSheet') })
    if (r.spacingOk != null && r.smallestGapMm != null) {
        // Sub-mm resolution: 2 decimals in mm, 4 in inches.
        const gap = fmtLengthValue(r.smallestGapMm, unitLabel.value === '"' ? 4 : 2)
        badges.push({ ok: r.spacingOk, label: t('report.spacing', { v: gap, unit: unitLabel.value }) })
    }
    const allPlaced = unref(resultModalData).requested === unref(resultModalData).placed
    badges.push({ ok: allPlaced, label: t('report.allPlaced', { n: unref(resultModalData).placed }) })
    return badges
})
const formatDensity = (density) => {
    if (density == null) return '—'
    return `${(density * 100).toFixed(1)}%`
}
// Share of the sheet actually consumed by the layout (lower = better: the
// rest is a clean reusable offcut). Falls back to solver density on jobs
// run before the metric existed.
const formatScore = (alt) => {
    if (alt.usedSheetShare != null) return `${(alt.usedSheetShare * 100).toFixed(1)}% ${t('result.used')}`
    return formatDensity(alt.density)
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
        parts.push(`Clean offcut: ${fmtLength(alt.offcut.width)} × ${fmtLength(alt.offcut.height)}`)
    }
    return parts.join('\n') || 'Layout option'
}
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
    const score = alt ? formatScore(alt) : ''
    return score ? `${strategy} · ${score}` : strategy
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
            color: var(--error-border, #c62828);
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
</style>
