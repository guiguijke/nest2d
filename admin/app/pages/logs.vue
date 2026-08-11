<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const tab = ref<'http' | 'tracking'>('http')

// ---- HTTP logs filters ----
const httpFilters = reactive({ q: '', method: '', statusMin: '', windowDays: 1, page: 1 })
const limit = 100
const httpQuery = computed(() => ({
  q: httpFilters.q || undefined,
  method: httpFilters.method || undefined,
  statusMin: httpFilters.statusMin || undefined,
  windowDays: httpFilters.windowDays,
  page: httpFilters.page,
  limit,
}))
const { data: httpData, pending: httpPending, refresh: refreshHttp } = await useFetch('/api/logs/http', {
  query: httpQuery,
  credentials: 'include',
})
watch(httpFilters, () => (httpFilters.page = 1), { deep: true })
let httpDebounce: any
watch(httpFilters, () => {
  clearTimeout(httpDebounce)
  httpDebounce = setTimeout(refreshHttp, 300)
}, { deep: true })

// ---- Tracking filters ----
const trFilters = reactive({ q: '', action: '', country: '', page: 1 })
const trQuery = computed(() => ({
  q: trFilters.q || undefined,
  action: trFilters.action || undefined,
  country: trFilters.country || undefined,
  page: trFilters.page,
  limit,
}))
const { data: trData, pending: trPending, refresh: refreshTr } = await useFetch('/api/logs/tracking', {
  query: trQuery,
  credentials: 'include',
})
watch(trFilters, () => (trFilters.page = 1), { deep: true })
let trDebounce: any
watch(trFilters, () => {
  clearTimeout(trDebounce)
  trDebounce = setTimeout(refreshTr, 300)
}, { deep: true })

function fmt(ts: any) {
  return ts ? new Date(ts).toLocaleString('fr-FR') : '—'
}
function statusCls(code: number) {
  if (code >= 500) return 'bg-err/15 text-err'
  if (code >= 400) return 'bg-warn/15 text-warn'
  if (code >= 300) return 'bg-marine-700 text-ink-300'
  return 'bg-ok/15 text-ok'
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl">Logs avancés</h1>
      <p class="text-xs text-ink-400">Débogage technique — requêtes HTTP et événements de tracking bruts. Pour une vue lisible, voir l'onglet <NuxtLink to="/activity" class="text-blue hover:underline">Activité</NuxtLink>.</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-marine-700">
      <button
        class="px-3 py-2 text-xs font-medium transition-colors"
        :class="tab === 'http' ? 'border-b-2 border-blue text-white' : 'text-ink-400 hover:text-ink-200'"
        @click="tab = 'http'"
      >
        Requêtes HTTP
      </button>
      <button
        class="px-3 py-2 text-xs font-medium transition-colors"
        :class="tab === 'tracking' ? 'border-b-2 border-blue text-white' : 'text-ink-400 hover:text-ink-200'"
        @click="tab = 'tracking'"
      >
        Événements tracking
      </button>
    </div>

    <!-- HTTP logs -->
    <template v-if="tab === 'http'">
      <div class="card flex flex-wrap items-end gap-3">
        <div class="min-w-[200px] flex-1">
          <label class="label">Recherche (url / userId)</label>
          <input v-model="httpFilters.q" class="input" placeholder="/api/…" />
        </div>
        <div class="w-full sm:w-auto">
          <label class="label">Méthode</label>
          <select v-model="httpFilters.method" class="input">
            <option value="">Toutes</option>
            <option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option>
          </select>
        </div>
        <div class="w-full sm:w-auto">
          <label class="label">Statut ≥</label>
          <input v-model="httpFilters.statusMin" type="number" class="input w-full sm:w-24" placeholder="400" />
        </div>
        <div class="w-full sm:w-auto">
          <label class="label">Fenêtre (jours)</label>
          <select v-model="httpFilters.windowDays" class="input">
            <option :value="1">24 h</option><option :value="2">2 j</option><option :value="7">7 j</option>
          </select>
        </div>
      </div>

      <div v-if="httpPending && !httpData" class="text-sm text-ink-400">Chargement…</div>
      <!-- Desktop table -->
      <div v-else-if="httpData" class="card overflow-x-auto p-0 hidden md:block">
        <table class="w-full text-xs">
          <thead class="border-b border-marine-700 text-left text-ink-400">
            <tr>
              <th class="px-3 py-2 font-medium">Heure</th>
              <th class="px-3 py-2 font-medium">Méthode</th>
              <th class="px-3 py-2 font-medium">Statut</th>
              <th class="px-3 py-2 font-medium">URL</th>
              <th class="px-3 py-2 font-medium">User</th>
              <th class="px-3 py-2 font-medium">Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in httpData.items" :key="i" class="border-b border-marine-800 last:border-0">
              <td class="px-3 py-1.5 text-ink-300">{{ fmt(l.timestamp) }}</td>
              <td class="px-3 py-1.5 font-mono">{{ l.method }}</td>
              <td class="px-3 py-1.5"><span class="badge" :class="statusCls(l.statusCode)">{{ l.statusCode }}</span></td>
              <td class="px-3 py-1.5 font-mono text-ink-200">{{ l.url }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-400">{{ l.userId ? l.userId.slice(0, 24) : '—' }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-400">{{ l.duration }} ms</td>
            </tr>
            <tr v-if="!httpData.items.length"><td colspan="6" class="px-3 py-6 text-center text-ink-400">Aucune requête.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div v-if="httpData" class="space-y-2 md:hidden">
        <div v-for="(l, i) in httpData.items" :key="i" class="card space-y-1.5 p-3 text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono">{{ l.method }}</span>
            <span class="badge" :class="statusCls(l.statusCode)">{{ l.statusCode }}</span>
          </div>
          <div class="break-all font-mono text-ink-200">{{ l.url }}</div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-ink-400">Heure</span>
            <span class="text-ink-300">{{ fmt(l.timestamp) }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-ink-400">User</span>
            <span class="min-w-0 truncate font-mono text-ink-400">{{ l.userId ? l.userId.slice(0, 24) : '—' }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-ink-400">Durée</span>
            <span class="font-mono text-ink-400">{{ l.duration }} ms</span>
          </div>
        </div>
        <p v-if="!httpData.items.length" class="card p-3 text-center text-xs text-ink-400">Aucune requête.</p>
      </div>

      <div v-if="httpData" class="flex items-center justify-between text-xs text-ink-400">
        <span>{{ httpData.total }} entrée(s) · {{ httpData.windowDays }}j · page {{ httpData.page }} / {{ httpData.pages }}</span>
        <div class="flex gap-2">
          <button class="btn-secondary" :disabled="httpData.page <= 1" @click="httpFilters.page--">Précédent</button>
          <button class="btn-secondary" :disabled="httpData.page >= httpData.pages" @click="httpFilters.page++">Suivant</button>
        </div>
      </div>
    </template>

    <!-- Tracking events -->
    <template v-else>
      <div class="card flex flex-wrap items-end gap-3">
        <div class="min-w-[200px] flex-1">
          <label class="label">Recherche (action / userId)</label>
          <input v-model="trFilters.q" class="input" placeholder="ex. nest_started" />
        </div>
        <div class="w-full sm:w-auto">
          <label class="label">Action</label>
          <input v-model="trFilters.action" class="input w-full sm:w-40" placeholder="exact" />
        </div>
        <div class="w-full sm:w-auto">
          <label class="label">Pays</label>
          <input v-model="trFilters.country" class="input w-full sm:w-20" placeholder="FR" />
        </div>
      </div>

      <div v-if="trPending && !trData" class="text-sm text-ink-400">Chargement…</div>
      <!-- Desktop table -->
      <div v-else-if="trData" class="card overflow-x-auto p-0 hidden md:block">
        <table class="w-full text-xs">
          <thead class="border-b border-marine-700 text-left text-ink-400">
            <tr>
              <th class="px-3 py-2 font-medium">Heure</th>
              <th class="px-3 py-2 font-medium">Action</th>
              <th class="px-3 py-2 font-medium">Pays</th>
              <th class="px-3 py-2 font-medium">User</th>
              <th class="px-3 py-2 font-medium">Données</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in trData.items" :key="i" class="border-b border-marine-800 last:border-0 align-top">
              <td class="px-3 py-1.5 text-ink-300">{{ fmt(l.timestamp) }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-200">{{ l.action }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-400">{{ l.country || '—' }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-400">{{ l.userId ? l.userId.slice(0, 24) : '—' }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-400">{{ l.data ? JSON.stringify(l.data) : '—' }}</td>
            </tr>
            <tr v-if="!trData.items.length"><td colspan="5" class="px-3 py-6 text-center text-ink-400">Aucun événement.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div v-if="trData" class="space-y-2 md:hidden">
        <div v-for="(l, i) in trData.items" :key="i" class="card space-y-1.5 p-3 text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="min-w-0 truncate font-mono text-ink-200">{{ l.action }}</span>
            <span class="shrink-0 font-mono text-ink-400">{{ l.country || '—' }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-ink-400">Heure</span>
            <span class="text-ink-300">{{ fmt(l.timestamp) }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-ink-400">User</span>
            <span class="min-w-0 truncate font-mono text-ink-400">{{ l.userId ? l.userId.slice(0, 24) : '—' }}</span>
          </div>
          <div v-if="l.data" class="flex items-start justify-between gap-2">
            <span class="shrink-0 text-ink-400">Données</span>
            <span class="break-all font-mono text-ink-400">{{ JSON.stringify(l.data) }}</span>
          </div>
        </div>
        <p v-if="!trData.items.length" class="card p-3 text-center text-xs text-ink-400">Aucun événement.</p>
      </div>

      <div v-if="trData" class="flex items-center justify-between text-xs text-ink-400">
        <span>{{ trData.total }} entrée(s) · page {{ trData.page }} / {{ trData.pages }}</span>
        <div class="flex gap-2">
          <button class="btn-secondary" :disabled="trData.page <= 1" @click="trFilters.page--">Précédent</button>
          <button class="btn-secondary" :disabled="trData.page >= trData.pages" @click="trFilters.page++">Suivant</button>
        </div>
      </div>
    </template>
  </div>
</template>
