import { computed, reactive, readonly, unref } from 'vue'

const state = reactive({
    userIsSet: false,
    user: {}
})
async function setUser() {
    try {
        // Stable key: Nuxt deduplicates concurrent calls to the same key and
        // shares the cached payload across the middleware + pages that call
        // setUser() (9 call sites), avoiding one network round-trip per
        // navigation.
        //
        // useRequestFetch() (via useApiFetch) forwards the incoming request
        // headers — including the sessionId cookie — to internal API calls
        // during SSR. The previous plain useFetch dropped the cookie on the
        // server, so /api/user answered {} on any server-rendered navigation
        // (going back to the landing, reload…) and the user appeared logged
        // out. Wrapping the cookie-aware fetch in useAsyncData('user') keeps
        // the dedup/cache behaviour of the old useFetch({ key }).
        const $apiFetch = useApiFetch()
        const { data } = await useAsyncData('user', () => $apiFetch(API_ROUTES.USER))
        const userData = unref(data)
        if (userData && Boolean(userData.id)) {
            state.user = userData
            state.userIsSet = true
        } else {
            state.user = {}
            state.userIsSet = false
        }
    } catch (error) {
        console.error('Failed to set user:', error)
        state.user = {}
        state.userIsSet = false
    }
}

async function logout() {
    try {
        await $fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        })
        state.user = {}
        state.userIsSet = false
        // Invalidate the cached user payload so the next setUser() actually
        // refetches instead of returning the pre-logout data (which would
        // keep the user "logged in" on the client).
        clearNuxtData('user')
    } catch (err) {
        console.error('Logout failed:', err)
    }
}

export const authStore = readonly({
    getters: {
        user: computed(() => state.user),
        userIsSet: computed(() => state.userIsSet)
    },
    actions: {
        setUser,
        logout
    }
})

