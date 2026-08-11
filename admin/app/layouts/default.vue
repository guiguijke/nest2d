<script setup lang="ts">
// Main admin shell: top bar + sidebar nav + content.
const { admin, logout } = useAdminAuth()
const lanOpen = computed(() => {
  const v = useRuntimeConfig().public.adminLanOpen
  return v === true || v === 'true'
})

const nav = [
  { to: '/', label: 'Tableau de bord', icon: '📊' },
  { to: '/activity', label: 'Activité', icon: '🕒' },
  { to: '/users', label: 'Utilisateurs', icon: '👥' },
  { to: '/jobs', label: 'Jobs', icon: '⚙️' },
  { to: '/geo', label: 'Géographie', icon: '🌍' },
  { to: '/payments', label: 'Paiements', icon: '💳' },
  { to: '/promo-codes', label: 'Codes promo', icon: '🎟️' },
  { to: '/support', label: 'Support', icon: '💬' },
  { to: '/logs', label: 'Logs (avancé)', icon: '🔧' },
]
</script>

<template>
  <div class="min-h-screen bg-marine-950">
    <!-- Top bar -->
    <header class="sticky top-0 z-30 border-b border-marine-700 bg-marine-900/95 backdrop-blur">
      <div class="flex h-12 items-center justify-between px-4">
        <div class="flex items-center gap-2">
          <span class="inline-flex h-7 w-7 items-center justify-center rounded bg-blue text-sm font-bold text-white">N</span>
          <span class="text-sm font-semibold text-white">NestorCut</span>
        </div>
        <div class="flex items-center gap-3">
          <template v-if="lanOpen">
            <span class="badge bg-ok/15 text-ok">● Réseau local</span>
          </template>
          <template v-else>
            <span v-if="admin" class="hidden text-xs text-ink-300 sm:inline">{{ admin.name }} · {{ admin.email }}</span>
            <button class="btn-ghost" @click="logout">Déconnexion</button>
          </template>
        </div>
      </div>
    </header>

    <div class="flex flex-col md:flex-row">
      <!-- Sidebar -->
      <aside class="sticky top-12 hidden h-[calc(100vh-3rem)] w-52 shrink-0 border-r border-marine-700 bg-marine-900 p-3 md:block">
        <nav class="flex flex-col gap-1">
          <NuxtLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-ink-300 transition-colors hover:bg-marine-800 hover:text-ink-100"
            active-class="bg-marine-800 !text-white"
          >
            <span class="text-sm">{{ item.icon }}</span>
            {{ item.label }}
          </NuxtLink>
        </nav>
      </aside>

      <!-- Mobile nav -->
      <div class="flex w-full flex-col md:hidden">
        <div class="flex gap-1 overflow-x-auto border-b border-marine-700 bg-marine-900 px-2 py-2">
          <NuxtLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="whitespace-nowrap rounded-md px-2 py-1 text-xs text-ink-300 hover:bg-marine-800"
            active-class="bg-marine-800 !text-white"
          >
            {{ item.icon }} {{ item.label }}
          </NuxtLink>
        </div>
      </div>

      <!-- Content -->
      <main class="min-w-0 flex-1 p-4 md:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
