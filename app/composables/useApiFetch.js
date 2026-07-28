/**
 * Authenticated $fetch wrapper that forwards the browser cookies (session) to
 * internal API calls during SSR.
 *
 * Replaces the manual pattern repeated across pages:
 *   const headers = useRequestHeaders(['cookie'])
 *   await $fetch(url, { headers })
 *
 * `useRequestFetch()` returns a $fetch instance preconfigured by Nuxt to
 * forward the incoming request headers (including cookies) on the server.
 */
export function useApiFetch() {
    return useRequestFetch()
}
