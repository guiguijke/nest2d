<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const route = useRoute()
const router = useRouter()
const id = decodeURIComponent(route.params.id as string)

const { data, pending, error, refresh } = await useFetch('/api/users/' + encodeURIComponent(id), {
  credentials: 'include',
})
const { data: activity } = await useFetch('/api/users/' + encodeURIComponent(id) + '/activity', {
  credentials: 'include',
})

function fmtDurationMin(min: number): string {
  if (!min) return '0 min'
  if (min < 60) return min + ' min'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h + 'h' + (m ? ' ' + m + 'min' : '')
}

const acting = ref(false)
const creditAmount = ref(0)
const banReason = ref('')
const freeMonthReason = ref('')
const lastMsg = ref('')

async function patch(body: any) {
  acting.value = true
  lastMsg.value = ''
  try {
    const res = await $fetch('/api/users/' + encodeURIComponent(id), { method: 'PATCH', body, credentials: 'include' })
    lastMsg.value = `✓ ${res.summary}`
    await refresh()
  } catch (e: any) {
    lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
  } finally {
    acting.value = false
  }
}

async function grantMonth() {
  acting.value = true
  lastMsg.value = ''
  try {
    const res = await $fetch(`/api/users/${encodeURIComponent(id)}/free-month`, {
      method: 'POST',
      body: { reason: freeMonthReason.value },
      credentials: 'include',
    })
    lastMsg.value = `✓ Mois offert (${res.method})`
    await refresh()
  } catch (e: any) {
    lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
  } finally {
    acting.value = false
  }
}

function fmtDate(d: any) {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-FR')
}
const u = computed(() => data.value?.user)
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button class="btn-ghost" @click="router.push('/users')">← Retour</button>
        <div>
          <h1 class="text-xl">{{ u?.name || '—' }}</h1>
          <p class="text-xs text-ink-400">{{ u?.email }} · {{ u?.id }}</p>
        </div>
      </div>
      <a
        v-if="u"
        :href="`${useRuntimeConfig().public.appBaseUrl}/project/_`"
        class="btn-secondary"
        target="_blank"
        rel="noopener"
      >
        Voir dans l'app ↗
      </a>
    </div>

    <div v-if="pending" class="text-sm text-ink-400">Chargement…</div>
    <div v-else-if="error" class="card border-err/40 text-sm text-err">{{ error.statusMessage }}</div>

    <template v-else-if="data">
      <p v-if="lastMsg" class="text-xs text-ink-200">{{ lastMsg }}</p>

      <div class="grid gap-4 lg:grid-cols-3">
        <!-- Profile -->
        <section class="card space-y-3">
          <h2 class="text-sm font-semibold">Profil</h2>
          <dl class="space-y-1.5 text-xs">
            <div class="flex justify-between"><dt class="text-ink-400">Provider</dt><dd>{{ u.provider }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Inscrit le</dt><dd>{{ fmtDate(u.createdAt) }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Dernière activité</dt><dd>{{ fmtDate(u.lastActiveAt) }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Pays (inscription)</dt><dd class="font-mono">{{ u.signupCountry || '—' }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">IP (inscription)</dt><dd class="font-mono">{{ u.signupIp || '—' }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Crédits</dt><dd class="font-mono">{{ u.balance ?? 0 }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Sessions actives</dt><dd>{{ data.activity.activeSessions }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Banni</dt>
              <dd>
                <span v-if="u.banned" class="badge bg-err/15 text-err">oui</span>
                <span v-else class="text-ink-400">non</span>
              </dd>
            </div>
            <div class="flex justify-between"><dt class="text-ink-400">Accès offert</dt><dd>{{ u.grantedUntil ? `jusqu'au ${fmtDate(u.grantedUntil)}` : '—' }}</dd></div>
          </dl>
        </section>

        <!-- Subscription -->
        <section class="card space-y-3">
          <h2 class="text-sm font-semibold">Abonnement</h2>
          <dl class="space-y-1.5 text-xs" v-if="u.subscription">
            <div class="flex justify-between"><dt class="text-ink-400">Statut</dt><dd>{{ u.subscription.status }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Price ID</dt><dd class="font-mono truncate max-w-[160px]">{{ u.subscription.priceId || '—' }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Fin de période</dt><dd>{{ fmtDate(u.subscription.currentPeriodEnd) }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-400">Sub Stripe</dt><dd class="font-mono truncate max-w-[160px]">{{ u.subscription.stripeSubscriptionId || '—' }}</dd></div>
          </dl>
          <p v-else class="text-xs text-ink-400">Aucun abonnement.</p>
        </section>

        <!-- Activity -->
        <section class="card space-y-3">
          <h2 class="text-sm font-semibold">Activité</h2>
          <dl class="grid grid-cols-2 gap-1.5 text-xs">
            <div><dt class="text-ink-400">Projets</dt><dd class="font-mono text-lg">{{ data.activity.projects }}</dd></div>
            <div><dt class="text-ink-400">Strip projets</dt><dd class="font-mono text-lg">{{ data.activity.stripProjects }}</dd></div>
            <div><dt class="text-ink-400">Jobs total</dt><dd class="font-mono text-lg">{{ data.activity.jobsTotal }}</dd></div>
            <div><dt class="text-ink-400">Jobs échoués</dt><dd class="font-mono text-lg text-err">{{ data.activity.jobsFailed }}</dd></div>
            <div><dt class="text-ink-400">Fichiers DXF</dt><dd class="font-mono text-lg">{{ data.activity.dxfFiles }}</dd></div>
            <div><dt class="text-ink-400">Événements</dt><dd class="font-mono text-lg">{{ data.activity.trackingEvents }}</dd></div>
          </dl>
        </section>
      </div>

      <!-- Usage & recent jobs -->
      <section v-if="activity" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">Activité &amp; temps de calcul</h2>
          <span class="text-[11px] text-ink-400">{{ activity.totals.totalJobs }} job(s) au total</span>
        </div>

        <div class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <StatCard label="Temps consommé" :value="fmtDurationMin(activity.totals.totalTimeMin)" accent="blue" />
          <StatCard label="Densité moyenne" :value="activity.totals.avgDensity ? Math.round(activity.totals.avgDensity * 100) + '%' : '—'" />
          <StatCard label="Pièces imbriquées" :value="activity.totals.placed" />
          <StatCard label="Feuilles utilisées" :value="activity.totals.sheets" />
          <StatCard label="Jobs échoués" :value="activity.totals.failed" accent="err" />
        </div>

        <div class="card space-y-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-400">30 derniers jobs</h3>
          <JobTable :jobs="activity.jobs" />
        </div>

        <div v-if="activity.balanceSeries.length" class="card space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-400">Évolution du solde (30 jours)</h3>
          <div class="flex items-end gap-[2px]" style="height: 48px">
            <div
              v-for="b in activity.balanceSeries"
              :key="b.date"
              :title="`${b.date}: ${b.balance} crédits`"
              class="flex-1 rounded-sm bg-ink-600"
              :style="{ height: Math.max(2, (b.balance / Math.max(...activity.balanceSeries.map((x: any) => x.balance))) * 48) + 'px' }"
            />
          </div>
          <p class="text-[11px] text-ink-400">Dernier solde connu : {{ activity.balanceSeries[activity.balanceSeries.length - 1].balance }} crédits</p>
        </div>
      </section>

      <!-- Actions -->
      <section class="grid gap-4 md:grid-cols-2">
        <div class="card space-y-3">
          <h2 class="text-sm font-semibold">Crédits</h2>
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <label class="label">Montant (+/-)</label>
              <input v-model.number="creditAmount" type="number" class="input" />
            </div>
            <button class="btn-primary" :disabled="acting || creditAmount === 0" @click="patch({ action: 'adjustCredits', amount: creditAmount })">Appliquer</button>
          </div>
          <div class="flex gap-2">
            <button class="btn-secondary" :disabled="acting" @click="patch({ action: 'revokeSessions' })">Déconnecter (toutes sessions)</button>
          </div>
        </div>

        <div class="card space-y-3">
          <h2 class="text-sm font-semibold">Mois gratuit</h2>
          <div>
            <label class="label">Raison (optionnel)</label>
            <input v-model="freeMonthReason" class="input" placeholder="compensation suite à un bug…" />
          </div>
          <button class="btn-primary" :disabled="acting" @click="grantMonth">Offrir un mois</button>
          <p class="text-[11px] text-ink-400">Abonné Stripe → coupon 100 % sur un cycle. Sinon → accès local 30 jours.</p>
        </div>

        <div class="card space-y-3 md:col-span-2">
          <h2 class="text-sm font-semibold">Modération</h2>
          <template v-if="!u.banned">
            <div>
              <label class="label">Raison du bannissement (optionnel)</label>
              <input v-model="banReason" class="input" />
            </div>
            <button class="btn-danger" :disabled="acting" @click="patch({ action: 'ban', reason: banReason })">Bannir l'utilisateur</button>
          </template>
          <template v-else>
            <p class="text-xs text-ink-300">Banni le {{ fmtDate(u.bannedAt) }} — {{ u.bannedReason || 'sans raison' }}</p>
            <button class="btn-secondary" :disabled="acting" @click="patch({ action: 'unban' })">Lever le bannissement</button>
          </template>
        </div>
      </section>

      <!-- Recent events -->
      <section class="card space-y-3">
        <h2 class="text-sm font-semibold">Événements récents</h2>
        <div v-if="data.recentEvents.length" class="max-h-64 overflow-y-auto">
          <table class="w-full text-xs">
            <thead class="text-left text-ink-400">
              <tr><th class="py-1 pr-3 font-medium">Date</th><th class="py-1 pr-3 font-medium">Pays</th><th class="py-1 font-medium">Action</th></tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in data.recentEvents" :key="i" class="border-t border-marine-800">
                <td class="py-1 pr-3 text-ink-300">{{ fmtDate(e.timestamp) }}</td>
                <td class="py-1 pr-3 font-mono text-ink-300">{{ e.country || '—' }}</td>
                <td class="py-1 font-mono">{{ e.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-xs text-ink-400">Aucun événement.</p>
      </section>
    </template>
  </div>
</template>
