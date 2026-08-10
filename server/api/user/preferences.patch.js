import { connectDB } from '~~/server/db/mongo'
import { subscribeToNewsletter, unsubscribeFromNewsletter } from '~~/server/features/listmonk/subscribe'
import { getComputeTier } from '~~/server/utils/entitlement'

const VALID_UNITS = ['mm', 'inch']

/**
 * PATCH /api/user/preferences — per-user preferences.
 * Body: { preferredUnit?: 'mm' | 'inch', newsletterOptIn?: boolean,
 *         turboHybrid?: boolean }
 *
 * newsletterOptIn also syncs with listmonk (subscribe / blocklist) and is
 * always written — including `false`, so a declined first-login prompt is
 * remembered and never shown again.
 * turboHybrid (Chantier B, J-093 suite) : réservé aux tiers payants (P3) et
 * inerte tant que la course client+serveur n'est pas livrée — le bouton est
 * flag-gated dev (NUXT_PUBLIC_TURBO_ENABLED).
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody(event)
    const $set = {}

    if (body?.preferredUnit !== undefined) {
        if (!VALID_UNITS.includes(body.preferredUnit)) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid preferredUnit' })
        }
        $set.preferredUnit = body.preferredUnit
    }

    if (typeof body?.newsletterOptIn === 'boolean') {
        $set.newsletterOptIn = body.newsletterOptIn
        $set.newsletterOptInAt = new Date()
    }

    if (typeof body?.turboHybrid === 'boolean') {
        // Le turbo est une feature payante : un compte free peut l'éteindre
        // (défensif) mais jamais l'allumer — l'upsell passe par le paywall.
        if (body.turboHybrid === true) {
            const tier = await getComputeTier(userId, null)
            if (tier === 'free') {
                throw createError({ statusCode: 403, statusMessage: 'upgrade_required' })
            }
        }
        $set.turboHybrid = body.turboHybrid
    }

    if (Object.keys($set).length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
    }

    const db = await connectDB()

    if (typeof body?.newsletterOptIn === 'boolean') {
        const user = await db.collection('users').findOne({ id: userId }, { projection: { email: 1, name: 1 } })
        if (user?.email) {
            // Best-effort: listmonk failures never block a preference change.
            const sync = body.newsletterOptIn ? subscribeToNewsletter : unsubscribeFromNewsletter
            sync(event, { email: user.email, name: user.name }).catch(() => {})
        }
    }

    await db.collection('users').updateOne({ id: userId }, { $set })

    return { ok: true, ...$set }
})
