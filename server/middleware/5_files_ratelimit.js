import { clientIp, rateLimitAllow, denyRateLimit } from '~~/server/utils/ratelimit'

/**
 * /api/files/** is the download surface whose slug used to be a 24-bit
 * secret (pentest C-1). 30 req/min per session (IP as fallback) makes a
 * brute-force of even a short leftover slug impractical.
 *
 * Exceptions (bug démo 2026-08-29 + QA 2026-08-30) : sous /api/files/project/
 * (geometry, dxf, svg) chaque requête passe un contrôle d'accès AUTHENTIFIÉ
 * (requireFileAccess : propriétaire ou démo — le secret du slug n'y est plus
 * la seule défense) et une session légitime en consomme UN PAR FICHIER :
 *   - geometry : polygones d'affichage (24 pour la démo) ;
 *   - dxf/svg : le calcul LOCAL télécharge les bytes bruts pour l'export
 *     client (24 de plus) — avec le budget anti-brute-force partagé, la démo
 *     s'auto-sature (429 en boucle, finalisation locale coincée en
 *     awaiting_local, constaté en QA sur la prod).
 * Budget séparé et plus large pour ces trois préfixes ; le 30/min strict
 * reste pour tout le reste de /api/files/**.
 */
export default defineEventHandler((event) => {
    const url = String(event.path || event.node?.req?.url || '')
    if (!url.startsWith('/api/files')) return

    const userId = event.context?.auth?.userId
    const ip = clientIp(event)
    const key = userId ? `files:user:${userId}` : `files:ip:${ip}`
    const windowMs = 60_000
    const isProjectFile =
        url.startsWith('/api/files/project/geometry/')
        || url.startsWith('/api/files/project/dxf/')
        || url.startsWith('/api/files/project/svg/')
    const limit = isProjectFile ? 180 : 30
    const budgetKey = isProjectFile ? `${key}:project` : key
    if (!rateLimitAllow(budgetKey, { limit, windowMs })) {
        denyRateLimit(event, { windowMs })
    }
})
