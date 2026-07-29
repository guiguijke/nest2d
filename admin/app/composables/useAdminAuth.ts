// Admin auth state, shared across the panel.
//
// Single source of truth for "who is logged in". The server is the real
// authority (cookie + middleware 1_auth); this just mirrors it for the UI.
const ADMIN_KEY = 'admin:me'

export const useAdminAuth = () => {
  const admin = useState<any>('admin-auth-admin', () => null)
  const loading = useState<boolean>('admin-auth-loading', () => false)

  async function fetchMe() {
    try {
      const data = await $fetch('/api/auth/me', { credentials: 'include' })
      admin.value = data
      return data
    } catch {
      admin.value = null
      return null
    }
  }

  async function login(email: string, password: string) {
    loading.value = true
    try {
      const res = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        credentials: 'include',
      })
      admin.value = res.admin
      return res
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      /* ignore */
    }
    admin.value = null
    await navigateTo('/login')
  }

  const isLoggedIn = computed(() => !!admin.value)

  return { admin, loading, isLoggedIn, fetchMe, login, logout }
}
