const { getters, actions } = authStore;
const { setUser } = actions;
const { userIsSet } = toRefs(getters);

export default defineNuxtRouteMiddleware(async (to) => {
    if  (process.server) {
        await setUser()
    } else if (!unref(userIsSet)) {
        await setUser()
    }
    // Authenticated users may freely visit the landing page ("index"). This
    // used to force-redirect them to /home, which made it impossible to view
    // the marketing page once signed in.
    if (!unref(userIsSet) && to.name !== "index") {
        return navigateTo("/");
    }
});
