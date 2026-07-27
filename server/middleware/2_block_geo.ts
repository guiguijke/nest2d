import { createError, defineEventHandler } from 'h3'
import { COUNTRY_HEADER_NAME } from '~~/server/tracking/const'

/**
 * Optional geo-blocking middleware.
 *
 * Reads the list of blocked ISO country codes from runtimeConfig
 * (NUXT_BLOCKED_COUNTRIES), comma-separated, e.g. "RU,BY".
 * Disabled by default (empty string → no blocking).
 *
 * Note: the country header (`cf-ipcountry`) is only injected by Cloudflare
 * when proxying. Behind a plain reverse proxy / homelab the header is empty
 * and this middleware is a no-op.
 */
export default defineEventHandler((event) => {
    const raw = useRuntimeConfig(event).blockedCountries as string | undefined
    if (!raw) {
        return
    }
    const blockedCountries = raw
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    if (blockedCountries.length === 0) {
        return
    }

    const country = (event.node.req.headers[COUNTRY_HEADER_NAME] as string || '').toUpperCase()

    if (blockedCountries.includes(country)) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden'
        })
    }
})
