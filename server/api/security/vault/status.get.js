import { getVaultStatus } from '~~/server/utils/vault'
import { hasPrivacyTier } from '~~/server/utils/entitlement'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const status = await getVaultStatus(userId)
    const eligible = await hasPrivacyTier(userId)
    return { ...status, eligible }
})
