import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'
import { getComputeTier, resolveLocalMode } from '~~/server/utils/entitlement'

/**
 * PR5 (Phase 2, J-078) : options de mode de calcul pour l'UI du job.
 * Renvoie { mode, canToggle, reason } via resolveLocalMode — le SERVEUR reste
 * la source de vérité (un client ne peut pas se déclarer local seul).
 * Le toggle n'est affiché que si canToggle ; Free = local forcé ; DWG = serveur.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    const projectSlug = getQuery(event).project
    const db = await connectDB()
    const tier = await getComputeTier(userId, null)

    let hasDwg = false
    if (projectSlug) {
        hasDwg = Boolean(
            await db
                .collection('user_dxf_files')
                .findOne({ projectSlug, name: /\.dwg$/i }, { projection: { _id: 1 } }),
        )
    }
    const userChoice = getQuery(event).choice === 'local' ? 'local' : undefined
    return resolveLocalMode(tier, hasDwg, userChoice)
})
