import { clientIp, rateLimitAllow, denyRateLimit } from '~~/server/utils/ratelimit'

/**
 * /api/files/** is the download surface whose slug used to be a 24-bit
 * secret (pentest C-1). 30 req/min per session (IP as fallback) makes a
 * brute-force of even a short leftover slug impractical.
 *
 * Exception (bug démo 2026-08-29) : /api/files/project/geometry/** n'est pas
 * la surface de téléchargement (polygones d'affichage, jamais les bytes
 * DXF) et une page projet en consomme UN PAR FICHIER (24 pour la démo —
 * deux chargements ou un calcul dans la même minute et tout part en 429,
 * thumbnails morts + retries en boucle). Budget séparé, plus large.
 */
export default defineEventHandler((event) => {
    const url = String(event.path || event.node?.req?.url || '')
    if (!url.startsWith('/api/files')) return

    const userId = event.context?.auth?.userId
    const ip = clientIp(event)
    const key = userId ? `files:user:${userId}` : `files:ip:${ip}`
    const windowMs = 60_000
    const isGeometry = url.startsWith('/api/files/project/geometry/')
    const limit = isGeometry ? 180 : 30
    const geoKey = isGeometry ? `${key}:geometry` : key
    if (!rateLimitAllow(geoKey, { limit, windowMs })) {
        denyRateLimit(event, { windowMs })
    }
})
