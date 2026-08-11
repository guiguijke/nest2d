<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const filters = reactive({ status: '', ownerId: '', page: 1 })
const limit = 50
const query = computed(() => ({
  status: filters.status || undefined,
  ownerId: filters.ownerId || undefined,
  page: filters.page,
  limit,
}))
const { data, pending, refresh } = await useFetch('/api/jobs', { query, credentials: 'include' })

let poll: any
onMounted(() => (poll = setInterval(refresh, 15_000)))
onBeforeUnmount(() => clearInterval(poll))

watch(filters, () => (filters.page = 1), { deep: true })

function fmt(d: any) {
  return d ? new Date(d).toLocaleString('fr-FR') : '—'
}
function statusCls(s: string) {
  switch (s) {
    case 'queued': return 'bg-warn/15 text-warn'
    case 'processing': return 'bg-blue/15 text-blue'
    case 'done': return 'bg-ok/15 text-ok'
    case 'failed': return 'bg-err/15 text-err'
    default: return 'bg-marine-700 text-ink-300'
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl">Jobs</h1>
        <p class="text-xs text-ink-400">File d'attente et traitement (nesting + strip), rafraîchi toutes les 15 s</p>
      </div>
      <span v-if="data" class="text-[11px] text-ink-400">classic : {{ data.counts.classic }} · strip : {{ data.counts.strip }}</span>
    </div>

    <div class="card flex flex-wrap items-end gap-3">
      <div class="w-full sm:w-auto">
        <label class="label">Statut</label>
        <select v-model="filters.status" class="input">
          <option value="">Actifs (défaut)</option>
          <option>queued</option><option>processing</option><option>failed</option><option>done</option>
        </select>
      </div>
      <div class="min-w-[200px] flex-1">
        <label class="label">Propriétaire (userId)</label>
        <input v-model="filters.ownerId" class="input" placeholder="local:… / google:…" />
      </div>
    </div>

    <div v-if="pending && !data" class="text-sm text-ink-400">Chargement…</div>
    <!-- Desktop table -->
    <div v-else-if="data" class="card overflow-x-auto p-0 hidden md:block">
      <table class="w-full text-xs">
        <thead class="border-b border-marine-700 text-left text-ink-400">
          <tr>
            <th class="px-3 py-2 font-medium">Système</th>
            <th class="px-3 py-2 font-medium">Statut</th>
            <th class="px-3 py-2 font-medium">Slug</th>
            <th class="px-3 py-2 font-medium">Propriétaire</th>
            <th class="px-3 py-2 font-medium">Mis à jour</th>
            <th class="px-3 py-2 font-medium">Erreur</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(j, i) in data.items" :key="i" class="border-b border-marine-800 last:border-0">
            <td class="px-3 py-1.5"><span class="badge bg-marine-700 text-ink-300">{{ j.system }}</span></td>
            <td class="px-3 py-1.5"><span class="badge" :class="statusCls(j.status)">{{ j.status }}</span></td>
            <td class="px-3 py-1.5 font-mono text-ink-200">{{ j.slug || '—' }}</td>
            <td class="px-3 py-1.5 font-mono text-ink-400">{{ j.ownerId ? j.ownerId.slice(0, 24) : '—' }}</td>
            <td class="px-3 py-1.5 text-ink-300">{{ fmt(j.updatedAt || j.createdAt) }}</td>
            <td class="px-3 py-1.5 font-mono text-err max-w-[260px] truncate">{{ j.error || '—' }}</td>
          </tr>
          <tr v-if="!data.items.length"><td colspan="6" class="px-3 py-6 text-center text-ink-400">Aucun job.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div v-if="data" class="space-y-2 md:hidden">
      <div v-for="(j, i) in data.items" :key="i" class="card space-y-1.5 p-3 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="badge bg-marine-700 text-ink-300">{{ j.system }}</span>
          <span class="badge" :class="statusCls(j.status)">{{ j.status }}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-ink-400">Slug</span>
          <span class="min-w-0 truncate font-mono text-ink-200">{{ j.slug || '—' }}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-ink-400">Propriétaire</span>
          <span class="min-w-0 truncate font-mono text-ink-400">{{ j.ownerId ? j.ownerId.slice(0, 24) : '—' }}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-ink-400">Mis à jour</span>
          <span class="text-ink-300">{{ fmt(j.updatedAt || j.createdAt) }}</span>
        </div>
        <div v-if="j.error" class="flex items-start justify-between gap-2">
          <span class="shrink-0 text-ink-400">Erreur</span>
          <span class="break-all font-mono text-err">{{ j.error }}</span>
        </div>
      </div>
      <p v-if="!data.items.length" class="card p-3 text-center text-xs text-ink-400">Aucun job.</p>
    </div>

    <div v-if="data" class="flex items-center justify-between text-xs text-ink-400">
      <span>{{ data.items.length }} affichés</span>
      <div class="flex gap-2">
        <button class="btn-secondary" :disabled="filters.page <= 1" @click="filters.page--">Précédent</button>
        <button class="btn-secondary" @click="filters.page++">Suivant</button>
      </div>
    </div>
  </div>
</template>
