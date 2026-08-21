<template>
    <div class="home">
        <!-- Account summary -->
        <section class="home__welcome welcome">
            <Avatar
                :size="sizeType.m"
                class="welcome__avatar"
            />
            <div class="welcome__body">
                <h1 class="welcome__title">{{ greeting }}, {{ userName }} 👋</h1>
                <p class="welcome__text">
                    <NuxtLink
                        to="/profile"
                        class="welcome__link"
                    >
                        {{ t('home.manageAccount') }}
                    </NuxtLink>
                </p>
            </div>
        </section>

        <!-- Activity stats -->
        <UserStats class="home__stats" />

        <!-- New nesting: the original DXF upload, kept verbatim -->
        <section class="home__create create">
            <MainTitle
                :label="t('home.newNesting')"
                class="create__title"
            />
            <PrivacyModePicker
                v-if="localImportEnabled"
                v-model="privacyChoice"
                class="create__privacy"
            />
            <DxfUpload
                :extensions="uploadExtensions"
                @files="handleSubmit"
                @rejected="handleRejected"
            />
            <div
                v-if="error"
                class="create__error"
            >
                {{ error }}
            </div>
        </section>

        <!-- Recent projects -->
        <section class="home__recent recent">
            <h2 class="recent__title">{{ t('home.recentProjects') }}</h2>
            <div
                v-if="recentProjects.length"
                class="recent__grid grid"
            >
                <UserProjectItem
                    v-for="project in recentProjects"
                    :key="project.slug"
                    :project="project"
                    class="grid__item"
                />
            </div>
            <p
                v-else
                class="recent__empty"
            >
                {{ t('home.noProjects') }}
            </p>
        </section>

        <NewsletterPrompt />
    </div>
</template>

<script setup>
    import { sizeType } from '~~/constants/size.constants'

    const { t } = useLocale()

    definePageMeta({
        layout: 'auth',
        middleware: 'auth',
    })

    const router = useRouter()

    onMounted(async () => {
        trackEvent('page_view', { page: 'dashboard' })
        const route = useRoute()

        const subscriptionInternalId = route.query.subscriptionInternalId
        if (subscriptionInternalId) {
            try {
                await $fetch('/api/payment/subscription/check?subscriptionInternalId=' + subscriptionInternalId, {
                    method: 'POST',
                })
                // Refresh the cached user so freeRemaining / subscriptionStatus update.
                await setUser()
            } catch (err) {
                console.error('Subscription confirmation failed:', err)
            }
            // Drop the query param so a refresh doesn't re-trigger the check.
            router.replace({ path: '/home' })
        }
    })

    const { getters: authGetters, actions: authActions } = authStore
    const { setUser } = authActions
    const { user } = authGetters

    const userName = computed(() => unref(user)?.name || '')

    // Time-of-day greeting — small touch that makes the dashboard feel personal.
    const greeting = computed(() => {
        const h = new Date().getHours()
        if (h < 6) return t('home.greeting.night')
        if (h < 12) return t('home.greeting.morning')
        if (h < 18) return t('home.greeting.afternoon')
        return t('home.greeting.evening')
    })

    const { actions: filesActions } = filesStore
    const { getProject } = filesActions

    const error = ref('')

    // J-090 : la création 100 % privée n'apparaît que si l'import navigateur
    // est activé (ET le compute local — le solve tourne aussi sur l'appareil).
    const config = useRuntimeConfig()
    const localImportEnabled = computed(() =>
        (config.public.localComputeEnabled === true || config.public.localComputeEnabled === 'true') &&
        (config.public.localImportEnabled === true || config.public.localImportEnabled === 'true')
    )
    // Défaut = cet appareil dès que l'import navigateur est dispo (opt-out
    // cloud : DWG, multi-appareils).
    const privacyChoice = ref(localImportEnabled.value ? 'device' : 'cloud')
    const localProject = computed(() => privacyChoice.value === 'device')
    watch(privacyChoice, () => { error.value = '' })
    const uploadExtensions = computed(() =>
        localProject.value && localImportEnabled.value
            ? ['.dxf', '.svg']
            : ['.dxf', '.svg', '.dwg']
    )

    const handleRejected = (files) => {
        const names = (files || []).map((f) => String(f.name || '').toLowerCase())
        if (names.some((n) => n.endsWith('.dwg')) && localProject.value) {
            error.value = t('localImport.dwgRejected')
            return
        }
        error.value = localProject.value
            ? t('localImport.unsupportedType')
            : t('upload.unsupported')
    }

    const handleSubmit = async (files) => {
        error.value = ''
        if (!files?.length) return

        if (localProject.value && localImportEnabled.value) {
            // J-090 : création JSON sans fichiers — l'import navigateur des
            // fichiers déposés se fait sur la page projet (IndexedDB).
            try {
                const data = await $fetch(API_ROUTES.PROJECT(), {
                    method: 'POST',
                    body: { local: true },
                })
                filesActions.setPendingLocalFiles(files)
                await getProjects()
                router.push({ path: `/project/${data.slug}` })
            } catch (err) {
                if (err.response) {
                    const errorData = await err.response.json()
                    error.value = errorData.message
                } else {
                    error.value = t('home.error.unexpected')
                }
            }
            return
        }

        const formData = new FormData()
        files.forEach((file) => formData.append('dxf', file))

        try {
            const data = await $fetch(API_ROUTES.PROJECT(), {
                method: 'POST',
                body: formData,
            })

            await Promise.all([getProjects(), getProject(API_ROUTES.PROJECT(data.slug))])

            router.push({ path: `/project/${data.slug}` })
        } catch (err) {
            if (err.response) {
                const errorData = await err.response.json()
                error.value = errorData.message
            } else {
                error.value = t('home.error.unexpected')
            }
        }
    }

    // Recent projects for the dashboard grid. Reads the shared cache populated by
    // the UserProjects aside; falls back to an SSR-aware fetch on first paint so
    // the dashboard shows data even before the store is hydrated.
    const { getters: globalGetters, actions: globalActions } = globalStore
    const { getProjects } = globalActions

    const $apiFetch = useApiFetch()
    const projectsData = globalGetters.projectsList ? null : await $apiFetch(API_ROUTES.PROJECTS).catch(() => null)

    onMounted(() => {
        // Hydrate the shared store so the aside + dashboard stay in sync.
        if (!globalGetters.projectsList && projectsData?.projects) {
            globalActions.setProjects(projectsData.projects)
        }
    })

    const recentProjects = computed(() => {
        const list = globalGetters.projectsList || projectsData?.projects || []
        // Most recent first; cap at 4 for the dashboard overview.
        return [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4)
    })
</script>

<style lang="scss" scoped>
    .home {
        display: flex;
        flex-direction: column;
        gap: 32px;
        text-align: center;
    }

    // ---------- Welcome ----------
    .welcome {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;

        @media (min-width: 567px) {
            flex-direction: row;
            text-align: left;
        }

        &__body {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        &__title {
            color: var(--label-primary);
            font-weight: 700;
            font-size: 1.5rem;

            @media (min-width: 567px) {
                font-size: 1.75rem;
            }
        }

        &__text {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 16px;
            color: var(--label-secondary);
            font-size: 14px;
        }

        &__link {
            color: var(--accent-primary);
            font-weight: 600;
            text-decoration: underline;

            @media (hover: hover) {
                &:hover {
                    opacity: 0.8;
                }
            }
        }
    }

    // ---------- Create / upload ----------
    .create {
        border: 1px solid var(--separator-secondary);
        border-radius: 16px;
        padding: 24px 16px;
        background-color: var(--fill-tertiary);

        @media (min-width: 567px) {
            padding: 32px;
        }

        &__title {
            margin-bottom: 16px;
        }

        &__privacy {
            margin-bottom: 16px;
        }

        &__error {
            margin-top: 16px;
            padding: 12px;
            background-color: var(--error-background);
            border: solid 1px var(--error-border);
            border-radius: 8px;
        }
    }

    // ---------- Recent projects ----------
    .recent {
        &__title {
            color: var(--label-primary);
            font-weight: 700;
            font-size: 1.125rem;
            margin-bottom: 16px;
        }

        &__empty {
            color: var(--label-tertiary);
            font-size: 14px;
            padding: 24px;
            border: 1px dashed var(--separator-secondary);
            border-radius: 12px;
        }
    }

    .grid {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr;
        text-align: left;

        @media (min-width: 567px) {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
