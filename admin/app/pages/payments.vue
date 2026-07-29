<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const filters = reactive({ status: '', userId: '', page: 1 })
const limit = 50
const query = computed(() => ({
  status: filters.status || undefined,
  userId: filters.userId || undefined,
  page: filters.page,
  limit,
}))
const { data, pending } = await useFetch('/api/payments', { query, credentials: 'include' })
watch(filters, () => (filters.page = 1), { deep: true })

function fmt(d: any) {
  return d ? new Date(d).toLocaleString('fr-FR') : '—'
}
function statusCls(s: string) {
  if (s === 'completed' || s === 'succeeded') return 'bg-ok/15 text-ok'
  if (s === 'created' || s === 'pending') return 'bg-warn/15 text-warn'
  if (s === 'failed' || s === 'canceled') return 'bg-err/15 text-err'
  return 'bg-ink-700 text-ink-300'
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl">Paiements</h1>
      <p class="text-xs text-ink-400">Transactions crédits et état des abonnements</p>
    </div>

    <!-- Summary -->
    <div v-if="data" class="grid gap-3 md:grid-cols-2">
      <div class="card space-y-2">
        <h2 class="text-sm font-semibold">Abonnements</h2>
        <div v-for="s in data.subscriberSummary" :key="s.status" class="flex items-center justify-between text-xs">
          <span class="text-ink-300 capitalize">{{ s.status }}</span>
          <span class="font-mono">{{ s.count }}</span>
        </div>
        <p v-if="!data.subscriberSummary.length" class="text-xs text-ink-400">Aucun abonné.</p>
      </div>
      <div class="card space-y-2">
        <h2 class="text-sm font-semibold">Statut des transactions</h2>
        <div v-for="s in data.statusBreakdown" :key="s.status" class="flex items-center justify-between text-xs">
          <span class="text-ink-300">{{ s.status || '—' }}</span>
          <span class="font-mono">{{ s.count }}</span>
        </div>
        <p v-if="!data.statusBreakdown.length" class="text-xs text-ink-400">Aucune transaction.</p>
      </div>
    </div>

    <div class="card flex flex-wrap items-end gap-3">
      <div>
        <label class="label">Statut</label>
        <input v-model="filters.status" class="input w-36" placeholder="completed" />
      </div>
      <div class="min-w-[200px] flex-1">
        <label class="label">Utilisateur (userId)</label>
        <input v-model="filters.userId" class="input" placeholder="local:… / google:…" />
      </div>
    </div>

    <div v-if="pending && !data" class="text-sm text-ink-400">Chargement…</div>
    <div v-else-if="data" class="card overflow-x-auto p-0">
      <table class="w-full text-xs">
        <thead class="border-b border-ink-700 text-left text-ink-400">
          <tr>
            <th class="px-3 py-2 font-medium">Date</th>
            <th class="px-3 py-2 font-medium">Utilisateur</th>
            <th class="px-3 py-2 font-medium">Statut</th>
            <th class="px-3 py-2 font-medium">Crédits</th>
            <th class="px-3 py-2 font-medium">Price ID</th>
            <th class="px-3 py-2 font-medium">Checkout</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(t, i) in data.items" :key="i" class="border-b border-ink-800 last:border-0">
            <td class="px-3 py-1.5 text-ink-300">{{ fmt(t.createdAt) }}</td>
            <td class="px-3 py-1.5">
              <NuxtLink v-if="t.userId" :to="`/users/${encodeURIComponent(t.userId)}`" class="text-ink-200 hover:text-rust hover:underline">
                {{ t.user?.name || t.userId.slice(0, 20) }}
              </NuxtLink>
              <span v-else class="text-ink-400">—</span>
            </td>
            <td class="px-3 py-1.5"><span class="badge" :class="statusCls(t.status)">{{ t.status }}</span></td>
            <td class="px-3 py-1.5 font-mono">{{ t.credit ?? '—' }}</td>
            <td class="px-3 py-1.5 font-mono text-ink-400 max-w-[180px] truncate">{{ t.stripePriceId || '—' }}</td>
            <td class="px-3 py-1.5 font-mono text-ink-400 max-w-[180px] truncate">{{ t.checkoutId || '—' }}</td>
          </tr>
          <tr v-if="!data.items.length"><td colspan="6" class="px-3 py-6 text-center text-ink-400">Aucune transaction.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="data" class="flex items-center justify-between text-xs text-ink-400">
      <span>{{ data.total }} transaction(s) · page {{ data.page }} / {{ data.pages }}</span>
      <div class="flex gap-2">
        <button class="btn-secondary" :disabled="data.page <= 1" @click="filters.page--">Précédent</button>
        <button class="btn-secondary" :disabled="data.page >= data.pages" @click="filters.page++">Suivant</button>
      </div>
    </div>
  </div>
</template>
