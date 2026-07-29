/**
 * Detects the visitor's preferred locale from the Cloudflare country header.
 *
 * Cloudflare injects `cf-ipcountry` (ISO-3166-1 alpha-2) on every request to
 * the origin. We already rely on it for currency selection (currency.ts) and
 * geo-blocking (2_block_geo.ts). Here we map it to a UI locale: France -> 'fr',
 * everything else -> 'en'. The client persists the result in a cookie so this
 * endpoint is only hit once per visitor.
 *
 * Falls back gracefully when the header is absent (local dev, no proxy).
 */
export default defineEventHandler((event) => {
    const country = (
        getHeader(event, 'cf-ipcountry') ||
        getHeader(event, 'x-vercel-ip-country') ||
        ''
    ).toUpperCase()

    // Map countries to locales. Only France defaults to French for now;
    // extend the FR_COUNTRIES set to cover BE, CA, CH, etc. if needed.
    const FR_COUNTRIES = new Set(['FR'])
    const locale = FR_COUNTRIES.has(country) ? 'fr' : 'en'

    return { locale, country: country || null }
})
