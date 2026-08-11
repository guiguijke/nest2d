import { requireAdmin } from '../../../utils/auth'
import { connectDB, COL } from '../../../db/mongo'

// Newsletter status for one user, proxied from the self-hosted listmonk
// instance (same instance the main app subscribes to — see
// server/features/listmonk/subscribe.js).
//
// LIMITATION (listmonk HTTP API): per-subscriber opens/clicks are NOT
// exposed — only per-campaign aggregates (to_send / sent / views / clicks).
// This route therefore returns the user's subscription status + the campaign
// list with their aggregates; it cannot answer "did THIS user open it".
//
// Never 500s on listmonk problems: unconfigured -> { configured: false },
// unreachable / HTTP error -> { configured: true, error }.
export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

    const db = await connectDB()
    const user = await db
        .collection(COL.users)
        .findOne({ id }, { projection: { _id: 0, email: 1, newsletterOptIn: 1 } })
    if (!user) throw createError({ statusCode: 404, statusMessage: 'Utilisateur introuvable' })

    const config = useRuntimeConfig(event)
    const { listmonkUrl, listmonkUser, listmonkPassword } = config as any
    if (!listmonkUrl || !listmonkUser || !listmonkPassword) {
        return { configured: false }
    }

    const base = String(listmonkUrl).replace(/\/$/, '')
    const auth = Buffer.from(`${listmonkUser}:${listmonkPassword}`).toString('base64')
    const headers = { Authorization: `Basic ${auth}` }

    try {
        // Subscriber lookup by exact email (listmonk SQL-ish query syntax).
        const subsResp: any = await $fetch(`${base}/api/subscribers`, {
            headers,
            query: { query: `subscribers.email='${String(user.email).replace(/'/g, "''")}'` },
        })
        const sub = subsResp?.data?.results?.[0] || null

        // Campaign aggregates (platform-wide, not per-subscriber). Map
        // defensively: field names follow listmonk's API (to_send, sent,
        // views, clicks) but a missing field must degrade to 0, not throw.
        const campsResp: any = await $fetch(`${base}/api/campaigns`, { headers })
        const campaigns = (campsResp?.data?.results || []).map((c: any) => ({
            id: c?.id ?? null,
            name: c?.name ?? '—',
            status: c?.status ?? '—',
            toSend: Number(c?.to_send) || 0,
            sent: Number(c?.sent) || 0,
            views: Number(c?.views) || 0,
            clicks: Number(c?.clicks) || 0,
            startedAt: c?.started_at || c?.created_at || null,
        }))

        return {
            configured: true,
            // App-side opt-in flag, for cross-checking with listmonk.
            optIn: user.newsletterOptIn === true,
            subscriber: sub
                ? {
                      email: sub.email,
                      // 'enabled' | 'blocklisted' (opt-out) | 'unconfirmed'
                      status: sub.status,
                      createdAt: sub.created_at || null,
                      lists: (sub.lists || []).map((l: any) => ({
                          id: l?.id ?? null,
                          name: l?.name ?? '—',
                          status: l?.subscription_status ?? null,
                      })),
                  }
                : null,
            campaigns,
        }
    } catch (err: any) {
        return {
            configured: true,
            error: err?.data?.message || err?.message || 'listmonk injoignable',
        }
    }
})
