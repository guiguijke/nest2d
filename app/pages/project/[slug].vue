<template>
    <div class="content">
        <MainTitle :label="t('project.files', { n: filesCount })" class="content__title" />
        <ProjectFiles :projectFiles="projectFiles" @addFiles="addFiles" class="content__files" />
        <section v-if="liveResult" class="content__live live-panel">
            <h3 class="live-panel__title">{{ t('live.title') }}</h3>
            <LiveNestingView :result="liveResult" />
        </section>
        <MainSettings />
        <MainButton :theme="themeType.primary" :label="btnLabel" :isDisable="btnIsDisable" trackingTag="project_nest_start"
            @click="startsNest" class="content__btn">
            <template v-if="runningJob">
                <CoresSpinner :cores="runningCores" :size="16" show-count />
                {{ t('nest.computing') }}
            </template>
        </MainButton>
        <FreeNestBanner />
        <div v-if="nestRequestError" class="content__error">
            {{ nestRequestError }}
        </div>
        <div v-if="!sizesIsAvailable && !nestRequestError" class="content__error">
            {{ t('project.minSheet', { w: biggestPartSizes.width, h: biggestPartSizes.height }) }}
        </div>
        <div v-if="!isNewParams" class="content__text">
            {{ t('project.changeToRegenerate') }}
        </div>
    </div>
</template>

<script setup async>
import { themeType } from "~~/constants/theme.constants";

definePageMeta({
    layout: "auth",
    middleware: "auth",
});

const { t } = useLocale()
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
const route = useRoute();
const slug = route.params.slug;
const apiPath = API_ROUTES.PROJECT(slug);
const data = filesGetters.projectFiles || await $apiFetch(apiPath);


const projectFiles = computed(() => {
    return filesGetters.projectFiles || data.files.map(file => ({ ...file, count: 1 }))
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
        const width = Math.max(Number(sheet.width) || 0, Number(sheet.height) || 0);
        const height = Math.min(Number(sheet.width) || 0, Number(sheet.height) || 0);
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
</style>
