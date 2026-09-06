<template>
    <div class="live" :class="{ 'live--compact': compact }">
        <!-- Header: stage + badge on the left, stats on the right — all
             high-contrast text on the panel background. -->
        <div class="live__header">
            <span class="live__stage">{{ stageLabel }}</span>
            <span v-if="best" class="live__badge" :class="{ 'live__badge--ok': bestFitsSheet }">
                {{ bestFitsSheet ? t('live.feasible') : t('live.searching') }}
            </span>
            <span class="live__spacer" />
            <span v-if="elapsedSec != null" class="live__stat" :title="t('live.elapsedTitle')">
                {{ formatElapsed(elapsedSec) }}
            </span>
            <span v-if="scoreLabel" class="live__stat live__stat--accent" :title="t('live.scoreTitle')">
                {{ scoreLabel }} <span class="live__stat-suffix">{{ t('live.score') }}</span>
            </span>
            <!-- C12 (audit UX 2026-09-05) : le compteur « n combinaisons »
                 est retiré — itérations de recuit BPP et évaluations
                 separator SPP n'y sont pas comparables et le nombre n'était
                 pas crédible comme indicateur de qualité. -->
            <span v-if="cores" class="live__stat" :title="t('nest.coresTitle', { n: cores })">
                <CoresSpinner :cores="cores" :size="16" show-count />
                <span class="live__stat-suffix">{{ t('live.cores') }}</span>
            </span>
        </div>

        <div class="live__body">
            <!-- Main view: champion of the selected strategy (default: left).
                 BPP : une tôle par panneau côte à côte (jusqu'à
                 MAX_LIVE_SHEETS) — l'ancien rendu ignorait l'index de
                 tôle des items et superposait tout sur un seul contour. -->
            <svg
                v-if="sheet"
                :viewBox="viewBox"
                class="live__sheet"
                preserveAspectRatio="xMidYMid meet"
            >
                <defs>
                    <!-- clipPathUnits=userSpaceOnUse : le rect est lu dans
                         l'espace local de CHAQUE groupe référençant — un
                         seul rect sert tous les panneaux. -->
                    <clipPath :id="clipId">
                        <rect x="0" y="0" :width="sheet[0]" :height="sheet[1]" />
                    </clipPath>
                </defs>
                <g
                    v-for="pane in mainPanes.panes"
                    :key="pane.bin"
                    :transform="`translate(${pane.dx} 0)`"
                >
                    <g :transform="pane.landscape">
                        <rect x="0" y="0" :width="pane.w" :height="pane.h" class="live__sheet-bg" />
                        <g :clip-path="`url(#${clipId})`">
                            <path
                                v-for="(item, i) in mainItemsByBin.get(pane.bin) || []"
                                :key="i"
                                :d="item.d"
                                :transform="partTransform(item, pane.h)"
                                class="live__part"
                                :fill="item.color"
                                :fill-opacity="partFillOpacity"
                                :stroke="item.color"
                                fill-rule="evenodd"
                            />
                        </g>
                        <text
                            v-if="!mainItems.length && pane.bin === mainPanes.panes[0].bin"
                            :x="pane.w / 2"
                            :y="pane.h / 2"
                            text-anchor="middle"
                            class="live__placeholder"
                        >
                            {{ t('live.waiting') }}
                        </text>
                    </g>
                    <SheetAxes :width="pane.w" :height="pane.h" />
                </g>
                <text
                    v-if="mainPanes.truncated"
                    :x="mainPanes.totalW - mainPanes.gap / 2"
                    :y="mainPanes.totalH / 2"
                    text-anchor="middle"
                    class="live__placeholder"
                >
                    +{{ mainPanes.truncated }}
                </text>
            </svg>

            <!-- One card per strategy: its own champion-locked track. Click
                 to make it the main view. -->
            <div v-if="classCards.length > 1" class="live__cards">
                <button
                    v-for="card in classCards"
                    :key="card.cls"
                    class="live__card"
                    :class="{ 'live__card--active': card.cls === selected }"
                    :title="t(`settings.directions.${card.cls}Hint`)"
                    @click="selected = card.cls"
                >
                    <span class="live__card-label">{{ t(`settings.directions.${card.cls}`) }}</span>
                    <svg
                        v-if="card.champ && sheet"
                        :viewBox="`0 0 ${card.panes.totalW} ${card.panes.totalH}`"
                        class="live__card-sheet"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        <g
                            v-for="pane in card.panes.panes"
                            :key="pane.bin"
                            :transform="`translate(${pane.dx} 0)`"
                        >
                            <g :transform="pane.landscape">
                                <rect x="0" y="0" :width="pane.w" :height="pane.h" class="live__sheet-bg" />
                                <g :clip-path="`url(#${clipId})`">
                                    <path
                                        v-for="(item, i) in card.paneItems.get(pane.bin) || []"
                                        :key="i"
                                        :d="item.d"
                                        :transform="partTransform(item, pane.h)"
                                        class="live__part"
                                        :fill="item.color"
                                        :fill-opacity="partFillOpacity"
                                        :stroke="item.color"
                                        fill-rule="evenodd"
                                    />
                                </g>
                            </g>
                        </g>
                    </svg>
                    <span v-if="card.champ" class="live__card-metric">
                        <template v-if="card.champ.density != null">{{ formatScore(card.champ.density) }}</template>
                        <template v-else-if="card.champ.strip_width != null">{{ fmtLength(card.champ.strip_width) }}</template>
                        <template v-else-if="card.champ.bins != null">{{ t('live.sheets') }} {{ card.champ.bins }}</template>
                    </span>
                    <span v-else class="live__card-metric live__card-metric--pending">…</span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
/**
 * Real-time nesting visualizer. One champion-locked track per directional
 * strategy (left / bottom / balanced — champions only ever get REPLACED by
 * strictly better layouts that fit the sheet, so the animation is monotone
 * and calm). The main view shows the selected strategy's champion; the
 * right cards let you compare all three strategies live.
 *
 * Working states (sparrow separations: over-width, pieces outside the
 * strip) are never displayed: a champion locks only on fitsSheet snapshots
 * and everything is clipped to the sheet rect.
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
    engineToDisplay,
    livePaneLayout,
    sheetAxesDisplay,
} from '~/utils/sheetView';
// Champion live partagé avec le registre de solves (R-6 audit 2026-08-31) :
// une seule définition de « meilleure frame » — la couche registre filtrait
// en égalité stricte et la vue ne voyait plus que des frames déjà meilleures.
import { frameFitsSheet as fitsSheet, frameIsBetter as isBetter } from '~/utils/liveJob';

const props = defineProps({
    result: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});

const { t, fmtPercent } = useLocale();
// strip_width arrives in canonical mm — fmtLength converts at display.
const { fmtLength } = useUnit();
// NOTE: bare $fetch (Nuxt auto-import) — nuxtApp.$fetch is not reliable
// everywhere; a failed fetch here silently empties the whole render.


// ---- part geometry cache ---------------------------------------------------
const geometryCache = ref({}); // fileSlug -> [{d, color}]
const pendingSlugs = new Set();

// Parts are filled with their own display color at low opacity (CAD-style:
// the stroke carries the full color, holes stay readable through the fill).
const partFillOpacity = 0.35;
const FALLBACK_PART_COLOR = '#2563eb';

async function ensureGeometry(slug) {
    if (!slug || geometryCache.value[slug] || pendingSlugs.has(slug)) return;
    pendingSlugs.add(slug);
    try {
        // J-090 : un fichier « 100 % privé » n'a AUCUNE géométrie côté
        // serveur — sa source de vérité est IndexedDB (même forme de parts).
        const { getLocalFile } = await import('~/composables/localFilesStore');
        const local = await getLocalFile(slug).catch(() => null);
        const rawParts = local?.parts
            || (await $fetch(`/api/files/project/geometry/${slug}`)).parts;
        const parts = (rawParts || []).map((p) => ({
            d: ringsToPath([p.coordinates, ...(p.holes || [])]),
            // Assigned at import; the geometry route always resolves one
            // (deterministic fallback for legacy files).
            color: p.color || FALLBACK_PART_COLOR,
        }));
        geometryCache.value = { ...geometryCache.value, [slug]: parts };
    } catch (e) {
        // 404 = fichier vraiment absent (projet local inconnu de CE
        // navigateur, ou purge 24 h) : négatif-cacher pour ne pas tempêter
        // l'endpoint à chaque frame live. Erreurs réseau transitoires : on
        // retentera au prochain frame (comportement historique).
        if (e?.response?.status === 404) {
            geometryCache.value = { ...geometryCache.value, [slug]: [] };
        }
        console.warn('geometry fetch failed', slug, e);
    } finally {
        pendingSlugs.delete(slug);
    }
}

function ringsToPath(rings) {
    return rings
        .filter((r) => r && r.length > 2)
        .map((ring) => 'M' + ring.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L') + 'Z')
        .join(' ');
}

// SVG is y-down, the engine frame is y-up: translate(x, H - y) scale(1, -1)
// rotate(deg) lands the part exactly where the production DXF (and the dxf
// viewer) puts it. Without the flip the live view renders vertically
// mirrored against the final result.
function partTransform(item, sheetHeight) {
    return `translate(${item.x} ${sheetHeight - item.y}) scale(1 -1) rotate(${item.rot})`;
}

function buildItems(snap, itemMap, cache) {
    if (!snap?.items?.length || !itemMap) return [];
    const byId = Object.fromEntries(itemMap.map((m) => [m.id, m]));
    const out = [];
    for (const raw of snap.items) {
        let id, bin, rot, x, y;
        if (raw.length === 5) [id, bin, rot, x, y] = raw; // BPP
        else [id, rot, x, y] = raw; // SPP
        const m = byId[id];
        const part = m && cache[m.slug]?.[m.part];
        if (!part) continue;
        // bin conservé (0 pour le SPP) : le rendu BPP répartit les pièces
        // par tôle au lieu de les superposer sur le contour unique.
        out.push({ d: part.d, color: part.color || FALLBACK_PART_COLOR, rot, x, y, bin: bin ?? 0 });
    }
    return out;
}

// ---- snapshots & champion locks (per strategy) ------------------------------
const snapshots = ref({}); // worker -> liveLayout
// One champion per strategy class ('left'|'bottom'|'balanced'|'best').
const champions = ref({});
let pendingChamps = {};
let champTimer = null;

const DIRECTION_CLASSES = ['left', 'bottom', 'balanced'];

const clipId = `sheet-clip-${Math.random().toString(36).slice(2, 9)}`;

// fitsSheet (présentabilité : bande qui tient dans la tôle) et isBetter
// (ordre de qualité strict du champion) viennent de utils/liveJob.js —
// partagés avec le filtre de frames du registre de solves.

function offerChampion(live) {
    if (typeof window !== 'undefined') {
        window.__champOffers = (window.__champOffers || 0) + 1;
    }
    // Never lock onto a working state: only layouts that FIT the sheet may
    // become champion — mid-search separation states (over-width, pieces
    // spilling out) are working states, not presentable layouts.
    if (!fitsSheet(live)) return;
    // V6 (vérif 2026-09-04) : une frame FINALE/reveal (résultat
    // post-passé) remplace TOUTES les classes, sans passer par isBetter —
    // sans bias elle atterrissait dans 'best', jamais affichée en −X
    // (selected = 'left') : le panneau vivait « Optimizing sheets » sur
    // une frame moteur dentelée pendant que le modal montrait le final.
    const isFinal = live.stage === 'final' || live.stage === 'reveal';
    if (isFinal) {
        for (const cls of [...DIRECTION_CLASSES, 'best']) {
            pendingChamps[cls] = live;
        }
        if (champTimer) return;
        champTimer = setTimeout(() => {
            champTimer = null;
            const next = { ...champions.value };
            for (const [k, v] of Object.entries(pendingChamps)) {
                if (isBetter(v, next[k]) || v.stage === 'final' || v.stage === 'reveal') next[k] = v;
            }
            champions.value = next;
            pendingChamps = {};
        }, 150);
        return;
    }
    const cls = DIRECTION_CLASSES.includes(live.bias) ? live.bias : 'best';
    if (!isBetter(live, pendingChamps[cls] || champions.value[cls])) return;
    pendingChamps[cls] = live;
    if (champTimer) return;
    champTimer = setTimeout(() => {
        champTimer = null;
        if (typeof window !== 'undefined') {
            window.__champSwaps = (window.__champSwaps || 0) + 1;
        }
        const next = { ...champions.value };
        for (const [k, v] of Object.entries(pendingChamps)) {
            if (isBetter(v, next[k])) next[k] = v;
        }
        champions.value = next;
        pendingChamps = {};
    }, 150);
}

// The displayed strategy: 'left' by default when directions exist (option 1
// = the historical layout), 'best' on legacy jobs. Clickable via the cards.
const selected = ref('best');

// New job: wipe everything so no stale layout from the previous run leaks.
watch(
    () => props.result?.slug,
    () => {
        snapshots.value = {};
        champions.value = {};
        pendingChamps = {};
        selected.value = 'best';
        if (champTimer) {
            clearTimeout(champTimer);
            champTimer = null;
        }
    }
);

onBeforeUnmount(() => {
    if (champTimer) clearTimeout(champTimer);
});

watch(
    () => props.result?.liveLayout,
    (live) => {
        if (!live) return;
        if (live.worker != null) {
            snapshots.value = { ...snapshots.value, [live.worker]: live };
        }
        offerChampion(live);
        // Default the main view to the left strategy as soon as it exists.
        if (selected.value === 'best' && champions.value.left) {
            selected.value = 'left';
        }
        const map = props.result?.itemMap || [];
        for (const m of map) ensureGeometry(m.slug);
    },
    { immediate: true, deep: true }
);

// ---- views ------------------------------------------------------------------
const best = computed(() => {
    const champ = champions.value[selected.value];
    if (champ) return champ;
    // The selected strategy has no champion yet: show the best available
    // champion of ANY class (a strategy that is still exploring over-width
    // must never leave the main view empty while others have layouts).
    const anyChamp = Object.values(champions.value);
    if (anyChamp.length) {
        return anyChamp.sort((a, b) => (isBetter(a, b) ? -1 : 1))[0];
    }
    // Last resort: the best FITTING snapshot of the selected class (never a
    // mid-search working state).
    const fitting = Object.values(snapshots.value).filter((s) => {
        const cls = DIRECTION_CLASSES.includes(s.bias) ? s.bias : 'best';
        return cls === selected.value && fitsSheet(s);
    });
    if (!fitting.length) return null;
    return fitting.sort((a, b) => (isBetter(a, b) ? -1 : 1))[0];
});

const bestFitsSheet = computed(() => fitsSheet(best.value));

const sheet = computed(() => {
    const b = best.value;
    if (b?.sheets?.length) return b.sheets[0];
    const anySnap = Object.values(snapshots.value)[0];
    return anySnap?.sheets?.[0] || null;
});

const mainItems = computed(() =>
    buildItems(best.value, props.result?.itemMap, geometryCache.value)
);

function pathCoords(d) {
    const nums = []
    const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
    let m
    while ((m = re.exec(d || ''))) nums.push(Number(m[0]))
    return nums
}

function itemLocalCorners(item) {
    const nums = pathCoords(item.d)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i]
        const y = nums[i + 1]
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
    }
    if (!Number.isFinite(minX)) return []
    return [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
    ]
}

function mapPlacedEngine(px, py, item) {
    const rad = ((item.rot || 0) * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const rx = px * c - py * s
    const ry = px * s + py * c
    return [item.x + rx, item.y + ry]
}

// ---- BPP : panneaux (une tôle visible par panneau) ---------------------------
// Plafond d'affichage — au-delà, les tôles restantes ne sont pas dessinées
// et un « +N » l'indique (limite de visualisation demandée 2026-09-01).
const MAX_LIVE_SHEETS = 6;

function paneLayoutFor(snap, items) {
    const sheets = snap?.sheets?.length ? snap.sheets : (sheet.value ? [sheet.value] : [[1, 1]]);
    return livePaneLayout(sheets, items.map((it) => it.bin ?? 0), MAX_LIVE_SHEETS);
}

function itemsByPane(panes, items) {
    const map = new Map(panes.panes.map((p) => [p.bin, []]));
    for (const it of items) {
        const arr = map.get(it.bin ?? 0);
        if (arr) arr.push(it);
    }
    return map;
}

const mainPanes = computed(() => paneLayoutFor(best.value, mainItems.value));
const mainItemsByBin = computed(() => itemsByPane(mainPanes.value, mainItems.value));

// Zoom onto the used region in DISPLAY space. Axes stay in frame (origin
// is always included). Export geometry is unchanged.
const viewBox = computed(() => {
    const s = sheet.value
    if (!s) return '0 0 1 1'
    const pl = mainPanes.value
    const totalW = pl.totalW
    const totalH = Math.max(pl.totalH, 1)
    const full = `0 0 ${totalW} ${totalH}`
    const items = mainItems.value
    if (!items.length) return full
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const include = (x, y) => {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
    }
    for (const pane of pl.panes) {
        const ax = sheetAxesDisplay(pane.w, pane.h)
        include(pane.dx + ax.origin.x, ax.origin.y)
        include(pane.dx + ax.xTo.x, ax.xTo.y)
        include(pane.dx + ax.yTo.x, ax.yTo.y)
    }
    const paneByBin = new Map(pl.panes.map((p) => [p.bin, p]))
    for (const item of items) {
        const pane = paneByBin.get(item.bin ?? 0)
        // Tôle au-delà du plafond d'affichage : non dessinée, hors zoom.
        if (!pane) continue
        for (const [px, py] of itemLocalCorners(item)) {
            const [ex, ey] = mapPlacedEngine(px, py, item)
            const [dx, dy] = engineToDisplay(ex, ey, pane.w, pane.h)
            include(pane.dx + dx, dy)
        }
    }
    if (!Number.isFinite(minX)) return full
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    if ((bw * bh) / (totalW * totalH) >= 0.4) return full
    const pad = Math.max(bw, bh) * 0.14 + Math.max(totalW, totalH) * 0.02
    const vx = Math.max(0, minX - pad)
    const vy = Math.max(0, minY - pad)
    const vw = Math.min(totalW - vx, bw + pad * 2)
    const vh = Math.min(totalH - vy, bh + pad * 2)
    return `${vx} ${vy} ${vw} ${vh}`
});

// One card per observed/declared strategy, each with its own champion.
const classCards = computed(() => {
    const declared = props.result?.compute?.directions;
    const observed = new Set(
        Object.values(snapshots.value)
            .map((s) => s.bias)
            .filter((b) => DIRECTION_CLASSES.includes(b))
    );
    const classes = DIRECTION_CLASSES.filter(
        (c) => observed.has(c) || (Array.isArray(declared) && declared.includes(c))
    );
    return classes.map((cls) => {
        const champ = champions.value[cls] || null;
        const items = buildItems(champ, props.result?.itemMap, geometryCache.value);
        const panes = paneLayoutFor(champ, items);
        return {
            cls,
            champ,
            items,
            panes,
            paneItems: itemsByPane(panes, items),
        };
    });
});

// ---- header stats -------------------------------------------------------------
const cores = computed(() => {
    const n = props.result?.compute?.vcores;
    return n ? Math.min(8, Math.max(1, Number(n) || 1)) : null;
});

// Job clock from the worker's progress heartbeat — NOT the champion's
// event timestamp (an early near-optimal champion would freeze it at 0s).
const elapsedSec = computed(() => {
    const n = props.result?.progress?.elapsed_sec;
    return n != null ? Number(n) : null;
});

function formatScore(density) {
    const n = Number(density);
    if (!Number.isFinite(n)) return null;
    return fmtPercent(n * 100);
}

const scoreLabel = computed(() => {
    const live = best.value || props.result?.liveLayout;
    return live?.density != null ? formatScore(live.density) : null;
})

// C12 (audit UX 2026-09-05) : les compteurs « combinaisons » (itérations
// de recuit BPP / évaluations separator SPP — unités différentes, nombre
// non crédible comme indicateur) sont retirés de l'en-tête.

const stageLabel = computed(() => {
    const stage = props.result?.progress?.stage || best.value?.stage;
    if (!stage) return t('results.nesting');
    const key = `progress.stage.${stage}`;
    const translated = t(key);
    return translated === key ? stage : translated;
});

const formatElapsed = (sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return '0.0s';
    if (n < 60) return `${n.toFixed(1)}s`;
    const min = Math.floor(n / 60);
    const rem = n - min * 60;
    return `${min}m${rem.toFixed(1).padStart(4, '0')}`;
};
</script>

<style lang="scss" scoped>
// Explicit, readable palette: the panel inherits the app theme (dark in some
// setups), so the CANVAS is forced light — a clean CAD-style render where
// parts and text are always legible.
.live {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;

    &__header {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: var(--label-primary);
    }

    &__stage {
        font-weight: 700;
        color: var(--label-primary);
    }

    &__badge {
        padding: 2px 9px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 10px;
        background: var(--system-orange, #b26a00);
        color: #fff;

        &--ok {
            background: var(--system-green, #2e7d32);
        }
    }

    &__spacer {
        flex: 1;
    }

    &__stat {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--label-secondary);
        font-variant-numeric: tabular-nums;

        &--accent {
            font-weight: 700;
            color: var(--accent-primary);
        }
    }

    &__stat-suffix {
        font-size: 10px;
        font-weight: 500;
        color: var(--label-tertiary);
    }

    &__body {
        display: flex;
        gap: 10px;
        align-items: stretch;
    }

    // The CAD canvas: light, always (AGENTS #21 — never theme vars here).
    &__sheet {
        flex: 1;
        min-height: 280px;
        max-height: min(52vh, 560px);
        border: 1px solid #d5dbe3;
        border-radius: 8px;
        background: #f8fafc;
    }

    &__sheet-bg {
        fill: #ffffff;
        stroke: #3b82f6;
        stroke-width: 1;
    }

    &__part {
        // fill/stroke come from the per-part color bound inline — a CSS rule
        // here would override the SVG presentation attributes.
        stroke-width: 1.2;
        transition: transform 0.18s ease, fill 0.2s ease, stroke 0.2s ease;
    }

    &__cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 132px;
        flex-shrink: 0;
    }

    &__card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
        padding: 8px;
        border: 1.5px solid var(--separator-secondary);
        border-radius: 10px;
        background: var(--background-primary, #ffffff);
        cursor: pointer;
        transition: border-color 0.2s, box-shadow 0.2s;

        &--active {
            border-color: var(--accent-primary, #3b82f6);
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary, #3b82f6) 18%, transparent);
        }

        @media (hover: hover) {
            &:hover {
                border-color: var(--accent-primary, #3b82f6);
            }
        }
    }

    &__card-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--label-primary);
        text-align: left;
    }

    &__placeholder {
        fill: #94a3b8;
        font-size: 28px;
        font-weight: 600;
    }

    &__card-sheet {
        width: 100%;
        border: 1px solid #d5dbe3;
        border-radius: 6px;
        background: #f8fafc;
    }

    &__card-metric {
        font-size: 10px;
        color: var(--label-secondary);
        font-variant-numeric: tabular-nums;
        text-align: left;

        &--pending {
            color: var(--label-tertiary);
        }
    }
}
</style>
