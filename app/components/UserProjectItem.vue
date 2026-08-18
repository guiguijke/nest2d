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
            <!-- J-090 : projet 100 % privé (fichiers jamais uploadés) -->
            <span v-else-if="project.local" class="project__badge">{{ t('project.localBadge') }}</span>
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
        <!-- Poubelle : jamais sur le projet démo partagé (403 serveur).
             Révélée au survol desktop, toujours visible en tactile (CSS). -->
        <MainButton
            v-if="canDelete"
            class="project__btn"
            :icon="iconType.trash"
            :size="sizeType.m"
            :theme="themeType.secondary"
            :label="t('project.delete')"
            :isLabelShow="false"
            trackingTag="project_delete_open"
            @click.stop="openConfirm"
        />
        <DialogWrapper
            v-model:isModalOpen="confirmOpen"
            trackingTag="project_delete"
        >
            <div class="delete-dialog">
                <MainTitle
                    :label="t('project.deleteConfirmTitle', { name: projectName })"
                    class="delete-dialog__title"
                />
                <p class="delete-dialog__text">
                    {{ t(confirmMessageKey) }}
                </p>
                <p
                    v-if="deleteError"
                    class="delete-dialog__error"
                    role="alert"
                >
                    {{ deleteError }}
                </p>
                <div class="delete-dialog__actions">
                    <MainButton
                        :theme="themeType.secondary"
                        :label="t('project.deleteCancel')"
                        :isDisable="deleting"
                        trackingTag="project_delete_cancel"
                        class="delete-dialog__action"
                        @click="confirmOpen = false"
                    />
                    <MainButton
                        :theme="themeType.primary"
                        :label="t('project.deleteConfirm')"
                        :isDisable="deleting"
                        trackingTag="project_delete_confirm"
                        class="delete-dialog__action"
                        @click="confirmDelete"
                    />
                </div>
            </div>
        </DialogWrapper>
    </div>
</template>

<script setup>
import { computed, onBeforeMount, onBeforeUnmount, toRefs, unref } from 'vue';
import { iconType } from '~~/constants/icon.constants';
import { sizeType } from '~~/constants/size.constants';
import { themeType } from '~~/constants/theme.constants';

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

// Suppression (logique dans composables/projects.js — testée en node).
const canDelete = computed(() => canDeleteProject(unref(project)))
const confirmOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const confirmMessageKey = computed(() => deleteConfirmMessageKey(unref(project)))

function openConfirm() {
    deleteError.value = ''
    confirmOpen.value = true
}

async function confirmDelete() {
    if (deleting.value) return
    deleting.value = true
    deleteError.value = ''
    // Si l'utilisateur est SUR la page du projet supprimé (aside du layout
    // auth), deleteProject ramène à /home après succès.
    const result = await deleteProject(unref(project), { currentSlug: route.params.slug })
    deleting.value = false
    if (!result.ok) {
        deleteError.value = t(result.errorKey)
        return
    }
    confirmOpen.value = false
}
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
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        // Room for the trash (absolute, top-right) so the local-project
        // badge never sits on top of it on a narrow aside.
        padding-right: 36px;
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
        flex-shrink: 0;
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--accent-primary);
        color: var(--background-primary);
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        vertical-align: middle;
        position: relative;
        z-index: 0;
    }

    &__btn {
        opacity: 0;
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 2;
        transition: opacity 0.3s;

        // Tactile : pas de survol — la poubelle reste visible en permanence.
        @media (hover: none) {
            opacity: 1;
        }
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
        // Le :hover ne se déclenche pas sur une carte en pointer-events:none :
        // la poubelle du projet courant (aside) reste visible et cliquable —
        // c'est le seul chemin pour supprimer le projet qu'on consulte.
        #{$self}__btn {
            pointer-events: auto;
            opacity: 1;
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

.delete-dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    max-width: 420px;
    text-align: center;

    &__text {
        color: var(--label-secondary);
        font-size: 14px;
        line-height: 1.5;
    }
    &__error {
        color: var(--error-border, #ef4444);
        font-size: 14px;
    }
    &__actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }
    &__action {
        flex: 1;
    }
}
</style>
