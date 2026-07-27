export default defineEventHandler(() => {
    const baseUrl = useRuntimeConfig().public.baseUrl
    return {
        url: `${baseUrl}/auth/local`,
    }
})
