import { connectDB } from '~~/server/db/mongo'
import { getComputeProfile, getDemoEntitlement, getEntitlement } from '~~/server/utils/entitlement'
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
    const demo = await getDemoEntitlement(userId)

    const vault = await getVaultStatus(userId)
    const compute = await getComputeProfile(userId, null)

    const config = useRuntimeConfig(event)

    // Env overrides arrive as strings ('true'), not booleans — same
    // defensive pattern as localAuthEnabled in register.post.js.
    const unitsEnabled =
        config.public.unitSwitchEnabled === true || config.public.unitSwitchEnabled === 'true'

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        provider: user.provider,
        avatar: user.avatarUrl || '/api/user/avatar',
        isStripFeatureEnable: isStripFeatureEnable,
        // Lazy default: accounts created before the units feature have no
        // preferredUnit field — they are metric.
        preferredUnit: user.preferredUnit === 'inch' ? 'inch' : 'mm',
        unitsEnabled,
        // null = never asked (first-login prompt eligible), true/false = answered.
        newsletterOptIn: user.newsletterOptIn ?? null,
        freeRemaining: entitlement.freeRemaining,
        // Demo project monthly allowance (separate from the free quota).
        demoRemaining: demo.demoRemaining,
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
