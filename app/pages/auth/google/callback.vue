<template>
    <AuthProgress />
</template>

<script setup>
definePageMeta({
    layout: "doc",
});
const router = useRouter()
const route = useRoute();

onMounted(async () => {
    // The PKCE flow returns the authorization code as a query parameter.
    const code = route.query.code;

    if (!code) {
        // No code present — likely an error redirect from Google.
        const err = route.query.error || "no_code";
        router.push({ path: "/", query: { auth_error: err } });
        return;
    }

    try {
        await $fetch(API_ROUTES.LOGIN('google'), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ code, state: route.query.state || '' }),
        });
        router.push({ path: '/home' });
    } catch (err) {
        router.push({ path: "/", query: { auth_error: "exchange_failed" } });
    }
});
</script>
