// Client-side route guard for the admin panel.
//
// The server enforces auth on every API (middleware 1_auth + requireAdmin);
// this middleware is a UX nicety that routes the visitor to the right page:
//   - If no admin exists yet  → /setup (first-time bootstrap)
//   - If not logged in        → /login
//   - If logged in            → the requested page
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { admin, fetchMe } = useAdminAuth()

  if (!admin.value) {
    await fetchMe()
  }

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
