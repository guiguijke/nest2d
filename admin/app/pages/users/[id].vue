<script setup lang="ts">
    definePageMeta({ middleware: ['admin-auth'] })

    const route = useRoute()
    const router = useRouter()
    const id = decodeURIComponent(route.params.id as string)

    const { data, pending, error, refresh } = await useFetch('/api/users/' + encodeURIComponent(id), {
        credentials: 'include',
    })
    const { data: activity } = await useFetch('/api/users/' + encodeURIComponent(id) + '/activity', {
        credentials: 'include',
    })
    const { data: newsletter } = await useFetch('/api/users/' + encodeURIComponent(id) + '/newsletter', {
        credentials: 'include',
    })

    // Badge for the listmonk subscriber status (blocklisted = opted out).
    function newsletterBadge(nl: any) {
        if (!nl?.configured) return { text: 'Non configuré', cls: 'bg-marine-700 text-ink-300' }
        if (nl?.error) return { text: 'Erreur listmonk', cls: 'bg-err/15 text-err' }
        const s = nl?.subscriber?.status
        if (s === 'enabled') return { text: 'Abonné', cls: 'bg-ok/15 text-ok' }
        if (s === 'unconfirmed') return { text: 'Non confirmé', cls: 'bg-warn/15 text-warn' }
        if (s === 'blocklisted') return { text: 'Désabonné', cls: 'bg-err/15 text-err' }
        return { text: 'Inconnu de listmonk', cls: 'bg-marine-700 text-ink-300' }
    }
    // Rate as a rounded percentage, guarded against divide-by-zero. listmonk
    // views/clicks are per-campaign aggregates (the API exposes nothing
    // per-subscriber), so these are campaign-level rates.
    function pct(part: number, whole: number): string {
        if (!whole) return '—'
        return Math.round((part / whole) * 100) + ' %'
    }

    function fmtDurationMin(min: number): string {
        if (!min) return '0 min'
        if (min < 60) return min + ' min'
        const h = Math.floor(min / 60)
        const m = min % 60
        return h + 'h' + (m ? ' ' + m + 'min' : '')
    }

    const acting = ref(false)
    const banReason = ref('')
    const freeMonthReason = ref('')
    const lastMsg = ref('')
    // Tier de test (D-PAY-11) : promotion admin sans Stripe, réversible à
    // volonté. 'standard' = Illimité (4 vcores/4 walks), 'privacy' = Pro
    // (8 vcores/8 walks, file prioritaire).
    const grantTier = ref<'standard' | 'privacy'>('standard')
    const grantDays = ref(30)

    const grantActive = computed(() => {
        const g = data.value?.user?.grantedUntil
        return g && new Date(g) > new Date()
    })
    const grantTierLabel = computed(() =>
        data.value?.user?.grantedTier === 'privacy' ? 'Pro' : 'Illimité',
    )

    async function applyGrant() {
        const days = Math.max(1, Math.min(3650, Number(grantDays.value) || 30))
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        await patch({ action: 'setGrantedUntil', until, tier: grantTier.value })
    }

    async function clearGrant() {
        await patch({ action: 'setGrantedUntil', until: null })
    }

    async function patch(body: any) {
        acting.value = true
        lastMsg.value = ''
        try {
            const res = await $fetch('/api/users/' + encodeURIComponent(id), {
                method: 'PATCH',
                body,
                credentials: 'include',
            })
            lastMsg.value = `✓ ${res.summary}`
            await refresh()
        } catch (e: any) {
            lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
        } finally {
            acting.value = false
        }
    }

    async function grantMonth() {
        acting.value = true
        lastMsg.value = ''
        try {
            const res = await $fetch(`/api/users/${encodeURIComponent(id)}/free-month`, {
                method: 'POST',
                body: { reason: freeMonthReason.value },
                credentials: 'include',
            })
            lastMsg.value = `✓ Mois offert (${res.method})`
            await refresh()
        } catch (e: any) {
            lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
        } finally {
            acting.value = false
        }
    }

    function fmtDate(d: any) {
        if (!d) return '—'
        return new Date(d).toLocaleString('fr-FR')
    }
    const u = computed(() => data.value?.user)
</script>

<template>
    <div class="space-y-5">
        <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-3">
                <button
                    class="btn-ghost shrink-0"
                    @click="router.push('/users')"
                >
                    ← Retour
                </button>
                <div class="min-w-0">
                    <h1 class="text-xl truncate">{{ u?.name || '—' }}</h1>
                    <p class="text-xs text-ink-400 truncate">{{ u?.email }} · {{ u?.id }}</p>
                </div>
            </div>
            <a
                v-if="u"
                :href="`${useRuntimeConfig().public.appBaseUrl}/project/_`"
                class="btn-secondary shrink-0"
                target="_blank"
                rel="noopener"
            >
                Voir dans l'app ↗
            </a>
        </div>

        <div
            v-if="pending"
            class="text-sm text-ink-400"
        >
            Chargement…
        </div>
        <div
            v-else-if="error"
            class="card border-err/40 text-sm text-err"
        >
            {{ error.statusMessage }}
        </div>

        <template v-else-if="data">
            <p
                v-if="lastMsg"
                class="text-xs text-ink-200"
            >
                {{ lastMsg }}
            </p>

            <div class="grid gap-4 lg:grid-cols-3">
                <!-- Profile -->
                <section class="card space-y-3">
                    <h2 class="text-sm font-semibold">Profil</h2>
                    <dl class="space-y-1.5 text-xs">
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Provider</dt>
                            <dd>{{ u.provider }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Inscrit le</dt>
                            <dd>{{ fmtDate(u.createdAt) }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Dernière activité</dt>
                            <dd>{{ fmtDate(u.lastActiveAt) }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Pays (inscription)</dt>
                            <dd class="font-mono">{{ u.signupCountry || '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">IP (inscription)</dt>
                            <dd class="font-mono">{{ u.signupIp || '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Sessions actives</dt>
                            <dd>{{ data.activity.activeSessions }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Banni</dt>
                            <dd>
                                <span
                                    v-if="u.banned"
                                    class="badge bg-err/15 text-err"
                                    >oui</span
                                >
                                <span
                                    v-else
                                    class="text-ink-400"
                                    >non</span
                                >
                            </dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Accès offert</dt>
                            <dd>
                                <template v-if="u.grantedUntil">
                                    <span class="badge bg-ok/15 text-ok">{{ grantTierLabel }}</span>
                                    jusqu'au {{ fmtDate(u.grantedUntil) }}
                                </template>
                                <template v-else>—</template>
                            </dd>
                        </div>
                    </dl>
                </section>

                <!-- Subscription -->
                <section class="card space-y-3">
                    <h2 class="text-sm font-semibold">Abonnement</h2>
                    <dl
                        class="space-y-1.5 text-xs"
                        v-if="u.subscription"
                    >
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Statut</dt>
                            <dd>{{ u.subscription.status }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Price ID</dt>
                            <dd class="font-mono truncate max-w-[160px]">{{ u.subscription.priceId || '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Fin de période</dt>
                            <dd>{{ fmtDate(u.subscription.currentPeriodEnd) }}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Sub Stripe</dt>
                            <dd class="font-mono truncate max-w-[160px]">
                                {{ u.subscription.stripeSubscriptionId || '—' }}
                            </dd>
                        </div>
                    </dl>
                    <p
                        v-else
                        class="text-xs text-ink-400"
                    >
                        Aucun abonnement.
                    </p>
                </section>

                <!-- Activity -->
                <section class="card space-y-3">
                    <h2 class="text-sm font-semibold">Activité</h2>
                    <dl class="grid grid-cols-2 gap-1.5 text-xs">
                        <div>
                            <dt class="text-ink-400">Projets</dt>
                            <dd class="font-mono text-lg">{{ data.activity.projects }}</dd>
                        </div>
                        <div>
                            <dt class="text-ink-400">Strip projets</dt>
                            <dd class="font-mono text-lg">{{ data.activity.stripProjects }}</dd>
                        </div>
                        <div>
                            <dt class="text-ink-400">Jobs total</dt>
                            <dd class="font-mono text-lg">{{ data.activity.jobsTotal }}</dd>
                        </div>
                        <div>
                            <dt class="text-ink-400">Jobs échoués</dt>
                            <dd class="font-mono text-lg text-err">{{ data.activity.jobsFailed }}</dd>
                        </div>
                        <div>
                            <dt class="text-ink-400">Fichiers DXF</dt>
                            <dd class="font-mono text-lg">{{ data.activity.dxfFiles }}</dd>
                        </div>
                        <div>
                            <dt class="text-ink-400">Événements</dt>
                            <dd class="font-mono text-lg">{{ data.activity.trackingEvents }}</dd>
                        </div>
                    </dl>
                </section>
            </div>

            <!-- Newsletter (listmonk) -->
            <section
                v-if="newsletter"
                class="card space-y-3"
            >
                <div class="flex items-center justify-between gap-2">
                    <h2 class="text-sm font-semibold">Newsletter</h2>
                    <span
                        class="badge"
                        :class="newsletterBadge(newsletter).cls"
                        >{{ newsletterBadge(newsletter).text }}</span
                    >
                </div>

                <p
                    v-if="!newsletter.configured"
                    class="text-xs text-ink-400"
                >
                    listmonk n'est pas configuré (NUXT_ADMIN_LISTMONK_* / NUXT_LISTMONK_*).
                </p>
                <p
                    v-else-if="newsletter.error"
                    class="text-xs text-err"
                >
                    {{ newsletter.error }}
                </p>
                <template v-else>
                    <dl class="space-y-1.5 text-xs">
                        <div class="flex justify-between">
                            <dt class="text-ink-400">Opt-in applicatif</dt>
                            <dd>{{ newsletter.optIn ? 'oui' : 'non' }}</dd>
                        </div>
                        <div
                            v-if="newsletter.subscriber"
                            class="flex justify-between"
                        >
                            <dt class="text-ink-400">Inscrit le</dt>
                            <dd>{{ fmtDate(newsletter.subscriber.createdAt) }}</dd>
                        </div>
                        <div
                            v-if="newsletter.subscriber?.lists?.length"
                            class="flex justify-between"
                        >
                            <dt class="text-ink-400">Listes</dt>
                            <dd class="text-right">
                                <span
                                    v-for="l in newsletter.subscriber.lists"
                                    :key="l.id"
                                    class="ml-1"
                                    >{{ l.name }}<span
                                        v-if="l.status"
                                        class="text-ink-400"
                                    >
                                        ({{ l.status }})</span
                                    ></span
                                >
                            </dd>
                        </div>
                    </dl>
                    <p
                        v-if="!newsletter.subscriber"
                        class="text-xs text-ink-400"
                    >
                        Cet email est inconnu de listmonk (jamais inscrit ou supprimé).
                    </p>

                    <!-- Campaign aggregates — listmonk exposes NO per-subscriber
                         opens/clicks, only per-campaign totals. -->
                    <p
                        v-if="newsletter.campaignsError"
                        class="text-xs text-ink-400"
                    >
                        Campagnes inaccessibles pour cet utilisateur API listmonk
                        ({{ newsletter.campaignsError }}) — le statut d'abonnement
                        ci-dessus reste exact.
                    </p>
                    <template v-if="newsletter.campaigns?.length">
                        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-400">
                            Campagnes (agrégats plateforme)
                        </h3>
                        <!-- Desktop table -->
                        <table class="w-full text-xs hidden md:table">
                            <thead class="text-left text-ink-400">
                                <tr>
                                    <th class="py-1 pr-3 font-medium">Nom</th>
                                    <th class="py-1 pr-3 font-medium">Statut</th>
                                    <th class="py-1 pr-3 font-medium">Envoyés</th>
                                    <th class="py-1 pr-3 font-medium">Ouverture</th>
                                    <th class="py-1 font-medium">Clics</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="c in newsletter.campaigns"
                                    :key="c.id"
                                    class="border-t border-marine-800"
                                >
                                    <td class="py-1 pr-3 text-white">{{ c.name }}</td>
                                    <td class="py-1 pr-3 text-ink-300">{{ c.status }}</td>
                                    <td class="py-1 pr-3 font-mono text-ink-300">{{ c.sent }}</td>
                                    <td class="py-1 pr-3 font-mono text-ink-300">{{ pct(c.views, c.sent) }}</td>
                                    <td class="py-1 font-mono text-ink-300">{{ pct(c.clicks, c.sent) }}</td>
                                </tr>
                            </tbody>
                        </table>
                        <!-- Mobile cards -->
                        <div class="space-y-2 md:hidden">
                            <div
                                v-for="c in newsletter.campaigns"
                                :key="c.id"
                                class="space-y-1 border-t border-marine-800 pt-2 text-xs first:border-0 first:pt-0"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <span class="min-w-0 truncate text-white">{{ c.name }}</span>
                                    <span class="shrink-0 text-ink-400">{{ c.status }}</span>
                                </div>
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-ink-400">Envoyés</span>
                                    <span class="font-mono text-ink-300">{{ c.sent }}</span>
                                </div>
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-ink-400">Ouverture / clics</span>
                                    <span class="font-mono text-ink-300"
                                        >{{ pct(c.views, c.sent) }} / {{ pct(c.clicks, c.sent) }}</span
                                    >
                                </div>
                            </div>
                        </div>
                    </template>
                    <p
                        v-else
                        class="text-xs text-ink-400"
                    >
                        Aucune campagne.
                    </p>
                </template>
            </section>

            <!-- Usage & recent jobs -->
            <section
                v-if="activity"
                class="space-y-3"
            >
                <div class="flex items-center justify-between">
                    <h2 class="text-sm font-semibold">Activité &amp; temps de calcul</h2>
                    <span class="text-[11px] text-ink-400">{{ activity.totals.totalJobs }} job(s) au total</span>
                </div>

                <div class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
                    <StatCard
                        label="Temps consommé"
                        :value="fmtDurationMin(activity.totals.totalTimeMin)"
                        accent="blue"
                    />
                    <StatCard
                        label="Densité moyenne"
                        :value="activity.totals.avgDensity ? Math.round(activity.totals.avgDensity * 100) + '%' : '—'"
                    />
                    <StatCard
                        label="Pièces imbriquées"
                        :value="activity.totals.placed"
                    />
                    <StatCard
                        label="Feuilles utilisées"
                        :value="activity.totals.sheets"
                    />
                    <StatCard
                        label="Jobs échoués"
                        :value="activity.totals.failed"
                        accent="err"
                    />
                </div>

                <div class="card space-y-3">
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-400">30 derniers jobs</h3>
                    <JobTable :jobs="activity.jobs" />
                </div>
            </section>

            <!-- Actions -->
            <section class="grid gap-4 md:grid-cols-2">
                <div class="card space-y-3">
                    <h2 class="text-sm font-semibold">Sessions</h2>
                    <div class="flex gap-2">
                        <button
                            class="btn-secondary w-full sm:w-auto"
                            :disabled="acting"
                            @click="patch({ action: 'revokeSessions' })"
                        >
                            Déconnecter (toutes sessions)
                        </button>
                    </div>
                </div>

                <div class="card space-y-3">
                    <h2 class="text-sm font-semibold">Tier de test (sans Stripe)</h2>
                    <p
                        v-if="grantActive"
                        class="text-[11px] text-ink-400"
                    >
                        Actif : <span class="badge bg-ok/15 text-ok">{{ grantTierLabel }}</span>
                        jusqu'au {{ fmtDate(u.grantedUntil) }}
                    </p>
                    <div class="flex flex-col gap-2 sm:flex-row">
                        <div class="flex-1">
                            <label class="label">Tier</label>
                            <select
                                v-model="grantTier"
                                class="input"
                            >
                                <option value="standard">Illimité (4 vcores · 4 walks · 3 directions)</option>
                                <option value="privacy">Pro (8 vcores · 8 walks · file prioritaire)</option>
                            </select>
                        </div>
                        <div class="sm:w-28">
                            <label class="label">Jours</label>
                            <input
                                v-model.number="grantDays"
                                type="number"
                                min="1"
                                max="3650"
                                class="input"
                            />
                        </div>
                    </div>
                    <div class="flex flex-col gap-2 sm:flex-row">
                        <button
                            class="btn-primary flex-1"
                            :disabled="acting"
                            @click="applyGrant"
                        >
                            Appliquer le tier
                        </button>
                        <button
                            v-if="grantActive"
                            class="btn-secondary flex-1"
                            :disabled="acting"
                            @click="clearGrant"
                        >
                            Retirer (retour Gratuit)
                        </button>
                    </div>
                    <p class="text-[11px] text-ink-400">
                        Grant local réversible, sans paiement — pour les tests. Un abonnement Stripe actif prime toujours sur le grant.
                    </p>
                </div>

                <div class="card space-y-3">
                    <h2 class="text-sm font-semibold">Mois gratuit</h2>
                    <div>
                        <label class="label">Raison (optionnel)</label>
                        <input
                            v-model="freeMonthReason"
                            class="input"
                            placeholder="compensation suite à un bug…"
                        />
                    </div>
                    <button
                        class="btn-primary w-full sm:w-auto"
                        :disabled="acting"
                        @click="grantMonth"
                    >
                        Offrir un mois
                    </button>
                    <p class="text-[11px] text-ink-400">
                        Abonné Stripe → coupon 100 % sur un cycle. Sinon → accès local 30 jours.
                    </p>
                </div>

                <div class="card space-y-3 md:col-span-2">
                    <h2 class="text-sm font-semibold">Modération</h2>
                    <template v-if="!u.banned">
                        <div>
                            <label class="label">Raison du bannissement (optionnel)</label>
                            <input
                                v-model="banReason"
                                class="input"
                            />
                        </div>
                        <button
                            class="btn-danger w-full sm:w-auto"
                            :disabled="acting"
                            @click="patch({ action: 'ban', reason: banReason })"
                        >
                            Bannir l'utilisateur
                        </button>
                    </template>
                    <template v-else>
                        <p class="text-xs text-ink-300">
                            Banni le {{ fmtDate(u.bannedAt) }} — {{ u.bannedReason || 'sans raison' }}
                        </p>
                        <button
                            class="btn-secondary w-full sm:w-auto"
                            :disabled="acting"
                            @click="patch({ action: 'unban' })"
                        >
                            Lever le bannissement
                        </button>
                    </template>
                </div>
            </section>

            <!-- Recent events -->
            <section class="card space-y-3">
                <h2 class="text-sm font-semibold">Événements récents</h2>
                <div
                    v-if="data.recentEvents.length"
                    class="max-h-64 overflow-y-auto"
                >
                    <!-- Desktop table -->
                    <table class="w-full text-xs hidden md:table">
                        <thead class="text-left text-ink-400">
                            <tr>
                                <th class="py-1 pr-3 font-medium">Date</th>
                                <th class="py-1 pr-3 font-medium">Pays</th>
                                <th class="py-1 font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="(e, i) in data.recentEvents"
                                :key="i"
                                class="border-t border-marine-800"
                            >
                                <td class="py-1 pr-3 text-ink-300">{{ fmtDate(e.timestamp) }}</td>
                                <td class="py-1 pr-3 font-mono text-ink-300">{{ e.country || '—' }}</td>
                                <td class="py-1 font-mono">{{ e.action }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <!-- Mobile rows -->
                    <div class="space-y-1.5 md:hidden">
                        <div
                            v-for="(e, i) in data.recentEvents"
                            :key="i"
                            class="flex items-center justify-between gap-2 border-t border-marine-800 pt-1.5 text-xs first:border-0 first:pt-0"
                        >
                            <span class="min-w-0 truncate font-mono">{{ e.action }}</span>
                            <span class="shrink-0 font-mono text-ink-300">{{ e.country || '—' }}</span>
                            <span class="shrink-0 text-ink-300">{{ fmtDate(e.timestamp) }}</span>
                        </div>
                    </div>
                </div>
                <p
                    v-else
                    class="text-xs text-ink-400"
                >
                    Aucun événement.
                </p>
            </section>
        </template>
    </div>
</template>
