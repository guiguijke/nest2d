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
    case 'processing': return 'bg-rust/15 text-rust'
    case 'done': return 'bg-ok/15 text-ok'
    case 'failed': return 'bg-err/15 text-err'
    default: return 'bg-ink-700 text-ink-300'
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
      <div>
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
    <div v-else-if="data" class="card overflow-x-auto p-0">
      <table class="w-full text-xs">
        <thead class="border-b border-ink-700 text-left text-ink-400">
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
          <tr v-for="(j, i) in data.items" :key="i" class="border-b border-ink-800 last:border-0">
            <td class="px-3 py-1.5"><span class="badge bg-ink-700 text-ink-300">{{ j.system }}</span></td>
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

    <div v-if="data" class="flex items-center justify-between text-xs text-ink-400">
      <span>{{ data.items.length }} affichés</span>
      <div class="flex gap-2">
        <button class="btn-secondary" :disabled="filters.page <= 1" @click="filters.page--">Précédent</button>
        <button class="btn-secondary" @click="filters.page++">Suivant</button>
      </div>
    </div>
  </div>
</template>
