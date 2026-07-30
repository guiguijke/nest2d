<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const route = useRoute()
const router = useRouter()

const search = ref((route.query.q as string) || '')
const status = ref((route.query.status as string) || '')
const provider = ref((route.query.provider as string) || '')
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
watch([status, provider, page], () => refresh())

const queryParams = computed(() => ({
  q: search.value || undefined,
  status: status.value || undefined,
  provider: provider.value || undefined,
  page: page.value,
  limit,
}))

const { data, pending, error, refresh } = await useFetch('/api/users', {
  query: queryParams,
  credentials: 'include',
})

function syncUrl() {
  router.replace({ query: { q: search.value || undefined, status: status.value || undefined, provider: provider.value || undefined, page: page.value } })
}
watch([search, status, provider, page], syncUrl)

function fmtDate(d: any) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function isActive(last: any) {
  return last && Date.now() - new Date(last).getTime() < 5 * 60 * 1000
}
function statusBadge(u: any) {
  if (u.banned) return { text: 'Banni', cls: 'bg-err/15 text-err' }
  if (u.subscription?.status === 'active' || u.subscription?.status === 'trialing') return { text: 'Abonné', cls: 'bg-ok/15 text-ok' }
  if (u.grantedUntil && new Date(u.grantedUntil) > new Date()) return { text: 'Offert', cls: 'bg-blue/15 text-blue' }
  return { text: 'Gratuit', cls: 'bg-marine-700 text-ink-300' }
}
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
        <input v-model="search" class="input" placeholder="email, nom ou identifiant…" />
      </div>
      <div>
        <label class="label">Statut</label>
        <select v-model="status" class="input">
          <option value="">Tous</option>
          <option value="active">Actifs (5 min)</option>
          <option value="subscriber">Abonnés</option>
          <option value="granted">Accès offert</option>
          <option value="banned">Bannis</option>
        </select>
      </div>
      <div>
        <label class="label">Provider</label>
        <select v-model="provider" class="input">
          <option value="">Tous</option>
          <option value="local">Local</option>
          <option value="google">Google</option>
        </select>
      </div>
    </div>

    <div v-if="pending && !data" class="text-sm text-ink-400">Chargement…</div>
    <div v-else-if="error" class="card border-err/40 text-sm text-err">Erreur : {{ error.statusMessage }}</div>

    <template v-else-if="data">
      <div class="card overflow-x-auto p-0">
        <table class="w-full text-xs">
          <thead class="border-b border-marine-700 text-left text-ink-400">
            <tr>
              <th class="px-3 py-2 font-medium">Utilisateur</th>
              <th class="px-3 py-2 font-medium">Provider</th>
              <th class="px-3 py-2 font-medium">Statut</th>
              <th class="px-3 py-2 font-medium">Pays</th>
              <th class="px-3 py-2 font-medium">Inscrit le</th>
              <th class="px-3 py-2 font-medium">Dernière activité</th>
              <th class="px-3 py-2 font-medium">Crédits</th>
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
                <div class="text-ink-400">{{ u.email }}</div>
              </td>
              <td class="px-3 py-2 text-ink-300">{{ u.provider }}</td>
              <td class="px-3 py-2">
                <span class="badge" :class="statusBadge(u).cls">{{ statusBadge(u).text }}</span>
              </td>
              <td class="px-3 py-2 font-mono text-ink-300">{{ u.signupCountry || '—' }}</td>
              <td class="px-3 py-2 text-ink-300">{{ fmtDate(u.createdAt) }}</td>
              <td class="px-3 py-2">
                <span :class="isActive(u.lastActiveAt) ? 'text-ok' : 'text-ink-400'">{{ fmtDate(u.lastActiveAt) }}</span>
              </td>
              <td class="px-3 py-2 font-mono text-ink-200">{{ u.balance ?? 0 }}</td>
            </tr>
            <tr v-if="!data.items.length">
              <td colspan="7" class="px-3 py-6 text-center text-ink-400">Aucun utilisateur.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-between text-xs text-ink-400">
        <span>{{ data.total }} utilisateur(s) · page {{ data.page }} / {{ data.pages }}</span>
        <div class="flex gap-2">
          <button class="btn-secondary" :disabled="data.page <= 1" @click="page--">Précédent</button>
          <button class="btn-secondary" :disabled="data.page >= data.pages" @click="page++">Suivant</button>
        </div>
      </div>
    </template>
  </div>
</template>
