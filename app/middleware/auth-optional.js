// 3.1.6 (lot 3, P3) : pages PUBLIQUES qui doivent reconnaître la session —
// /plans (CTA « Gérer dans le profil » pour un connecté), landing,
// changelog. Contrairement à 'auth', aucune redirection : anonyme et
// connecté voient la même page, correctement étiquetée.
export default defineNuxtRouteMiddleware(async () => {
    const { getters, actions } = authStore
    const { setUser } = actions
    const { userIsSet } = toRefs(getters)
    if (!unref(userIsSet)) {
        try {
            await setUser()
        } catch {
            // Session expirée / réseau : la page reste consultable en
            // mode anonyme.
        }
    }
})
