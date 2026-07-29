<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const { data: overview, pending, error, refresh } = await useFetch('/api/stats/overview', {
  credentials: 'include',
})
const { snapshot, connected } = useLiveStats()

// Auto-refresh the overview every 60s as a fallback alongside the SSE stream.
let timer: any
onMounted(() => {
  timer = setInterval(refresh, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))

const fmt = (n: any) => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n))
const live = computed(() => snapshot.value)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl">Tableau de bord</h1>
        <p class="text-xs text-ink-400">Vue d'ensemble de la plateforme en temps réel</p>
      </div>
      <span class="text-[11px] text-ink-400">
        {{ connected ? '● Flux live connecté' : '○ Flux live déconnecté' }}
      </span>
    </div>

    <div v-if="pending" class="text-sm text-ink-400">Chargement…</div>
    <div v-else-if="error" class="card border-err/40 text-sm text-err">
      Erreur lors du chargement des statistiques : {{ error.statusMessage }}
    </div>

    <template v-else-if="overview">
      <!-- Users -->
      <section class="space-y-3">
        <h2 class="text-sm uppercase tracking-wide text-ink-400">Utilisateurs</h2>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total inscrits" :value="fmt(overview.users.total)" />
          <StatCard label="Inscriptions 24h" :value="fmt(live?.signups24h ?? overview.users.signups24h)" accent="rust" :live="!!live" />
          <StatCard label="Inscriptions 7j" :value="fmt(overview.users.signups7d)" />
          <StatCard label="Abonnés actifs" :value="fmt(overview.users.activeSubscribers)" accent="ok" />
          <StatCard label="Actifs (5 min)" :value="fmt(live?.active5m ?? overview.users.active5m)" :live="!!live" />
          <StatCard label="Bannis" :value="fmt(overview.users.banned)" accent="err" />
        </div>
      </section>

      <!-- Jobs -->
      <section class="space-y-3">
        <h2 class="text-sm uppercase tracking-wide text-ink-400">Jobs (nesting + strip)</h2>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="En file" :value="fmt(live?.queued ?? overview.jobs.queued)" accent="warn" :live="!!live" />
          <StatCard label="En traitement" :value="fmt(live?.processing ?? overview.jobs.processing)" :live="!!live" />
          <StatCard label="Échoués" :value="fmt(live?.failed ?? overview.jobs.failed)" accent="err" :live="!!live" />
          <StatCard label="Terminés 24h" :value="fmt(overview.jobs.done24h)" accent="ok" />
        </div>
      </section>

      <!-- Activity -->
      <section class="grid gap-3 lg:grid-cols-3">
        <div class="card space-y-3 lg:col-span-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">Inscriptions — 30 derniers jours</h3>
            <span class="text-[11px] text-ink-400">{{ overview.users.signups30d }} au total</span>
          </div>
          <Sparkline :data="overview.signupsSeries" :height="64" />
        </div>

        <div class="card space-y-3">
          <h3 class="text-sm font-semibold">Activité</h3>
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-400">Événements 24h</span>
            <span class="font-mono text-white">{{ fmt(live?.events24h ?? overview.activity.events24h) }}</span>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-400">Fils support non lus</span>
            <NuxtLink to="/support" class="font-mono text-rust hover:underline">
              {{ fmt(overview.support.unreadThreads) }}
            </NuxtLink>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
