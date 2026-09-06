import logger from '~~/server/utils/logger'

/**
 * Removes a subscriber from the self-hosted listmonk instance. Called on
 * account deletion (GDPR right to erasure) — the subscriber id is never
 * stored on the user document, so we look it up by email first.
 *
 * Best-effort, mirroring subscribeToNewsletter: a listmonk outage must never
 * block an account deletion. Returns true when a subscriber was deleted.
 *
 * Config: same NUXT_LISTMONK_* runtime config as subscribe.js.
 */
export async function unsubscribeFromNewsletter(event, { email }) {
    const config = useRuntimeConfig(event)
    const { listmonkUrl, listmonkUser, listmonkPassword } = config

    if (!listmonkUrl || !listmonkUser || !listmonkPassword) {
        logger.warn('listmonk is not configured (NUXT_LISTMONK_* missing) — skipping newsletter unsubscription')
        return false
    }

    const base = listmonkUrl.replace(/\/$/, '')
    const auth = Buffer.from(`${listmonkUser}:${listmonkPassword}`).toString('base64')
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
    }

    try {
        // `query` takes a SQL expression (requires subscribers:sql_query, which
        // API users shouldn't have) — `search` is a plain filter needing only
        // subscribers:get. Exact-match client-side to avoid substring hits.
        const results = await $fetch(`${base}/api/subscribers`, {
            method: 'GET',
            headers,
            query: { search: email, per_page: 100 },
        })
        const subscribers = (results?.data?.results || []).filter(
            (s) => String(s.email).toLowerCase() === String(email).toLowerCase()
        )
        if (subscribers.length === 0) {
            logger.info(`No listmonk subscriber found for ${email} — nothing to delete`)
            return false
        }
        for (const subscriber of subscribers) {
            await $fetch(`${base}/api/subscribers/${subscriber.id}`, {
                method: 'DELETE',
                headers,
            })
        }
        logger.info(`Newsletter subscriber(s) deleted for ${email} (${subscribers.length})`)
        return true
    } catch (err) {
        logger.warn(`listmonk unsubscription failed for ${email}:`, err?.data || err?.message || err)
        return false
    }
}
