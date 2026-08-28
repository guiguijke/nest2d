<script setup lang="ts">
    definePageMeta({ middleware: ['admin-auth'] })

    const { data, pending } = await useFetch('/api/stats/retention', {
        credentials: 'include',
    })

    const weeks = [0, 1, 2, 3, 4, 5, 6, 7, 8]

    function cellStyle(pct: number) {
        if (!pct) return {}
        const alpha = Math.min(0.1 + (pct / 100) * 0.8, 0.9)
        return {
            backgroundColor: `rgba(59, 130, 246, ${alpha})`,
            color: pct > 45 ? '#fff' : undefined,
        }
    }
</script>

<template>
    <div class="space-y-5">
        <div>
            <h1 class="text-xl">Rétention</h1>
            <p class="text-xs text-ink-400">
                Cohortes hebdomadaires : % d'utilisateurs actifs (au moins 1 événement tracké) chaque semaine après leur inscription
            </p>
        </div>

        <div
            v-if="pending && !data"
            class="text-sm text-ink-400"
        >
            Chargement…
        </div>

        <template v-else-if="data">
            <section class="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="Utilisateurs suivis"
                    :value="data.summary.trackedUsers"
                    :hint="`sur ${data.summary.totalUsers} inscrits`"
                />
                <StatCard
                    label="Rétention S1"
                    :value="data.summary.w1 != null ? data.summary.w1 + ' %' : '—'"
                    accent="ok"
                    hint="actifs en semaine 1 (cohortes éligibles)"
                />
                <StatCard
                    label="Rétention S4"
                    :value="data.summary.w4 != null ? data.summary.w4 + ' %' : '—'"
                    hint="actifs en semaine 4 (cohortes éligibles)"
                />
            </section>

            <section class="card overflow-x-auto p-0">
                <div class="border-b border-marine-700 px-4 pt-3 pb-2">
                    <h2 class="text-sm font-semibold">Grille de cohortes</h2>
                    <p class="text-[11px] text-ink-400">
                        Ligne = semaine d'inscription · colonne = semaines écoulées · cellule = % d'actifs. Les inscriptions
                        antérieures au tracking apparaissent déflatées.
                    </p>
                </div>
                <table class="w-full text-xs">
                    <thead class="border-b border-marine-700 text-left text-ink-400">
                        <tr>
                            <th class="px-3 py-2 font-medium">Semaine d'inscription</th>
                            <th class="px-3 py-2 font-medium text-right">Inscrits</th>
                            <th
                                v-for="w in weeks"
                                :key="w"
                                class="px-3 py-2 font-medium text-center"
                            >
                                S{{ w }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="c in data.cohorts"
                            :key="c.label"
                            class="border-b border-marine-800 last:border-0"
                        >
                            <td class="px-3 py-1.5 text-ink-200">{{ c.label }}</td>
                            <td class="px-3 py-1.5 text-right font-mono text-ink-300">{{ c.size }}</td>
                            <td
                                v-for="w in weeks"
                                :key="w"
                                class="px-3 py-1.5 text-center font-mono"
                                :style="w <= c.age ? cellStyle(c.retained[w]) : {}"
                                :class="w > c.age ? 'text-marine-600' : c.retained[w] ? 'text-ink-100' : 'text-ink-500'"
                            >
                                {{ w > c.age ? '·' : c.retained[w] + ' %' }}
                            </td>
                        </tr>
                        <tr v-if="!data.cohorts.length">
                            <td
                                colspan="11"
                                class="px-3 py-6 text-center text-ink-400"
                            >
                                Pas encore de données de cohortes.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </template>
    </div>
</template>
