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
 *   NUXT_LISTMONK_URL      e.g. http://listmonk.internal:9000
 *   NUXT_LISTMONK_USER     listmonk API username
 *   NUXT_LISTMONK_PASSWORD listmonk API password
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
 */
export async function unsubscribeFromNewsletter(event, { email }) {
    const config = useRuntimeConfig(event)
    const { listmonkUrl, listmonkUser, listmonkPassword } = config

    if (!listmonkUrl || !listmonkUser || !listmonkPassword) {
        return false
    }

    try {
        const auth = Buffer.from(`${listmonkUser}:${listmonkPassword}`).toString('base64')
        await $fetch(`${listmonkUrl.replace(/\/$/, '')}/api/subscribers/blocklist`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${auth}`,
            },
            body: { emails: [email] },
        })
        logger.info(`Newsletter opt-out recorded for ${email}`)
        return true
    } catch (err) {
        logger.warn(`listmonk opt-out failed for ${email}:`, err?.data || err?.message || err)
        return false
    }
}
