<script setup lang="ts">
    definePageMeta({ middleware: ['admin-auth'] })

    const route = useRoute()
    const router = useRouter()

    const search = ref((route.query.q as string) || '')
    const status = ref((route.query.status as string) || '')
    const provider = ref((route.query.provider as string) || '')
    const country = ref((route.query.country as string) || '')
    const sort = ref((route.query.sort as string) || '')
    const page = ref(parseInt((route.query.page as string) || '1') || 1)
    const limit = 50

    // Debounce the search query.
    let debounce: any
    watch(search, () => {
        clearTimeout(debounce)
        debounce = setTimeout(() => {
            page.value = 1
            refresh()
        }, 300)
    })
    // Changing the sort order or country re-reads from page 1, like a new filter.
    watch([sort, country], () => {
        page.value = 1
    })
    watch([status, provider, country, sort, page], () => refresh())

    const queryParams = computed(() => ({
        q: search.value || undefined,
        status: status.value || undefined,
        provider: provider.value || undefined,
        country: country.value || undefined,
        sort: sort.value || undefined,
        page: page.value,
        limit,
    }))

    const { data, pending, error, refresh } = await useFetch('/api/users', {
        query: queryParams,
        credentials: 'include',
    })

    // Country filter options (distinct signup countries with counts).
    const { data: countryData } = await useFetch('/api/users/countries', {
        credentials: 'include',
    })
    const countries = computed(() => countryData.value?.countries || [])

    function syncUrl() {
        router.replace({
            query: {
                q: search.value || undefined,
                status: status.value || undefined,
                provider: provider.value || undefined,
                country: country.value || undefined,
                sort: sort.value || undefined,
                page: page.value,
            },
        })
    }
    watch([search, status, provider, country, sort, page], syncUrl)

    function fmtDate(d: any) {
        if (!d) return '—'
        return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }
    // Relative short format for last activity: « il y a 5 min / 2 j ».
    function fmtRelative(d: any) {
        if (!d) return '—'
        const diff = Date.now() - new Date(d).getTime()
        const min = Math.floor(diff / 60000)
        if (min < 1) return "à l'instant"
        if (min < 60) return `il y a ${min} min`
        const h = Math.floor(min / 60)
        if (h < 24) return `il y a ${h} h`
        const days = Math.floor(h / 24)
        if (days < 30) return `il y a ${days} j`
        const months = Math.floor(days / 30)
        if (months < 12) return `il y a ${months} mois`
        return `il y a ${Math.floor(months / 12)} an(s)`
    }
    function isActive(last: any) {
        return last && Date.now() - new Date(last).getTime() < 5 * 60 * 1000
    }
    function statusBadge(u: any) {
        if (u.banned) return { text: 'Banni', cls: 'bg-err/15 text-err' }
        if (u.subscription?.status === 'active' || u.subscription?.status === 'trialing')
            return { text: 'Abonné', cls: 'bg-ok/15 text-ok' }
        if (u.grantedUntil && new Date(u.grantedUntil) > new Date())
            return { text: 'Offert', cls: 'bg-blue/15 text-blue' }
        return { text: 'Gratuit', cls: 'bg-marine-700 text-ink-300' }
    }

    // ---- Copie d'emails ----
    // The admin panel is served over plain http on the LAN: the async
    // Clipboard API needs a secure context, so fall back to execCommand.
    async function copyText(text: string): Promise<boolean> {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text)
                return true
            }
        } catch {
            /* fall through to execCommand */
        }
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        let ok = false
        try {
            ok = document.execCommand('copy')
        } catch {
            ok = false
        }
        document.body.removeChild(ta)
        return ok
    }

    const copiedId = ref<string | null>(null)
    async function copyEmail(u: any) {
        if (!u.email) return
        if (await copyText(u.email)) {
            copiedId.value = u.id
            setTimeout(() => {
                if (copiedId.value === u.id) copiedId.value = null
            }, 1200)
        }
    }

    const copyingAll = ref(false)
    const copyAllState = ref<'idle' | 'done' | 'empty' | 'error'>('idle')
    async function copyFilteredEmails() {
        copyingAll.value = true
        copyAllState.value = 'idle'
        try {
            const res: any = await $fetch('/api/users', {
                query: { ...queryParams.value, emails: 1 },
                credentials: 'include',
            })
            const emails = res?.emails || []
            if (!emails.length) {
                copyAllState.value = 'empty'
            } else if (await copyText(emails.join('\n'))) {
                copyAllState.value = 'done'
            } else {
                copyAllState.value = 'error'
            }
        } catch {
            copyAllState.value = 'error'
        } finally {
            copyingAll.value = false
            setTimeout(() => (copyAllState.value = 'idle'), 2500)
        }
    }

    // CSV export of the current filter — plain link so the browser handles
    // the download (Content-Disposition does the rest server-side).
    const csvHref = computed(() => {
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(queryParams.value)) {
            if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
        }
        params.set('format', 'csv')
        return `/api/users?${params.toString()}`
    })
</script>

<template>
    <div class="space-y-4">
        <div>
            <h1 class="text-xl">Utilisateurs</h1>
            <p class="text-xs text-ink-400">Rechercher, inspecter et modérer les comptes</p>
        </div>

        <!-- Filters -->
        <div class="card flex flex-wrap items-end gap-3">
            <div class="min-w-[220px] flex-1">
                <label class="label">Recherche</label>
                <input
                    v-model="search"
                    class="input"
                    placeholder="email, nom ou identifiant…"
                />
            </div>
            <div class="w-full sm:w-auto">
                <label class="label">Statut</label>
                <select
                    v-model="status"
                    class="input"
                >
                    <option value="">Tous</option>
                    <option value="active">Actifs (5 min)</option>
                    <option value="subscriber">Abonnés</option>
                    <option value="granted">Accès offert</option>
                    <option value="banned">Bannis</option>
                </select>
            </div>
            <div class="w-full sm:w-auto">
                <label class="label">Provider</label>
                <select
                    v-model="provider"
                    class="input"
                >
                    <option value="">Tous</option>
                    <option value="local">Local</option>
                    <option value="google">Google</option>
                </select>
            </div>
            <div class="w-full sm:w-auto">
                <label class="label">Pays</label>
                <select
                    v-model="country"
                    class="input"
                >
                    <option value="">Tous</option>
                    <option
                        v-for="c in countries"
                        :key="c.code"
                        :value="c.code"
                    >
                        {{ c.code }} ({{ c.count }})
                    </option>
                </select>
            </div>
            <div class="w-full sm:w-auto">
                <label class="label">Tri</label>
                <select
                    v-model="sort"
                    class="input"
                >
                    <option value="">Inscription récente</option>
                    <option value="lastActive">Dernière activité</option>
                </select>
            </div>
        </div>

        <div
            v-if="pending && !data"
            class="text-sm text-ink-400"
        >
            Chargement…
        </div>
        <div
            v-else-if="error"
            class="card border-err/40 text-sm text-err"
        >
            Erreur : {{ error.statusMessage }}
        </div>

        <template v-else-if="data">
            <!-- Desktop table -->
            <div class="card overflow-x-auto p-0 hidden md:block">
                <table class="w-full text-xs">
                    <thead class="border-b border-marine-700 text-left text-ink-400">
                        <tr>
                            <th class="px-3 py-2 font-medium">Utilisateur</th>
                            <th class="px-3 py-2 font-medium">Provider</th>
                            <th class="px-3 py-2 font-medium">Statut</th>
                            <th class="px-3 py-2 font-medium">Pays</th>
                            <th class="px-3 py-2 font-medium">Inscrit le</th>
                            <th class="px-3 py-2 font-medium">Dernière activité</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="u in data.items"
                            :key="u.id"
                            class="table-row-clickable border-b border-marine-800 last:border-0"
                            @click="router.push(`/users/${encodeURIComponent(u.id)}`)"
                        >
                            <td class="px-3 py-2">
                                <div class="font-medium text-white">{{ u.name || '—' }}</div>
                                <div class="flex items-center gap-1">
                                    <span class="text-ink-400">{{ u.email }}</span>
                                    <button
                                        v-if="u.email"
                                        :title="copiedId === u.id ? 'Copié !' : 'Copier le mail'"
                                        class="shrink-0 rounded border px-1 text-[10px] leading-4 transition-colors"
                                        :class="copiedId === u.id ? 'border-ok/50 text-ok' : 'border-marine-700 text-ink-400 hover:text-blue'"
                                        @click.stop="copyEmail(u)"
                                    >
                                        {{ copiedId === u.id ? '✓' : '⧉' }}
                                    </button>
                                </div>
                            </td>
                            <td class="px-3 py-2 text-ink-300">{{ u.provider }}</td>
                            <td class="px-3 py-2">
                                <span
                                    class="badge"
                                    :class="statusBadge(u).cls"
                                    >{{ statusBadge(u).text }}</span
                                >
                            </td>
                            <td class="px-3 py-2 font-mono text-ink-300">{{ u.signupCountry || '—' }}</td>
                            <td class="px-3 py-2 text-ink-300">{{ fmtDate(u.createdAt) }}</td>
                            <td class="px-3 py-2">
                                <span
                                    :class="isActive(u.lastActiveAt) ? 'text-ok' : 'text-ink-400'"
                                    :title="fmtDate(u.lastActiveAt)"
                                    >{{ fmtRelative(u.lastActiveAt) }}</span
                                >
                            </td>
                        </tr>
                        <tr v-if="!data.items.length">
                            <td
                                colspan="6"
                                class="px-3 py-6 text-center text-ink-400"
                            >
                                Aucun utilisateur.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Mobile cards -->
            <div class="space-y-2 md:hidden">
                <button
                    v-for="u in data.items"
                    :key="u.id"
                    class="card block w-full space-y-1.5 p-3 text-left text-xs"
                    @click="router.push(`/users/${encodeURIComponent(u.id)}`)"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="min-w-0 truncate font-medium text-white">{{ u.name || '—' }}</span>
                        <span
                            class="badge shrink-0"
                            :class="statusBadge(u).cls"
                            >{{ statusBadge(u).text }}</span
                        >
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="truncate text-ink-400">{{ u.email }}</span>
                        <span
                            v-if="u.email"
                            role="button"
                            tabindex="0"
                            :title="copiedId === u.id ? 'Copié !' : 'Copier le mail'"
                            class="shrink-0 rounded border px-1 text-[10px] leading-4"
                            :class="copiedId === u.id ? 'border-ok/50 text-ok' : 'border-marine-700 text-ink-400'"
                            @click.stop="copyEmail(u)"
                            @keydown.enter.stop.prevent="copyEmail(u)"
                            >{{ copiedId === u.id ? '✓' : '⧉' }}</span
                        >
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-ink-400">Provider</span>
                        <span class="text-ink-300">{{ u.provider }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-ink-400">Pays</span>
                        <span class="font-mono text-ink-300">{{ u.signupCountry || '—' }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-ink-400">Inscrit le</span>
                        <span class="text-ink-300">{{ fmtDate(u.createdAt) }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-ink-400">Dernière activité</span>
                        <span
                            :class="isActive(u.lastActiveAt) ? 'text-ok' : 'text-ink-400'"
                            :title="fmtDate(u.lastActiveAt)"
                            >{{ fmtRelative(u.lastActiveAt) }}</span
                        >
                    </div>
                </button>
                <p
                    v-if="!data.items.length"
                    class="card p-3 text-center text-xs text-ink-400"
                >
                    Aucun utilisateur.
                </p>
            </div>

            <!-- Pagination -->
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
                <span>{{ data.total }} utilisateur(s) · page {{ data.page }} / {{ data.pages }}</span>
                <div class="flex flex-wrap items-center gap-2">
                    <a
                        :href="csvHref"
                        class="btn-secondary"
                        download
                        >⬇ Export CSV</a
                    >
                    <button
                        class="btn-secondary"
                        :disabled="copyingAll"
                        @click="copyFilteredEmails"
                    >
                        <span v-if="copyingAll">Copie…</span>
                        <span v-else-if="copyAllState === 'done'" class="text-ok">✓ Emails copiés</span>
                        <span v-else-if="copyAllState === 'empty'">Aucun email</span>
                        <span v-else-if="copyAllState === 'error'" class="text-err">Échec de la copie</span>
                        <span v-else>⧉ Copier les emails (filtre courant)</span>
                    </button>
                    <button
                        class="btn-secondary"
                        :disabled="data.page <= 1"
                        @click="page--"
                    >
                        Précédent
                    </button>
                    <button
                        class="btn-secondary"
                        :disabled="data.page >= data.pages"
                        @click="page++"
                    >
                        Suivant
                    </button>
                </div>
            </div>
        </template>
    </div>
</template>
