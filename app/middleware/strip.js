export default defineNuxtRouteMiddleware(() => {
    // Global kill-switch first (NUXT_PUBLIC_STRIP_ENABLED), then the
    // per-user feature flag.
    const stripGloballyEnabled = useRuntimeConfig().public.stripEnabled === true;
    if (!stripGloballyEnabled) {
        return navigateTo("/home");
    }

    const { getters } = authStore;
    const user = unref(getters.user);

    if (!user?.isStripFeatureEnable) {
        return navigateTo("/home");
    }
});
