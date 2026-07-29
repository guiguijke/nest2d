// Client-side route guard for the admin panel.
//
// The server enforces auth on every API (middleware 1_auth + requireAdmin);
// this middleware is a UX nicety that bounces unauthenticated visitors to the
// login page instead of letting pages render empty shells.
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { admin, fetchMe } = useAdminAuth()

  if (!admin.value) {
    await fetchMe()
  }

  if (!admin.value && to.path !== '/login') {
    return navigateTo('/login')
  }
  if (admin.value && to.path === '/login') {
    return navigateTo('/')
  }
})
