<template>
    <MainAside
        :label="t('project.projects')"
        @closeAside="$emit('closeAside')"
        :btnLabel="btnLabelValue"
        @btnClick="createNewProject"
    >
        <div
            v-if="projectsList.length"
            class="projects"
        >
            <UserProjectItem
                @click="$emit('closeAside')"
                v-for="project in projectsList"
                :key="project.slug"
                :project="project"
                class="projects__item"
            />
        </div>
        <p v-else class="projects__text">
            {{ t('project.empty') }}
        </p>
    </MainAside>
</template>

<script setup>
const route = useRoute();
const router = useRouter();
const { t } = useLocale()

const { getters, actions} = globalStore;
const { setProjects } = actions;

const $apiFetch = useApiFetch();
const data = getters.projectsList || await $apiFetch(API_ROUTES.PROJECTS);

const projectsList = computed(() => {
    return getters.projectsList || data.projects
});

onMounted(async () => {
    if(!getters.projectsList) {
        const { overlayLocalProjectTitles } = await import('~/composables/projects')
        setProjects(await overlayLocalProjectTitles(data.projects))
    }
})

const btnLabelValue = computed(() => {
    return route.name === 'home' ? '' : t('project.new')
})

const emit = defineEmits(["closeAside"]);

const createNewProject = () => {
    emit('closeAside');
    router.push({ name: 'home' })
}
</script>
    
<style lang="scss" scoped>
.projects {
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