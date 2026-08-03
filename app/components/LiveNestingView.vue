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
            <span v-if="evalsCount" class="live__stat live__stat--accent" :title="t('live.evalsTitle')">
                {{ evalsCount }} <span class="live__stat-suffix">{{ t('live.combinations') }}</span>
            </span>
            <span v-if="cores" class="live__stat" :title="t('nest.coresTitle', { n: cores })">
                <CoresSpinner :cores="cores" :size="16" show-count />
                <span class="live__stat-suffix">{{ t('live.cores') }}</span>
            </span>
        </div>

        <div class="live__body">
            <!-- Main view: champion of the selected strategy (default: left). -->
            <svg
                v-if="sheet"
                :viewBox="`0 0 ${sheet[0]} ${sheet[1]}`"
                class="live__sheet"
                preserveAspectRatio="xMidYMid meet"
            >
                <defs>
                    <clipPath :id="clipId">
                        <rect x="0" y="0" :width="sheet[0]" :height="sheet[1]" />
                    </clipPath>
                </defs>
                <rect x="0" y="0" :width="sheet[0]" :height="sheet[1]" class="live__sheet-bg" />
                <g :clip-path="`url(#${clipId})`">
                    <path
                        v-for="(item, i) in mainItems"
                        :key="i"
                        :d="item.d"
                        :transform="`translate(${item.x} ${item.y}) rotate(${item.rot})`"
                        class="live__part"
                        fill-rule="evenodd"
                    />
                </g>
                <text
                    v-if="!mainItems.length"
                    :x="sheet[0] / 2"
                    :y="sheet[1] / 2"
                    text-anchor="middle"
                    class="live__placeholder"
                >
                    {{ t('live.waiting') }}
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
                        :viewBox="`0 0 ${sheet[0]} ${sheet[1]}`"
                        class="live__card-sheet"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        <rect x="0" y="0" :width="sheet[0]" :height="sheet[1]" class="live__sheet-bg" />
                        <g :clip-path="`url(#${clipId})`">
                            <path
                                v-for="(item, i) in card.items"
                                :key="i"
                                :d="item.d"
                                :transform="`translate(${item.x} ${item.y}) rotate(${item.rot})`"
                                class="live__part"
                                fill-rule="evenodd"
                            />
                        </g>
                    </svg>
                    <span v-if="card.champ" class="live__card-metric">
                        <template v-if="card.champ.strip_width != null">{{ card.champ.strip_width.toFixed(0) }} mm</template>
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

const props = defineProps({
    result: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});

const { t } = useLocale();
// NOTE: bare $fetch (Nuxt auto-import) — nuxtApp.$fetch is not reliable
// everywhere; a failed fetch here silently empties the whole render.


// ---- part geometry cache ---------------------------------------------------
const geometryCache = ref({}); // fileSlug -> [{d}]
const pendingSlugs = new Set();

async function ensureGeometry(slug) {
    if (!slug || geometryCache.value[slug] || pendingSlugs.has(slug)) return;
    pendingSlugs.add(slug);
    try {
        const data = await $fetch(`/api/files/project/geometry/${slug}`);
        const parts = (data.parts || []).map((p) => ({
            d: ringsToPath([p.coordinates, ...(p.holes || [])]),
        }));
        geometryCache.value = { ...geometryCache.value, [slug]: parts };
    } catch (e) {
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
        out.push({ d: part.d, rot, x, y });
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

// sparrow has NO hard sheet bound: a collision-free ("feasible") solution
// can still be wider than the sheet. Only layouts that actually fit count
// as presentable — otherwise the view locks on over-width garbage.
function fitsSheet(s) {
    if (!s?.feasible) return false;
    const w = s.sheets?.[0]?.[0];
    if (w != null && s.strip_width != null) return s.strip_width <= w + 0.5;
    return true;
}

// Strict quality order: fits-the-sheet first, then narrowest strip / fewest
// bins, then densest. Ties keep the incumbent (stability).
function isBetter(a, b) {
    if (!a) return false;
    if (!b) return true;
    const fa = fitsSheet(a), fb = fitsSheet(b);
    if (fa !== fb) return fa;
    const aw = a.strip_width ?? Infinity, bw = b.strip_width ?? Infinity;
    if (aw !== bw) return aw < bw;
    const ab = a.bins ?? Infinity, bb = b.bins ?? Infinity;
    if (ab !== bb) return ab < bb;
    return (a.density || 0) > (b.density || 0) + 1e-9;
}

function offerChampion(live) {
    // Never lock onto a working state: only layouts that FIT the sheet may
    // become champion — mid-search separation states (over-width, pieces
    // spilling out) are working states, not presentable layouts.
    if (!fitsSheet(live)) return;
    const cls = DIRECTION_CLASSES.includes(live.bias) ? live.bias : 'best';
    if (!isBetter(live, pendingChamps[cls] || champions.value[cls])) return;
    pendingChamps[cls] = live;
    if (champTimer) return;
    champTimer = setTimeout(() => {
        champTimer = null;
        const next = { ...champions.value };
        for (const [k, v] of Object.entries(pendingChamps)) {
            if (isBetter(v, next[k])) next[k] = v;
        }
        champions.value = next;
        pendingChamps = {};
    }, 600);
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
        return {
            cls,
            champ,
            items: buildItems(champ, props.result?.itemMap, geometryCache.value),
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
    return n != null ? Math.round(n) : null;
});

const evalsCount = computed(() => {
    const n = props.result?.progress?.evals;
    if (!n) return null;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
    return `${n}`;
});

const stageLabel = computed(() => {
    const stage = props.result?.progress?.stage || best.value?.stage;
    if (!stage) return t('results.nesting');
    const key = `progress.stage.${stage}`;
    const translated = t(key);
    return translated === key ? stage : translated;
});

const formatElapsed = (sec) => {
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m${String(sec % 60).padStart(2, '0')}`;
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
        // The panel background is dark in this theme: force readable light
        // text instead of relying on theme label vars (which can be blue
        // on navy here).
        color: #eef2f7;
    }

    &__stage {
        font-weight: 700;
        color: #eef2f7;
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
        color: #b8c2d0;
        font-variant-numeric: tabular-nums;

        &--accent {
            font-weight: 700;
            color: #6ea8ff;
        }
    }

    &__stat-suffix {
        font-size: 10px;
        font-weight: 500;
        color: #8b98ab;
    }

    &__body {
        display: flex;
        gap: 10px;
        align-items: stretch;
    }

    // The CAD canvas: light, always.
    &__sheet {
        flex: 1;
        min-height: 160px;
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
        fill: rgba(59, 130, 246, 0.22);
        stroke: #2563eb;
        stroke-width: 1.2;
        transition: transform 0.6s ease, fill 0.3s ease, stroke 0.3s ease;
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
