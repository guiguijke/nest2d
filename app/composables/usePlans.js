/**
 * Shared fetcher for the subscription plans catalog (/api/payment/plans).
 *
 * Two pages (landing index.vue and plans.vue) used to call the endpoint
 * independently, each hitting Mongo on every navigation. This composable uses
 * a stable `key` so Nuxt deduplicates concurrent calls and `getCachedData`
 * keeps the result cached for a few minutes client-side — the catalog only
 * changes when the Stripe sync plugin runs, so a short TTL is safe.
 */
const PLANS_TTL_MS = 5 * 60 * 1000 // 5 minutes
const lastFetch = ref(0)
let cachedPlans = null

export function usePlans() {
    return useFetch('/api/payment/plans', {
        key: 'payment-plans',
        // Serve-side: nothing cached yet, let it fetch.
        // Client-side: return the cached payload if fresh enough, otherwise
        // refetch. nuxt payload (SSR) seeds cachedPlans on first hydration.
        getCachedData(key, nuxtApp) {
            const fromPayload = nuxtApp.payload.data[key]
            if (fromPayload) {
                cachedPlans = fromPayload
            }
            if (cachedPlans && Date.now() - lastFetch.value < PLANS_TTL_MS) {
                return cachedPlans
            }
            // Nuxt 4 : SEUL `undefined` signifie « pas de cache → exécuter le
            // fetch » (asyncData.js : `cachedData !== void 0`). Retourner
            // `null` (convention Nuxt 3) est pris pour une donnée en cache
            // valide : le fetch n'est JAMAIS exécuté, `plans` reste null et
            // les CTA payants affichent « Bientôt disponible » en permanence.
            return undefined
        },
        onResponse({ response }) {
            cachedPlans = response._data
            lastFetch.value = Date.now()
        },
    })
}
