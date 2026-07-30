<script setup lang="ts">
    definePageMeta({ middleware: ['admin-auth'] })

    const windowDays = ref(1)
    const { data, pending, refresh } = await useFetch('/api/activity/today', {
        query: computed(() => ({ windowDays: windowDays.value })),
        credentials: 'include',
    })

    let poll: any
    onMounted(() => (poll = setInterval(refresh, 30_000)))
    onBeforeUnmount(() => clearInterval(poll))

    function fmtDate(d: any) {
        return d
            ? new Date(d).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
              })
            : '—'
    }
    function fmtDurationMin(min: number): string {
        if (!min) return '0 min'
        if (min < 60) return min + ' min'
        const h = Math.floor(min / 60)
        const m = min % 60
        return h + 'h' + (m ? ' ' + m + 'min' : '')
    }
    const windowLabel = computed(() => (windowDays.value === 1 ? "aujourd'hui" : `${windowDays.value} derniers jours`))
</script>

<template>
    <div class="space-y-5">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-xl">Activité</h1>
                <p class="text-xs text-ink-400">Ce qui s'est passé sur la plateforme — {{ windowLabel }}</p>
            </div>
            <div class="flex items-center gap-2">
                <select
                    v-model.number="windowDays"
                    class="input w-28"
                >
                    <option :value="1">Aujourd'hui</option>
                    <option :value="3">3 jours</option>
                    <option :value="7">7 jours</option>
                </select>
            </div>
        </div>

        <div
            v-if="pending && !data"
            class="text-sm text-ink-400"
        >
            Chargement…
        </div>

        <template v-else-if="data">
            <!-- Résumé en langage simple -->
            <div class="card">
                <p class="text-sm text-ink-100">
                    <span class="font-semibold text-white">{{ data.signups.length }}</span> nouvelle(s) inscription(s),
                    <span class="font-semibold text-white">{{ data.jobsToday.count }}</span> job(s) terminé(s) ({{
                        fmtDurationMin(data.jobsToday.totalTimeMin)
                    }}
                    de calcul) et
                    <span class="font-semibold text-white">{{ data.payments.newSubscriptions }}</span> nouvelle(s)
                    souscription(s).
                </p>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
                <!-- Jobs today -->
                <div class="card space-y-3">
                    <h2 class="text-sm font-semibold">Jobs terminés</h2>
                    <div class="grid grid-cols-2 gap-3">
                        <StatCard
                            label="Total"
                            :value="data.jobsToday.count"
                            accent="ok"
                        />
                        <StatCard
                            label="Temps calcul"
                            :value="fmtDurationMin(data.jobsToday.totalTimeMin)"
                            accent="blue"
                        />
                        <StatCard
                            label="Nesting"
                            :value="data.jobsToday.nestingCount"
                        />
                        <StatCard
                            label="Strip"
                            :value="data.jobsToday.stripCount"
                        />
                    </div>
                    <p
                        v-if="data.jobsToday.avgDensity"
                        class="text-[11px] text-ink-400"
                    >
                        Densité moyenne nesting : {{ Math.round(data.jobsToday.avgDensity * 100) }}%
                    </p>
                </div>

                <!-- Activity pulse -->
                <div class="card space-y-3">
                    <h2 class="text-sm font-semibold">Pic d'activité (par heure)</h2>
                    <div
                        v-if="data.pulse.length"
                        class="flex items-end gap-[2px]"
                        style="height: 56px"
                    >
                        <div
                            v-for="p in data.pulse"
                            :key="p.hour"
                            :title="`${p.hour} — ${p.events} événements`"
                            class="flex-1 rounded-sm bg-blue/60 hover:bg-blue"
                            :style="{
                                height:
                                    Math.max(2, (p.events / Math.max(...data.pulse.map((x: any) => x.events))) * 56) +
                                    'px',
                            }"
                        />
                    </div>
                    <p
                        v-else
                        class="text-[11px] text-ink-400"
                    >
                        Aucune activité enregistrée sur la période.
                    </p>
                </div>
            </div>

            <!-- Recent signups -->
            <div class="card space-y-3 p-0">
                <div class="border-b border-marine-700 px-4 pt-3 pb-2">
                    <h2 class="text-sm font-semibold">Nouvelles inscriptions</h2>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead class="text-left text-ink-400">
                            <tr>
                                <th class="px-3 py-2 font-medium">Date</th>
                                <th class="px-3 py-2 font-medium">Nom</th>
                                <th class="px-3 py-2 font-medium">Email</th>
                                <th class="px-3 py-2 font-medium">Provider</th>
                                <th class="px-3 py-2 font-medium">Pays</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="su in data.signups"
                                :key="su.id"
                                class="border-t border-marine-800"
                            >
                                <td class="px-3 py-1.5 text-ink-300">{{ fmtDate(su.createdAt) }}</td>
                                <td class="px-3 py-1.5">
                                    <NuxtLink
                                        :to="`/users/${encodeURIComponent(su.id)}`"
                                        class="text-ink-200 hover:text-blue hover:underline"
                                        >{{ su.name || '—' }}</NuxtLink
                                    >
                                </td>
                                <td class="px-3 py-1.5 text-ink-400">{{ su.email }}</td>
                                <td class="px-3 py-1.5">
                                    <span class="badge bg-marine-700 text-ink-300">{{ su.provider }}</span>
                                </td>
                                <td class="px-3 py-1.5 font-mono text-ink-300">{{ su.signupCountry || '—' }}</td>
                            </tr>
                            <tr v-if="!data.signups.length">
                                <td
                                    colspan="5"
                                    class="px-3 py-6 text-center text-ink-400"
                                >
                                    Aucune inscription sur la période.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
    </div>
</template>
