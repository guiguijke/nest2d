import { connectDB } from '~~/server/db/mongo'
import { getComputeProfile, getEntitlement } from '~~/server/utils/entitlement'
import { getVaultStatus } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        setResponseStatus(401)
        return {}
    }

    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId })

    const isStripFeatureEnable = user.isStripFeatureEnable || false
    const entitlement = await getEntitlement(userId)

    const vault = await getVaultStatus(userId)
    const compute = await getComputeProfile(userId, null)

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatarUrl || '/api/user/avatar',
        isStripFeatureEnable: isStripFeatureEnable,
        freeRemaining: entitlement.freeRemaining,
        subscriptionStatus: entitlement.subscriptionStatus,
        requiresPaywall: entitlement.requiresPaywall,
        compute: {
            level: compute.level,
            vcores: compute.vcores,
            maxDirections: compute.maxDirections,
        },
        encryption: {
            enabled: vault.enabled,
            locked: vault.locked,
            keyId: vault.keyId,
        },
    }
})
