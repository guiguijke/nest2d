// Client-side route guard for the admin panel.
//
// Two modes:
//   - LAN-open (NUXT_ADMIN_LAN_OPEN=true): no auth at all. The server injects
//     a virtual admin on every request. Nothing to do here.
//   - Secured: route to /setup (no admin yet) or /login (not signed in).
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const config = useRuntimeConfig()
  const lanOpen = config.public.adminLanOpen === true || config.public.adminLanOpen === 'true'
  if (lanOpen) return // open access, no guard

  const { admin, fetchMe } = useAdminAuth()

  if (!admin.value) {
    await fetchMe()
  }

  // The server's answer is the source of truth: a virtual 'lan' admin means
  // the server IS LAN-open, whatever the public runtime flag says (the two
  // keys can desync — NUXT_ADMIN_LAN_OPEN only maps to the private key).
  // Without this early return, LAN-open + needsSetup + a stale public flag
  // loops /setup ↔ / forever and the page never hydrates (dead clicks).
  if (admin.value?.id === 'lan') return

  // First-time setup: no admin at all → force the setup page.
  try {
    const status = await $fetch('/api/setup/status')
    if (status.needsSetup && to.path !== '/setup') {
      return navigateTo('/setup')
    }
    if (!status.needsSetup && to.path === '/setup') {
      return navigateTo('/login')
    }
  } catch {
    /* DB unreachable — fall through to normal auth flow */
  }

  if (!admin.value && to.path !== '/login' && to.path !== '/setup') {
    return navigateTo('/login')
  }
  if (admin.value && (to.path === '/login' || to.path === '/setup')) {
    return navigateTo('/')
  }
})
