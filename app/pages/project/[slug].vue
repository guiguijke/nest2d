<template>
    <div class="content">
        <header class="content__head">
            <div class="content__heading">
                <h1 class="content__title">{{ pageTitle }}</h1>
                <PrivacyChip
                    v-if="!isDemo"
                    :mode="privacyMode"
                    class="content__chip"
                />
            </div>
            <p v-if="!isDemo" class="content__count">{{ t('project.files', { n: filesCount }) }}</p>
        </header>
        <p v-if="privacyStatus" class="content__privacy">{{ privacyStatus }}</p>
        <div v-if="isDemo" class="demo-banner">
            <div class="demo-banner__head">
                <span class="demo-banner__badge">{{ t('demo.badge') }}</span>
                <span class="demo-banner__name">{{ t('demo.projectName') }}</span>
            </div>
            <p class="demo-banner__text">
                {{ demoUnlimited ? t('demo.bannerLocal') : t('demo.banner', { n: DEMO_LIMIT }) }}
            </p>
            <p v-if="demoUnlimited" class="demo-banner__remaining">{{ t('demo.unlimitedLocal') }}</p>
            <p v-else class="demo-banner__remaining">{{ t('demo.remaining', { n: demoRemaining, total: DEMO_LIMIT }) }}</p>
        </div>
        <section ref="liveSection" class="atelier">
            <div class="atelier__stage stage">
                <div class="stage__head">
                    <h2 class="stage__title">
                        {{ stageHeading }}
                        <span v-if="localComputeRunning" class="stage__meta">
                            {{ Number(localElapsed).toFixed(1) }}s
                            <template v-if="localWalks > 1">
                                · ×{{ localWalks }} {{ t('live.walks') }}
                            </template>
                        </span>
                    </h2>
                    <p v-if="localComputeRunning" class="stage__status">
                        {{ t(isLocalProject ? 'localCompute.runningLocal' : 'localCompute.running') }}
                    </p>
                </div>
                <LiveNestingView v-if="stageLive" :result="stageLive" />
                <div v-else class="stage__idle">
                    <svg
                        :viewBox="idleViewBox"
                        class="stage__sheet"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        <g :transform="idleTransform">
                            <rect
                                x="0"
                                y="0"
                                :width="idleSheet.w"
                                :height="idleSheet.h"
                                class="stage__sheet-bg"
                            />
                        </g>
                        <SheetAxes :width="idleSheet.w" :height="idleSheet.h" />
                    </svg>
                    <p class="stage__dims">{{ idleSheet.w }} × {{ idleSheet.h }} {{ unitLabel }}</p>
                </div>
            </div>
            <aside class="atelier__params">
                <MainSettings />
                <MainButton
                    :theme="themeType.primary"
                    :label="btnLabel"
                    :isDisable="btnIsDisable"
                    trackingTag="project_nest_start"
                    @click="startsNest"
                    class="atelier__nest"
                >
                    <template v-if="runningJob">
                        <CoresSpinner :cores="runningCores" :size="16" show-count />
                        {{ t('nest.computing') }}
                    </template>
                </MainButton>
                <FreeNestBanner v-if="!isDemo" />
            </aside>
        </section>
        <div v-if="localComputeError" class="content__error">
            {{ localErrorText }}
        </div>
        <div v-if="isDemo && demoQuotaReached && !demoUnlimited" class="content__error">
            {{ t('demo.quotaEmpty') }}
        </div>
        <div v-if="nestRequestError" class="content__error">
            {{ nestRequestError }}
        </div>
        <div v-if="localImportError" class="content__error">
            {{ t(localImportError) }}
        </div>
        <div v-if="sheetCapExceeded" class="content__error">
            {{ t('nest.sheetCapHint') }}
        </div>
        <div v-else-if="sheetCapServerError" class="content__error">
            {{ t('nest.error.sheetCap') }}
        </div>
        <div v-if="!sizesIsAvailable && !nestRequestError" class="content__error">
            {{ t('project.minSheet', { w: fmtLengthValue(biggestPartSizes.width), h: fmtLengthValue(biggestPartSizes.height), unit: unitLabel }) }}
        </div>
        <ProjectFiles
            :projectFiles="projectFiles"
            :readonly="isDemo"
            :local="isLocalProject"
            @addFiles="addFiles"
            class="content__files"
        />
    </div>
</template>

<script setup async>
import { themeType } from "~~/constants/theme.constants";
import { mmToDisplay, equivalentSheetPreset } from "~/utils/units";
import { isLocalComputeEnabled } from "~/composables/localCompute";
import { runLocalJobPrivate } from "~/composables/localJobPrivate";
import { invalidateLocalRecords } from "~/composables/localHydrate";
import { useLocalMode } from "~/composables/useLocalMode";
import {
    DEMO_NESTING_LIMIT,
    DEMO_PROJECT_SLUG,
    DEMO_SHEETS,
    DEMO_SPACE_MM,
} from "~~/shared/constants/demo.constants";
import { sheetDisplaySize, sheetLandscapeTransform } from "~/utils/sheetView";
import { PRIVACY_STATUS_KEY, projectPrivacyMode } from "~/utils/privacyMode";

definePageMeta({
    layout: "auth",
    middleware: "auth",
});

const { t } = useLocale()
// Part dims arrive in canonical mm; sheet params are display-unit strings —
// displayToMm normalizes them for the fit check.
const { unit, unitLabel, fmtLengthValue, displayToMm } = useUnit()
const $apiFetch = useApiFetch();

const vaultEnabled = computed(() =>
    Boolean(unref(authStore.getters.user)?.encryption?.enabled)
);

const { getters } = globalStore;
const resultsList = computed(() => getters.resultsList);
// The currently-running job's live layout stream (engine snapshots pushed
// over SSE): drives the big real-time preview above the settings.
const liveResult = computed(() => {
    const list = unref(resultsList) || [];
    return list.find((r) => r.liveLayout) || null;
});
// The job currently being computed (if any): drives the animated state of
// the nest button (spinning wheel + vcore count while the engine works).
const runningJob = computed(() => {
    const list = unref(resultsList) || [];
    return list.find((r) => r.isInProgress) || null;
});
const runningCores = computed(() => {
    const n = unref(runningJob)?.compute?.vcores;
    return Math.min(8, Math.max(1, Number(n) || 1));
});

// The live section sits at the TOP of the page (above the files grid, which
// is 8 screens tall on the demo): when a new job starts streaming, bring it
// into view once so the animation is never missed below the fold.
const liveSection = ref(null);
const lastLiveSlug = ref(null);
watch(
    () => unref(liveResult)?.slug,
    async (slug) => {
        if (!slug || slug === lastLiveSlug.value) return;
        lastLiveSlug.value = slug;
        await nextTick();
        liveSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
);

// Mode Local productisé (J-077/J-082) : quand le worker Python a PRÉPARÉ un
// job local (status awaiting_local), on le résout dans le navigateur et les
// RÉSULTATS restent 100 % navigateur (IndexedDB) — le serveur ne reçoit que
// la comptabilité (local-quota) ou le refund (local-fail). Le rendu (modal,
// couleurs, rapport, téléchargements) est hydraté depuis IndexedDB par
// localHydrate ; rien ne dépend des artefacts serveur pour ces jobs.
// Échec ⇒ message i18n propre + refund (jamais de crash de page).
const route = useRoute();
const localModeCtl = useLocalMode(null);
const localComputeRunning = ref(false);
const localComputeError = ref(null);
// Reveal final pour la vue live au retour du solve (J-082) — et pendant le
// solve, les frames layout streamées par le moteur WASM (J-084) alimentent
// `localLive`, consommé par LiveNestingView exactement comme le flux SSE
// serveur (mêmes champs : worker/stage/feasible/strip_width/items/bias +
// sheets/isSpp ajoutés par runInWorker).
const localReveal = ref(null);
// Frame layout brute + compteur de combinaisons (événements séparés du
// moteur : layout ~2 Hz, evals ~1 Hz par walk, agrégés par le pool —
// banque anti-reset, piège #10). Fusionnés dans `localLive` pour que la
// vue affiche AUSSI les stats en mode local (progress/compute étaient
// null → compteur et ×N cœurs jamais visibles).
const localLiveFrame = ref(null);
const localEvals = ref(null);
// J-093 : taille effective du pool de walks (injectée dans les frames live).
const localWalks = ref(1);
const localElapsed = localModeCtl.elapsed;
const localLive = computed(() => {
    if (!localLiveFrame.value) return null;
    return {
        ...localLiveFrame.value,
        compute: { vcores: localWalks.value },
        progress: { evals: localEvals.value, elapsed_sec: localElapsed.value },
    };
});
const localErrorText = computed(() => localModeCtl.mapError(localComputeError.value));
const attemptedLocalJobs = new Set();
watch(
    () => (unref(resultsList) || []).find((r) => r.status === 'awaiting_local'),
    async (job) => {
        if (!job || !isLocalComputeEnabled() || attemptedLocalJobs.has(job.slug)) return;
        attemptedLocalJobs.add(job.slug);
        localComputeError.value = null;
        localComputeRunning.value = true;
        localLiveFrame.value = null;
        localEvals.value = null;
        localWalks.value = 1;
        localModeCtl.startTimer();
        try {
            const res = await runLocalJobPrivate(job.slug, {
                projectSlug: route.params.slug,
                onLive: (evt) => {
                    if (evt.walks) localWalks.value = evt.walks;
                    // Compteur de combinaisons : événement scalaire, la frame
                    // affichée n'est pas touchée (fusionnée dans localLive).
                    if (evt.type === 'evals') {
                        localEvals.value = evt.evals;
                        return;
                    }
                    localLiveFrame.value = {
                        slug: job.slug,
                        // J-090 : la frame porte l'itemMap pour les projets
                        // 100 % clients (le doc job n'en a pas).
                        itemMap: evt.itemMap || job.itemMap || [],
                        liveLayout: evt,
                    };
                },
            });
            if (!res.ok) {
                localComputeError.value =
                    res.error === 'memory_cap' ? 'memory_cap'
                    : res.error === 'entity_limit' ? 'entity_limit'
                    : res.error === 'geometry_missing' ? 'geometry_missing'
                    // J-093 : annulation — la carte montre déjà l'état
                    // « cancelled » via le flux, pas de bandeau d'erreur.
                    : res.error === 'cancelled' ? null
                    : 'crash';
            } else {
                // Les records ont changé : forcer la prochaine hydratation.
                invalidateLocalRecords();
                if (res.liveLayout) {
                    localReveal.value = {
                        slug: job.slug,
                        itemMap: res.itemMap || job.itemMap || [],
                        liveLayout: res.liveLayout,
                        // Stats finales conservées sur le panel de reveal :
                        // compteur total de combinaisons + walks du pool.
                        compute: { vcores: localWalks.value },
                        progress: { evals: localEvals.value },
                    };
                }
            }
        } catch (e) {
            localComputeError.value = 'crash';
            console.error('local compute failed', e);
        } finally {
            localModeCtl.stopTimer();
            localComputeRunning.value = false;
        }
    },
    { immediate: true }
);
const { getters: filesGetters, actions } = filesStore;
const params = computed(() => filesGetters.params);
const { setProjectFiles, setProjectName, nest, getProject, consumePendingLocalFiles } = actions;
const filesCount = computed(() => filesGetters.filesCount);
const isNewParams = computed(() => filesGetters.isNewParams);
const nestRequestError = computed(() => filesGetters.nestRequestError);
const localImportError = computed(() => filesGetters.localImportError);
const demoQuotaReached = computed(() => filesGetters.demoQuotaReached);
const slug = route.params.slug;
const apiPath = API_ROUTES.PROJECT(slug);
const data = filesGetters.projectFiles || await $apiFetch(apiPath);

// Shared read-only demo project: files are not editable, but quantities AND
// nesting settings are — the demo plays like a regular project. Only the
// compute profile (4 vcores, 90 s, 3 directions) and the monthly demo quota
// stay server-imposed.
const isDemo = computed(() =>
    Boolean(filesGetters.projectDemo)
    || Boolean(data?.isDemo)
    || route.params.slug === DEMO_PROJECT_SLUG
);
// J-090 : projet « 100 % privé » — fichiers en IndexedDB, jamais uploadés.
const isLocalProject = computed(() =>
    Boolean(filesGetters.projectLocal) || Boolean(data?.local)
);
const privacyMode = computed(() =>
    projectPrivacyMode(
        { local: isLocalProject.value, isDemo: isDemo.value },
        vaultEnabled.value,
    )
);
const privacyStatus = computed(() => {
    if (isDemo.value) return ''
    const key = PRIVACY_STATUS_KEY[privacyMode.value]
    return key ? t(key) : ''
});
const DEMO_LIMIT = DEMO_NESTING_LIMIT;
const user = computed(() => unref(authStore.getters.user) || {});
const demoRemaining = computed(() => Number(user.value.demoRemaining ?? DEMO_LIMIT));
const demoUnlimited = computed(() => Boolean(user.value.demoUnlimited));

// Pre-fill the demo settings (converted to the user's display unit) — only
// on the first visit of this page instance, so manual tweaks survive the
// live updates but a fresh visit starts from the curated defaults again.
const demoDefaultsApplied = ref(false);
const applyDemoDefaults = () => {
    // mm -> display unit, rounded for the input fields (the 0.001" precision
    // is a UI matter; canonical geometry stays mm server-side). The sheet is
    // a metric standard (1500×3000, X×Y): in inch mode, snap to the equivalent
    // US standard (120×60, the 5×10 ft pair, orientation preserved) instead
    // of an unreadable 118.11×59.055.
    const mmToDisp = (mm) => {
        const v = mmToDisplay(mm, unit.value);
        return unit.value === 'inch' ? String(Math.round(v * 1000) / 1000) : String(v);
    };
    const sheetDims = (sheet) =>
        equivalentSheetPreset(sheet.width, sheet.height, 'mm', unit.value) || {
            width: mmToDisp(sheet.width),
            height: mmToDisp(sheet.height),
        };
    actions.updateParams({
        sheets: DEMO_SHEETS.map((sheet) => ({
            ...sheetDims(sheet),
            count: String(sheet.count),
        })),
        space: mmToDisp(DEMO_SPACE_MM),
        addOutShape: false,
        fillHoles: true,
        rotationCount: 4,
    });
};
watch(isDemo, (val) => {
    if (val && !demoDefaultsApplied.value) {
        demoDefaultsApplied.value = true;
        applyDemoDefaults();
    }
}, { immediate: true });

const pageTitle = computed(() => {
    if (isDemo.value) return t('demo.projectName')
    return filesGetters.projectName || data?.name || t('project.files', { n: unref(filesCount) })
});

const stageLive = computed(() => {
    if (unref(localComputeRunning) && unref(localLive)) return unref(localLive)
    return unref(liveResult) || unref(localReveal) || null
});

const stageHeading = computed(() => {
    if (unref(localComputeRunning)) return t('localCompute.title')
    if (unref(stageLive)) return t('live.title')
    return t('live.ready')
});

const idleSheet = computed(() => {
    const s = unref(currentSheets)[0] || { width: 1000, height: 2000 }
    const w = Number(String(s.width).replace(',', '.')) || 1000
    const h = Number(String(s.height).replace(',', '.')) || 2000
    return { w, h }
});
const idleViewBox = computed(() => {
    const { viewW, viewH } = sheetDisplaySize(idleSheet.value.w, idleSheet.value.h)
    return `0 0 ${viewW} ${viewH}`
});
const idleTransform = computed(() =>
    sheetLandscapeTransform(idleSheet.value.w, idleSheet.value.h)
);

const projectFiles = computed(() => {
    return filesGetters.projectFiles || data.files.map(file => ({ ...file, count: file.demoQuantity ?? 1 }))
})
const biggestPartSizes = computed(() => {
    const parts = projectFiles.value
        .filter(file => file.count !== 0) // skip files with count 0
        .reduce((acc, file) => [...acc, ...file.parts], [])
        .map(part => ({
            width: part.width > part.height ? part.width : part.height,
            height: part.width > part.height ? part.height : part.width
        }));

    return {
        width: Math.max(...parts.map(part => part.width), 0),
        height: Math.max(...parts.map(part => part.height), 0)
    };
})
const currentSheets = computed(() => {
    const p = unref(params);
    if (Array.isArray(p.sheets) && p.sheets.length > 0) return p.sheets;
    // Legacy params shape (before multi-sheet).
    return [{ width: p.widthPlate ?? 0, height: p.heightPlate ?? 0 }];
})
// A part fits if it fits inside at least one sheet type, in either orientation.
const sizesIsAvailable = computed(() => {
    const { width: partWidth, height: partHeight } = unref(biggestPartSizes);
    return unref(currentSheets).some((sheet) => {
        // Sheet params hold display-unit strings; parts are mm. Compare in mm.
        const width = Math.max(displayToMm(Number(sheet.width) || 0), displayToMm(Number(sheet.height) || 0));
        const height = Math.min(displayToMm(Number(sheet.width) || 0), displayToMm(Number(sheet.height) || 0));
        return width >= partWidth && height >= partHeight;
    });
})
onMounted(() => {
    if (isLocalProject.value) {
        // J-090 : hydration IndexedDB (jamais le serveur) + import des
        // fichiers déposés sur la home à la création du projet.
        (async () => {
            await getProject(apiPath)
            const pending = consumePendingLocalFiles()
            if (pending.length) await actions.addFiles(pending, slug)
        })()
    } else if (!filesGetters.projectFiles) {
        setProjectFiles(data.files, apiPath)
        setProjectName(data.name)
    }

    trackEvent("page_view", {
        page: "project",
        projectSlug: slug,
    });
})
const btnLabel = computed(() => {
    return t('settings.nestFiles', { n: unref(filesCount) })
})
// Sheet cap mirror (D-PAY-9): the Free plan is capped at 2 sheets TOTAL per
// job (sum of counts over every format). The SERVER enforces the cap at
// enqueue (403 sheet_cap_exceeded, before any quota is consumed) — this is
// only the UX mirror so a free user gets a hint instead of a surprise 403.
// The demo is exempt (dedicated quota, J-056).
const sheetCapExceeded = computed(() => {
    if (unref(isDemo)) return false
    const level = unref(user)?.compute?.level
    if (level !== 'free') return false
    const total = unref(currentSheets).reduce((sum, sheet) => sum + (Number(sheet.count) || 0), 0)
    return total > 2
})
// Server-side defense actually fired (client mirror bypassed) — from the store.
const sheetCapServerError = computed(() => filesGetters.sheetCapError)
const btnIsDisable = computed(() => {
    return Boolean(unref(nestRequestError)) || !unref(isNewParams) || !unref(resultsList) || !unref(sizesIsAvailable) || unref(sheetCapExceeded)
})
const addFiles = (files) => {
    actions.addFiles(files, slug)
}

const startsNest = () => {
    if (btnIsDisable.value) return;
    nest(slug);
}
</script>

<style lang="scss" scoped>
.content {
    text-align: left;

    &__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
    }

    &__heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 10px;
        min-width: 0;
    }

    &__title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--label-primary);
    }

    &__privacy {
        margin: 0 0 16px;
        font-size: 13px;
        line-height: 1.45;
        color: var(--label-secondary);
        max-width: 42rem;
    }

    &__count {
        margin: 0;
        font-size: 13px;
        color: var(--label-tertiary);
        flex-shrink: 0;
    }

    &__files {
        margin-top: 28px;
        margin-bottom: 24px;
    }

    &__error {
        margin-top: 16px;
        padding: 12px;
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-secondary);
        border-radius: 8px;
    }

}

.atelier {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 8px;

    @media (min-width: 900px) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        gap: 24px;
        align-items: start;
    }

    &__params {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    &__nest {
        width: 100%;
        margin-top: 4px;

        :deep(.button) {
            width: 100%;
        }
    }
}

.stage {
    padding: 16px;
    border: 1px solid var(--separator-secondary);
    border-radius: 12px;
    background: var(--background-primary);

    &__head {
        margin-bottom: 12px;
    }

    &__title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--label-primary);
    }

    &__meta {
        margin-left: 8px;
        font-size: 12px;
        font-weight: 500;
        color: var(--accent-primary);
        font-variant-numeric: tabular-nums;
    }

    &__status {
        margin: 6px 0 0;
        font-size: 13px;
        color: var(--label-secondary);
    }

    &__idle {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }

    &__sheet {
        width: 100%;
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

    &__ready {
        margin: 4px 0 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--label-primary);
    }

    &__dims {
        margin: 0;
        font-size: 12px;
        color: var(--label-tertiary);
        font-variant-numeric: tabular-nums;
    }
}

.demo-banner {
    margin: 0 0 16px;
    padding: 10px 16px;
    text-align: left;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent-primary) 7%, transparent);

    &__head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
    }

    &__badge {
        padding: 2px 9px;
        border-radius: 999px;
        background: var(--accent-primary);
        color: var(--background-primary);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    &__name {
        font-weight: 700;
        color: var(--label-primary);
    }

    &__text {
        font-size: 13px;
        color: var(--label-secondary);
    }

    &__remaining {
        margin-top: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--accent-primary);
    }
}
</style>
