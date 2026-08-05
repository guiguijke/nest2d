import { getVaultStatus } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const status = await getVaultStatus(userId)
    // Opt-in on EVERY plan (D-PRV-5, J-049): privacy is never a paid feature.
    // The `eligible` field is kept (stable API shape) but no longer gates
    // anything — every authenticated user is eligible.
    return { ...status, eligible: true }
})
