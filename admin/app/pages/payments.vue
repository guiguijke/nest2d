<script setup lang="ts">
    definePageMeta({ middleware: ['admin-auth'] })

    const { data, pending } = await useFetch('/api/payments', {
        credentials: 'include',
    })

    function fmtDate(d: any) {
        return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
    }
    function fmtEur(n: number | null): string {
        if (n == null) return '—'
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
    }
    function tierBadge(tier: string) {
        return tier === 'privacy' ? 'bg-blue/15 text-blue' : 'bg-marine-700 text-ink-300'
    }
</script>

<template>
    <div class="space-y-5">
        <div>
            <h1 class="text-xl">Paiements</h1>
            <p class="text-xs text-ink-400">Revenus et abonnements actifs</p>
        </div>

        <div
            v-if="pending && !data"
            class="text-sm text-ink-400"
        >
            Chargement…
        </div>

        <template v-else-if="data">
            <!-- Financial KPIs -->
            <section class="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="MRR estimé"
                    :value="fmtEur(data.kpis.mrrEur)"
                    accent="ok"
                    hint="abonnements payants actifs"
                />
                <StatCard
                    label="Abonnés actifs"
                    :value="data.kpis.activeSubscribers"
                    :hint="`dont ${data.kpis.trialing} en essai`"
                />
                <StatCard
                    label="Dont privacy"
                    :value="data.kpis.privacyTier"
                />
            </section>

            <!-- Subscriptions -->
            <section class="card space-y-3 p-0">
                <div class="border-b border-marine-700 px-4 pt-3 pb-2">
                    <h2 class="text-sm font-semibold">Abonnements actifs</h2>
                    <p class="text-[11px] text-ink-400">Utilisateurs avec un abonnement Stripe en cours</p>
                </div>
                <div class="overflow-x-auto hidden md:block">
                    <table class="w-full text-xs">
                        <thead class="border-b border-marine-700 text-left text-ink-400">
                            <tr>
                                <th class="px-3 py-2 font-medium">Utilisateur</th>
                                <th class="px-3 py-2 font-medium">Statut</th>
                                <th class="px-3 py-2 font-medium">Tier</th>
                                <th class="px-3 py-2 font-medium text-right">Montant</th>
                                <th class="px-3 py-2 font-medium">Fin de période</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="s in data.subscriptions"
                                :key="s.userId"
                                class="border-b border-marine-800 last:border-0"
                            >
                                <td class="px-3 py-1.5">
                                    <NuxtLink
                                        :to="`/users/${encodeURIComponent(s.userId)}`"
                                        class="text-ink-200 hover:text-blue hover:underline"
                                    >
                                        {{ s.name || s.email || s.userId.slice(0, 20) }}
                                    </NuxtLink>
                                </td>
                                <td class="px-3 py-1.5">
                                    <span
                                        class="badge"
                                        :class="s.status === 'active' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'"
                                        >{{ s.status }}</span
                                    >
                                    <span
                                        v-if="s.cancelAtPeriodEnd"
                                        class="ml-1 text-[10px] text-warn"
                                        >annulé en cours</span
                                    >
                                </td>
                                <td class="px-3 py-1.5">
                                    <span
                                        class="badge"
                                        :class="tierBadge(s.tier)"
                                        >{{ s.tier }}</span
                                    >
                                </td>
                                <td class="px-3 py-1.5 text-right font-mono text-ink-200">
                                    {{ fmtEur(s.planPriceEur) }}
                                </td>
                                <td class="px-3 py-1.5 text-ink-300">{{ fmtDate(s.currentPeriodEnd) }}</td>
                            </tr>
                            <tr v-if="!data.subscriptions.length">
                                <td
                                    colspan="5"
                                    class="px-3 py-6 text-center text-ink-400"
                                >
                                    Aucun abonné actif.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <!-- Mobile cards -->
                <div class="space-y-2 p-3 md:hidden">
                    <div
                        v-for="s in data.subscriptions"
                        :key="s.userId"
                        class="rounded-[4px] border border-marine-700 bg-marine-900/40 space-y-1.5 p-3 text-xs"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <NuxtLink
                                :to="`/users/${encodeURIComponent(s.userId)}`"
                                class="min-w-0 truncate font-medium text-ink-200 hover:text-blue hover:underline"
                            >
                                {{ s.name || s.email || s.userId.slice(0, 20) }}
                            </NuxtLink>
                            <span
                                class="badge shrink-0"
                                :class="tierBadge(s.tier)"
                                >{{ s.tier }}</span
                            >
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Statut</span>
                            <span>
                                <span
                                    class="badge"
                                    :class="s.status === 'active' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'"
                                    >{{ s.status }}</span
                                >
                                <span
                                    v-if="s.cancelAtPeriodEnd"
                                    class="ml-1 text-[10px] text-warn"
                                    >annulé en cours</span
                                >
                            </span>
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Montant</span>
                            <span class="font-mono text-ink-200">{{ fmtEur(s.planPriceEur) }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Fin de période</span>
                            <span class="text-ink-300">{{ fmtDate(s.currentPeriodEnd) }}</span>
                        </div>
                    </div>
                    <p
                        v-if="!data.subscriptions.length"
                        class="py-4 text-center text-xs text-ink-400"
                    >
                        Aucun abonné actif.
                    </p>
                </div>
            </section>
        </template>
    </div>
</template>
