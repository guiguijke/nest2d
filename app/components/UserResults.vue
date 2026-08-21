<template>
    <MainAside @closeAside="$emit('closeAside')" :label="isHomePage ? t('results.all') : t('results.title')">
        <div
            v-if="getters.resultsList.length"
            class="results"
        >
            <UserResultItem
                v-for="result in getters.resultsList"
                :key="result.id"
                :result="result"
                :privacy-mode="privacyMode"
                @openModal="openModal(result)"
                class="results__item"
            />
        </div>
        <p v-else class="results__text">
            {{ t('results.empty') }}
        </p>
        <ResultModal v-model:isModalOpen="resultDialog" />
    </MainAside>
</template>

<script setup>
import { projectPrivacyMode } from '~/utils/privacyMode'

const route = useRoute();
const resultDialog = useResultDialog();
const { t } = useLocale()
const { getters, actions } = globalStore;
const { setResults, setModalResultData, updateNotification } = actions;
const eventSource = ref(null)
// J-082 : hydratation asynchrone (IndexedDB) — chaîner pour préserver
// l'ordre des frames SSE même si une hydratation est encore en cours.
let hydrateChain = Promise.resolve()

const slug = computed(() => route.params.slug);
const privacyMode = computed(() => {
    if (!unref(slug) || filesStore.getters.projectDemo) return null
    return projectPrivacyMode(
        { local: unref(filesStore.getters.projectLocal), isDemo: false },
        Boolean(unref(authStore.getters.user)?.encryption?.enabled),
    )
})

onMounted(() => {
    updateResults()
})
const updateResults = () => {
    setResults([])

    if (unref(eventSource)) {
        unref(eventSource).close()
    }

    eventSource.value = new EventSource(API_ROUTES.RESULTS(unref(slug)))

    unref(eventSource).onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data)
            if (parsed.type === 'initial' || parsed.type === 'update') {
                const items = parsed.data.items
                // J-082 : les jobs locaux (localOnly) n'ont AUCUN artefact
                // côté serveur — alternatives/SVG/DXF/rapport viennent
                // d'IndexedDB (hydratation, zéro géométrie servie).
                hydrateChain = hydrateChain
                    .then(() => hydrateLocalItems(items))
                    .then((hydrated) => setResults(hydrated))
                    .catch(() => setResults(items))

                if (parsed.data.needNotification) {
                    updateNotification(parsed.data.needNotification)
                }
            }
        } catch (e) {
            console.error('Error parsing SSE message:', e)
        }
    }
    unref(eventSource).onerror = (err) => {
        console.error('SSE connection error:', err)
    }
}


const openModal = (result) => {
    setModalResultData(result)
    resultDialog.value = true
}

const isHomePage = computed(() => {
    return route.path === '/home'
})

onBeforeUnmount(() => {
    if (unref(eventSource)) {
        unref(eventSource).close()
    }
})

watch(
    () => route.path,
    () => updateResults(),
);

</script>
<style lang="scss" scoped>
.results {
    &__text {
        color: var(--label-tertiary);
    }
    &__item {
        &:not(:last-child) {
            margin-bottom: 8px;
        }
    }
}
</style>