<template>
    <div class="live" :class="{ 'live--compact': compact }">
        <div class="live__header">
            <span class="live__stage">{{ stageLabel }}</span>
            <span v-if="best" class="live__metric">
                <template v-if="best.strip_width != null">
                    {{ t('live.width') }} <strong>{{ best.strip_width.toFixed(1) }} mm</strong>
                </template>
                <template v-else-if="best.bins != null">
                    {{ t('live.sheets') }} <strong>{{ best.bins }}</strong>
                </template>
                <template v-if="best.density != null">
                     · {{ (best.density * 100).toFixed(1) }}%
                </template>
            </span>
            <span v-if="best" class="live__badge" :class="{ 'live__badge--ok': best.feasible }">
                {{ best.feasible ? t('live.feasible') : t('live.searching') }}
            </span>
        </div>

        <div class="live__body">
            <svg
                v-if="best && sheet"
                :viewBox="`0 0 ${sheet[0]} ${sheet[1]}`"
                class="live__sheet"
                preserveAspectRatio="xMidYMid meet"
            >
                <rect x="0" y="0" :width="sheet[0]" :height="sheet[1]" class="live__sheet-bg" />
                <g v-for="(item, i) in displayItems" :key="i">
                    <path
                        :d="item.d"
                        :transform="`translate(${item.x} ${item.y}) rotate(${item.rot})`"
                        class="live__part"
                        :class="{ 'live__part--collision': !best.feasible }"
                        fill-rule="evenodd"
                    />
                </g>
            </svg>
            <div class="live__aside">
                <div class="live__workers" v-if="workers.length > 1">
                    <button
                        v-for="w in workers"
                        :key="w"
                        :class="['live__worker', { 'live__worker--active': w === activeWorker }]"
                        @click="activeWorker = w"
                    >
                        W{{ w + 1 }}
                    </button>
                    <button
                        :class="['live__worker', { 'live__worker--active': activeWorker === -1 }]"
                        @click="activeWorker = -1"
                    >
                        {{ t('live.best') }}
                    </button>
                </div>
                <svg v-if="history.length > 1" class="live__spark" :viewBox="`0 0 100 30`" preserveAspectRatio="none">
                    <polyline :points="sparkPoints" class="live__spark-line" />
                </svg>
                <p v-if="best" class="live__elapsed">{{ formatElapsed(Math.round((best.elapsed_ms || 0) / 1000)) }}</p>
            </div>
        </div>
    </div>
</template>

<script setup>
/**
 * Real-time nesting visualizer: watches the engine's live layout stream
 * (liveLayout on the job doc, pushed over SSE) and animates parts moving on
 * the sheet. Also accumulates the quality-over-time sparkline — the curve
 * that tells you when more compute stops paying off.
 */
import { computed, ref, watch } from 'vue';

const props = defineProps({
    // The result item ({liveLayout, itemMap, ...}) pushed by the SSE stream.
    result: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});

const { t } = useLocale();

// ---- geometry (fetched once per file slug) -------------------------------
const geometryCache = ref({}); // slug -> [{d, dWithHoles}]
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

// ---- per-worker snapshots ------------------------------------------------
const snapshots = ref({}); // worker -> liveLayout
const activeWorker = ref(-1); // -1 = best

watch(
    () => props.result?.liveLayout,
    (live) => {
        if (!live || live.worker == null) return;
        snapshots.value = { ...snapshots.value, [live.worker]: live };
        recordHistory(live);
        // Prefetch geometry for the item ids we see.
        const map = props.result?.itemMap || [];
        for (const m of map) ensureGeometry(m.slug);
    },
    { immediate: true, deep: true }
);

const workers = computed(() =>
    Object.keys(snapshots.value).map(Number).sort((a, b) => a - b)
);

const best = computed(() => {
    const all = Object.values(snapshots.value);
    if (!all.length) return null;
    if (activeWorker.value >= 0) return snapshots.value[activeWorker.value] || null;
    // Best: feasible first, then narrowest strip / fewest bins, then densest.
    return [...all].sort((a, b) => {
        if ((b.feasible ? 1 : 0) !== (a.feasible ? 1 : 0)) return (b.feasible ? 1 : 0) - (a.feasible ? 1 : 0);
        const aw = a.strip_width ?? Infinity, bw = b.strip_width ?? Infinity;
        if (aw !== bw) return aw - bw;
        const ab = a.bins ?? Infinity, bb = b.bins ?? Infinity;
        if (ab !== bb) return ab - bb;
        return (b.density || 0) - (a.density || 0);
    })[0];
});

const sheet = computed(() => {
    const b = best.value;
    if (!b?.sheets?.length) return null;
    // SPP = one sheet; BPP = the sheet of the first layout shown (v1).
    return b.sheets[0];
});

// ---- items to draw --------------------------------------------------------
const displayItems = computed(() => {
    const b = best.value;
    if (!b?.items?.length || !props.result?.itemMap) return [];
    const byId = Object.fromEntries(props.result.itemMap.map((m) => [m.id, m]));
    const out = [];
    for (const raw of b.items) {
        let id, bin, rot, x, y;
        if (raw.length === 5) [id, bin, rot, x, y] = raw; // BPP
        else [id, rot, x, y] = raw; // SPP
        const m = byId[id];
        const part = m && geometryCache.value[m.slug]?.[m.part];
        if (!part) continue;
        out.push({ d: part.d, rot, x, y });
    }
    return out;
});

// ---- sparkline (quality over time) ---------------------------------------
const MAX_HISTORY_POINTS = 240;
const history = ref([]); // [elapsed_ms, quality]
function recordHistory(live) {
    const q = live.strip_width ?? live.bins ?? null;
    if (q == null || live.elapsed_ms == null) return;
    const last = history.value[history.value.length - 1];
    if (last && Math.abs(last[0] - live.elapsed_ms) < 800 && last[1] === q) return;
    const next = [...history.value, [live.elapsed_ms, q]];
    // Cap the history so a long nesting job can't grow this array unbounded.
    history.value = next.length > MAX_HISTORY_POINTS ? next.slice(-MAX_HISTORY_POINTS) : next;
}

const sparkPoints = computed(() => {
    const h = history.value;
    if (h.length < 2) return '';
    const minT = h[0][0], maxT = h[h.length - 1][0] || 1;
    const qs = h.map((p) => p[1]);
    const minQ = Math.min(...qs), maxQ = Math.max(...qs) || 1;
    return h
        .map(([t, q]) => {
            const px = ((t - minT) / Math.max(1, maxT - minT)) * 100;
            const py = 28 - ((q - minQ) / Math.max(1e-6, maxQ - minQ)) * 26;
            return `${px.toFixed(1)},${py.toFixed(1)}`;
        })
        .join(' ');
});

// ---- labels ---------------------------------------------------------------
const stageLabel = computed(() => {
    const b = best.value;
    if (!b?.stage) return t('results.nesting');
    const key = `progress.stage.${b.stage}`;
    const translated = t(key);
    return translated === key ? b.stage : translated;
});

const formatElapsed = (sec) => {
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m${String(sec % 60).padStart(2, '0')}`;
};
</script>

<style lang="scss" scoped>
.live {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;

    &__header {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
    }

    &__stage {
        color: var(--label-primary);
        font-weight: 600;
    }

    &__metric {
        color: var(--label-secondary);
    }

    &__badge {
        margin-left: auto;
        padding: 2px 8px;
        font-size: 10px;
        border-radius: 10px;
        background: var(--system-orange, #b26a00);
        color: #fff;

        &--ok {
            background: var(--system-green, #2e7d32);
        }
    }

    &__body {
        display: flex;
        gap: 8px;
        align-items: stretch;
    }

    &__sheet {
        flex: 1;
        min-height: 120px;
        border: 1px solid var(--separator-secondary);
        border-radius: 6px;
        background: var(--background-secondary, #fafafa);
    }

    &__sheet-bg {
        fill: transparent;
        stroke: var(--accent-primary, #3b82f6);
        stroke-width: 0.5;
    }

    &__part {
        fill: rgba(59, 130, 246, 0.25);
        stroke: var(--accent-primary, #3b82f6);
        stroke-width: 0.4;
        transition: transform 0.6s ease, fill 0.3s ease, stroke 0.3s ease;

        &--collision {
            fill: rgba(255, 152, 0, 0.3);
            stroke: var(--system-orange, #f57c00);
        }
    }

    &__aside {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 70px;
    }

    &__workers {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
    }

    &__worker {
        padding: 1px 5px;
        font-size: 9px;
        border: 1px solid var(--separator-secondary);
        border-radius: 4px;
        background: transparent;
        color: var(--label-secondary);
        cursor: pointer;

        &--active {
            background: var(--accent-primary, #3b82f6);
            color: #fff;
            border-color: transparent;
        }
    }

    &__spark {
        width: 100%;
        height: 30px;
        border: 1px solid var(--separator-secondary);
        border-radius: 4px;
    }

    &__spark-line {
        fill: none;
        stroke: var(--accent-primary, #3b82f6);
        stroke-width: 1;
    }

    &__elapsed {
        font-size: 10px;
        color: var(--label-secondary);
        text-align: right;
    }
}
</style>
