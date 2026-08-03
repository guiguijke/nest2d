<template>
    <div 
        :class="projectClasses"
        class="project"
    >
        <NuxtLink
            :to="`/project/${project.slug}`"
            @click="getProject(API_ROUTES.PROJECT(project.slug))"
            class="project__label"
        >
            {{ projectName }}
            <span v-if="project.isDemo" class="project__badge">{{ t('demo.badge') }}</span>
        </NuxtLink>
        <div class="project__info info">
            <p class="info__time">
                {{ timeAgo }}
            </p>
            <p 
                v-if="project.results"
                class="info__results"
            >
                {{ resultsLabel }}
            </p>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeMount, onBeforeUnmount, toRefs, unref } from 'vue';

const { project } = defineProps({
    project: {
        type: Object,
        required: true,
    },
}) 
const route = useRoute()
const now = ref(new Date())
const { t } = useLocale()

const { actions } = filesStore;
const { getProject } = actions;

const projectClasses = computed(() => ({
    'project--active': unref(project).slug === route.params.slug
}))
// The shared demo project carries a generic DB name — localize it.
const projectName = computed(() =>
    project.isDemo ? t('demo.projectName') : project.name
)
const timeAgo = computed(() => {
    const past = new Date(project.createdAt);
    const diffMs = unref(now) - past;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffMinutes / 1440);

    if (diffMinutes < 1) {
        return t('time.justNow');
    }
    if (diffHours >= 1 && diffHours < 24) {
        return t('time.hoursAgo', { n: diffHours });
    }
    if (diffDays >= 1) {
        return diffDays === 1 ? t('time.dayAgo') : t('time.daysAgo', { n: diffDays });
    }

    return t('time.minAgo', { n: diffMinutes });
})
const resultsLabel = computed(() => {
    const resultWord = unref(project).results === 1 ? t('project.result') : t('project.results');
    return `${unref(project).results} ${resultWord}`;
})

// Refresh "time ago" labels once a minute so they stay current.
let timer;
onBeforeMount(() => {
    timer = setInterval(() => {
        now.value = new Date()
    }, 60000)
})
onBeforeUnmount(() => {
    clearInterval(timer)
})
</script>

<style lang="scss" scoped>
.project {
    $self: &;

    color: var(--label-tertiary);
    position: relative;
    padding: 16px;
    border-radius: 8px;
    transition: color 0.3s;

    &::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        pointer-events: none;
        border: 1px solid var(--separator-secondary);
        transition: border-color 0.3s;
        border-radius: 8px;
    }

    &__label {
        display: block;
        color: var(--label-secondary);
        transition: color 0.3s;

        &::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            right: 0;
        }
    }

    &__badge {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--accent-primary);
        color: var(--background-primary);
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        vertical-align: middle;
    }

    &__btn {
        opacity: 0;
        position: absolute;
        top: 8px;
        right: 8px;
        transition: opacity 0.3s;
    }

    &__info {
        margin-top: 16px;
    }

    @media (hover:hover) {
        &:hover {
            color: var(--label-secondary);

            &::after {
                border-color: var(--separator-primary);
            }
            #{$self}__label {
                color: var(--label-primary);
            }
            #{$self}__btn {
                opacity: 1;
            }
        }
    }

    &--active {
        pointer-events: none;
        color: var(--label-secondary);
        &::after {
            border-width: 2px;
            border-color: var(--accent-primary);
        }
        #{$self}__label {
            color: var(--label-primary);
        }
    }
}

.info {
    display: flex;

    &__time,
    &__results {
        flex-basis: 50%;
    }
    &__results {
        text-align: right;
    }
}
</style>
