/**
 * Client-side route guard for admin pages.
 *
 * The server APIs under /api/support/admin already enforce `isAdmin` and
 * return 401 otherwise — this middleware is just a UX nicety so a non-admin
 * is redirected to /home instead of seeing an empty admin page that 401s on
 * every request.
 *
 * Requires `auth` to have run first (it sets the user via setUser); we call
 * setUser defensively here too in case this page is reached directly.
 */
export default defineNuxtRouteMiddleware(async () => {
    const { getters, actions } = authStore
    await actions.setUser()
    const isAdmin = Boolean(unref(getters.user)?.isAdmin)
    if (!isAdmin) {
        return navigateTo('/home')
    }
})
