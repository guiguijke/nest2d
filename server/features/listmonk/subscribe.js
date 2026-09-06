import logger from '~~/server/utils/logger'

/**
 * Optional newsletter subscription via a self-hosted listmonk instance.
 *
 * The user explicitly opts in with a checkbox at registration (GDPR: never
 * pre-ticked). The subscriber is created with preconfirm_subscriptions so
 * listmonk does not send its own double opt-in email — the checkbox IS the
 * consent. Best-effort: a listmonk outage must never block a signup.
 *
 * Config (private runtime config / env):
 *   NUXT_LISTMONK_URL      e.g. http://listmonk:9000 (internal docker network —
 *                          never the Cloudflare-proxied URL: datacenter-origin
 *                          requests get challenged, and this is same-host anyway)
 *   NUXT_LISTMONK_USER     listmonk API username (Settings → Users, type API)
 *   NUXT_LISTMONK_PASSWORD the API user's TOKEN (Basic auth user:token — the
 *                          name stays PASSWORD for runtimeConfig compatibility)
 *   NUXT_LISTMONK_LIST_ID  numeric list id
 */
export async function subscribeToNewsletter(event, { email, name }) {
    const config = useRuntimeConfig(event)
    const { listmonkUrl, listmonkUser, listmonkPassword, listmonkListId } = config

    if (!listmonkUrl || !listmonkUser || !listmonkPassword || !listmonkListId) {
        logger.warn('listmonk is not configured (NUXT_LISTMONK_* missing) — skipping newsletter subscription')
        return false
    }

    try {
        const auth = Buffer.from(`${listmonkUser}:${listmonkPassword}`).toString('base64')
        await $fetch(`${listmonkUrl.replace(/\/$/, '')}/api/subscribers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${auth}`,
            },
            body: {
                email,
                name,
                status: 'enabled',
                lists: [Number(listmonkListId)],
                preconfirm_subscriptions: true,
            },
        })
        logger.info(`Newsletter subscription created for ${email}`)
        return true
    } catch (err) {
        logger.warn(`listmonk subscription failed for ${email}:`, err?.data || err?.message || err)
        return false
    }
}

/**
 * Unsubscribe via listmonk's blocklist endpoint: the record is kept but
 * blocklisted (no more campaigns), which is the listmonk-idiomatic opt-out.
 *
 * listmonk v6 API: blocklist only accepts subscriber ids — resolve the email
 * first via the search endpoint (same SQL-expression lookup as unsubscribe.js).
 * Account deletion (full erasure) uses unsubscribe.js instead.
 */
export async function unsubscribeFromNewsletter(event, { email }) {
    const config = useRuntimeConfig(event)
    const { listmonkUrl, listmonkUser, listmonkPassword } = config

    if (!listmonkUrl || !listmonkUser || !listmonkPassword) {
        return false
    }

    const base = listmonkUrl.replace(/\/$/, '')
    const auth = Buffer.from(`${listmonkUser}:${listmonkPassword}`).toString('base64')
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
    }

    try {
        const results = await $fetch(`${base}/api/subscribers`, {
            method: 'GET',
            headers,
            query: {
                query: `subscribers.email = '${String(email).replace(/'/g, "''")}'`,
                per_page: 100,
            },
        })
        const ids = (results?.data?.results || []).map((s) => s.id)
        if (ids.length === 0) {
            logger.info(`No listmonk subscriber found for ${email} — opt-out is a no-op`)
            return true
        }
        await $fetch(`${base}/api/subscribers/blocklist`, {
            method: 'PUT',
            headers,
            body: { ids },
        })
        logger.info(`Newsletter opt-out recorded for ${email}`)
        return true
    } catch (err) {
        logger.warn(`listmonk opt-out failed for ${email}:`, err?.data || err?.message || err)
        return false
    }
}
