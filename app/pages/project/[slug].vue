<template>
    <div class="content">
        <MainTitle :label="pageTitle" class="content__title" />
        <div v-if="isDemo" class="demo-banner">
            <div class="demo-banner__head">
                <span class="demo-banner__badge">{{ t('demo.badge') }}</span>
                <span class="demo-banner__name">{{ t('demo.projectName') }}</span>
            </div>
            <p class="demo-banner__text">
                {{ t('demo.banner', { n: DEMO_LIMIT }) }}
            </p>
            <p class="demo-banner__params">{{ demoParamsText }}</p>
            <p class="demo-banner__remaining">{{ t('demo.remaining', { n: demoRemaining, total: DEMO_LIMIT }) }}</p>
        </div>
        <ProjectFiles :projectFiles="projectFiles" :readonly="isDemo" @addFiles="addFiles" class="content__files" />
        <section v-if="liveResult" class="content__live live-panel">
            <h3 class="live-panel__title">{{ t('live.title') }}</h3>
            <LiveNestingView :result="liveResult" />
        </section>
        <MainSettings v-if="!isDemo" />
        <MainButton :theme="themeType.primary" :label="btnLabel" :isDisable="btnIsDisable" trackingTag="project_nest_start"
            @click="startsNest" class="content__btn">
            <template v-if="runningJob">
                <CoresSpinner :cores="runningCores" :size="16" show-count />
                {{ t('nest.computing') }}
            </template>
        </MainButton>
        <FreeNestBanner v-if="!isDemo" />
        <div v-if="isDemo && demoQuotaReached" class="content__error">
            {{ t('demo.quotaEmpty') }}
        </div>
        <div v-if="nestRequestError" class="content__error">
            {{ nestRequestError }}
        </div>
        <div v-if="!sizesIsAvailable && !nestRequestError" class="content__error">
            {{ t('project.minSheet', { w: fmtLengthValue(biggestPartSizes.width), h: fmtLengthValue(biggestPartSizes.height), unit: unitLabel }) }}
        </div>
        <div v-if="!isNewParams" class="content__text">
            {{ t('project.changeToRegenerate') }}
        </div>
    </div>
</template>

<script setup async>
import { themeType } from "~~/constants/theme.constants";
import {
    DEMO_NESTING_LIMIT,
    DEMO_SHEETS,
    DEMO_SPACE_MM,
} from "~~/shared/constants/demo.constants";

definePageMeta({
    layout: "auth",
    middleware: "auth",
});

const { t } = useLocale()
// Part dims arrive in canonical mm; sheet params are display-unit strings —
// displayToMm normalizes them for the fit check.
const { unitLabel, fmtLengthValue, displayToMm } = useUnit()
const $apiFetch = useApiFetch();

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
const { getters: filesGetters, actions } = filesStore;
const params = computed(() => filesGetters.params);
const { setProjectFiles, setProjectName, nest } = actions;
const filesCount = computed(() => filesGetters.filesCount);
const isNewParams = computed(() => filesGetters.isNewParams);
const nestRequestError = computed(() => filesGetters.nestRequestError);
const demoQuotaReached = computed(() => filesGetters.demoQuotaReached);
const route = useRoute();
const slug = route.params.slug;
const apiPath = API_ROUTES.PROJECT(slug);
const data = filesGetters.projectFiles || await $apiFetch(apiPath);

// Shared read-only demo project: server-imposed sheet/params, files are not
// editable (quantities still are), and nestings draw from the user's own
// monthly demo allowance instead of the regular free quota.
const isDemo = computed(() => Boolean(data.isDemo));
const DEMO_LIMIT = DEMO_NESTING_LIMIT;
const demoSheet = DEMO_SHEETS[0];
const demoParamsText = computed(() => t('demo.params', {
    w: fmtLengthValue(demoSheet.width),
    h: fmtLengthValue(demoSheet.height),
    space: fmtLengthValue(DEMO_SPACE_MM),
    unit: unitLabel.value,
}));
const user = computed(() => unref(authStore.getters.user) || {});
const demoRemaining = computed(() => Number(user.value.demoRemaining ?? DEMO_LIMIT));

const pageTitle = computed(() => {
    return isDemo.value
        ? `${t('demo.projectName')} · ${t('project.files', { n: unref(filesCount) })}`
        : t('project.files', { n: unref(filesCount) });
});

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
// Demo: always true — the demo sheet is imposed server-side and every demo
// part was authored to fit it (client sheet params are hidden and ignored).
const sizesIsAvailable = computed(() => {
    if (unref(isDemo)) return true;
    const { width: partWidth, height: partHeight } = unref(biggestPartSizes);
    return unref(currentSheets).some((sheet) => {
        // Sheet params hold display-unit strings; parts are mm. Compare in mm.
        const width = Math.max(displayToMm(Number(sheet.width) || 0), displayToMm(Number(sheet.height) || 0));
        const height = Math.min(displayToMm(Number(sheet.width) || 0), displayToMm(Number(sheet.height) || 0));
        return width >= partWidth && height >= partHeight;
    });
})
onMounted(() => {
    if (!filesGetters.projectFiles) {
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
const btnIsDisable = computed(() => {
    return Boolean(unref(nestRequestError)) || !unref(isNewParams) || !unref(resultsList) || !unref(sizesIsAvailable)
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
.wrapper {
    &>*:not(:last-child) {
        margin-bottom: 40px;
    }
}

.content {
    text-align: center;

    &__title {
        margin-bottom: 16px;
    }

    &__files {
        margin-bottom: 40px;
    }

    &__error {
        margin-top: 16px;
        padding: 12px;
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-secondary);
        border-radius: 8px;
    }

    &__text {
        color: var(--label-secondary);
        margin-top: 16px;
    }

    &__live {
        margin-bottom: 40px;
    }

    &__btn {
        margin-top: 40px;
        margin-right: auto;
        margin-left: auto;
    }
}

.live-panel {
    padding: 20px;
    border: 1px solid var(--separator-secondary);
    border-radius: 12px;
    background: var(--background-secondary, rgba(127, 127, 127, 0.04));

    &__title {
        margin: 0 0 12px;
        font-size: 15px;
        font-weight: 600;
        // The live panel sits on a dark background in this theme — force a
        // readable light tone (label-primary is blue-on-navy here).
        color: #eef2f7;
        text-align: left;
    }

    :deep(.live__sheet) {
        min-height: 380px;
        max-height: 60vh;
    }
}

.demo-banner {
    margin: 0 auto 24px;
    padding: 14px 18px;
    max-width: 640px;
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

    &__params {
        margin-top: 6px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--label-tertiary);
    }

    &__remaining {
        margin-top: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--accent-primary);
    }
}
</style>
