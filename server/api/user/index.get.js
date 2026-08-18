import { connectDB } from '~~/server/db/mongo'
import { getComputeProfile, getDemoEntitlement, getEntitlement } from '~~/server/utils/entitlement'
import { isPromoActive } from '~~/server/utils/promo'
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
    const config = useRuntimeConfig(event)
    const demo = await getDemoEntitlement(userId, config.public.localComputeEnabled)

    const vault = await getVaultStatus(userId)
    const compute = await getComputeProfile(userId, null)

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
        // Chantier B (à venir) : préférence turbo hybride client+serveur —
        // réservée aux payants à l'écriture (P3), inerte aujourd'hui.
        turboHybrid: user.turboHybrid === true,
        // Partner promo code redeemed on this account (raised free quota for
        // the campaign duration). null when none; active=false once the
        // campaign end date is past (quota already back to the default via
        // effectiveFreeLimit). The user may then redeem another code.
        promo: user.promo
            ? {
                  code: user.promo.code,
                  freeNestingLimit: user.promo.freeNestingLimit,
                  expiresAt: user.promo.expiresAt ?? null,
                  active: isPromoActive(user.promo),
              }
            : null,
        freeRemaining: entitlement.freeRemaining,
        // Demo project monthly allowance (separate from the free quota).
        demoRemaining: demo.demoRemaining,
        demoUnlimited: Boolean(demo.demoUnlimited),
        subscriptionStatus: entitlement.subscriptionStatus,
        granted: Boolean(entitlement.granted),
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
