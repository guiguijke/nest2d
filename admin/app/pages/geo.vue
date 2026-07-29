<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const { data, pending, error } = await useFetch('/api/geo/distribution', { credentials: 'include' })

const fmt = (n: any) => new Intl.NumberFormat('fr-FR').format(n || 0)

// Flag emoji from an ISO country code (uses regional indicator symbols).
function flag(cc: string) {
  if (!cc || cc.length !== 2) return '🏳️'
  const A = 0x1f1e6
  const base = 'A'.charCodeAt(0)
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => A + c.charCodeAt(0) - base))
}

const topCountries = computed(() => (data.value?.countries || []).slice(0, 15))
const maxUsers = computed(() => Math.max(1, ...(data.value?.countries || []).map((c) => c.users)))
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-xl">Géographie des clients</h1>
      <p class="text-xs text-ink-400">D'où proviennent vos utilisateurs (pays d'inscription + activité enregistrée)</p>
    </div>

    <div v-if="pending" class="text-sm text-ink-400">Chargement…</div>
    <div v-else-if="error" class="card border-err/40 text-sm text-err">Erreur : {{ error.statusMessage }}</div>

    <template v-else-if="data">
      <!-- Totals -->
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pays distincts" :value="fmt(data.countries.length)" accent="rust" />
        <StatCard label="Utilisateurs géolocalisés" :value="fmt(data.totals.users)" />
        <StatCard label="Événements géolocalisés" :value="fmt(data.totals.events)" />
        <StatCard label="Pays inconnu" :value="fmt(data.totals.unknownUsers)" hint="sans Cloudflare / cf-ipcountry" />
      </div>

      <!-- Ranked countries -->
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">Top pays (par utilisateurs inscrits)</h2>
        </div>
        <div class="space-y-2">
          <div v-for="c in topCountries" :key="c.country" class="flex items-center gap-3">
            <span class="w-8 text-center text-lg">{{ flag(c.country) }}</span>
            <span class="w-12 font-mono text-xs text-ink-300">{{ c.country }}</span>
            <div class="relative h-6 flex-1 overflow-hidden rounded bg-ink-800">
              <div class="absolute inset-y-0 left-0 bg-rust/60" :style="{ width: (c.users / maxUsers) * 100 + '%' }" />
              <span class="absolute inset-y-0 left-2 flex items-center text-xs text-white">{{ fmt(c.users) }} utilisateurs</span>
            </div>
            <span class="w-24 text-right text-[11px] text-ink-400">{{ c.signups30d }} nouv. / 30j</span>
            <span class="w-28 text-right text-[11px] text-ink-400">{{ fmt(c.events) }} events</span>
          </div>
          <p v-if="!topCountries.length" class="text-xs text-ink-400">Aucune donnée géographique (cf-ipcountry absent ?).</p>
        </div>
      </div>

      <!-- Full table -->
      <div class="card overflow-x-auto p-0">
        <table class="w-full text-xs">
          <thead class="border-b border-ink-700 text-left text-ink-400">
            <tr>
              <th class="px-3 py-2 font-medium">Pays</th>
              <th class="px-3 py-2 font-medium">Code</th>
              <th class="px-3 py-2 font-medium">Utilisateurs (inscription)</th>
              <th class="px-3 py-2 font-medium">Nouv. 30j</th>
              <th class="px-3 py-2 font-medium">Événements</th>
              <th class="px-3 py-2 font-medium">Utilisateurs (events)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in data.countries" :key="c.country" class="border-b border-ink-800 last:border-0">
              <td class="px-3 py-2">{{ flag(c.country) }}</td>
              <td class="px-3 py-2 font-mono">{{ c.country }}</td>
              <td class="px-3 py-2 font-mono">{{ fmt(c.users) }}</td>
              <td class="px-3 py-2 font-mono text-ok">{{ fmt(c.signups30d) }}</td>
              <td class="px-3 py-2 font-mono text-ink-300">{{ fmt(c.events) }}</td>
              <td class="px-3 py-2 font-mono text-ink-300">{{ fmt(c.eventUsers) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
