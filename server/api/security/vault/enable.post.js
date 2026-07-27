import { connectDB } from '~~/server/db/mongo'
import { fingerprintKey, keyIdFromFingerprint } from '~~/server/utils/crypto'
import { createVaultSession } from '~~/server/utils/vault'
import { hasPrivacyTier } from '~~/server/utils/entitlement'

/**
 * Enables the zero-knowledge vault. The client generates the DEK in the
 * browser and sends it ONCE over TLS; the server stores only its SHA-256
 * fingerprint (to verify future unlocks) and a wrapped copy in the ephemeral
 * session cache — then forgets it.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    if (!(await hasPrivacyTier(userId))) {
        throw createError({
            statusCode: 402,
            statusMessage: 'The zero-knowledge vault requires the Pro plan',
            data: { reason: 'privacy_tier_required' },
        })
    }

    const body = await readBody(event)
    const dek = Buffer.from(String(body?.key || ''), 'base64')
    if (dek.length !== 32) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid key' })
    }

    const db = await connectDB()
    const existing = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    if (existing?.encryption?.enabled) {
        throw createError({ statusCode: 409, statusMessage: 'Vault already enabled — use key rotation instead' })
    }

    const fingerprint = fingerprintKey(dek)
    const keyId = keyIdFromFingerprint(fingerprint)

    await db.collection('users').updateOne(
        { id: userId },
        {
            $set: {
                encryption: {
                    enabled: true,
                    keyId,
                    fingerprint,
                    createdAt: new Date(),
                },
            },
        }
    )

    const { expiresAt } = await createVaultSession(userId, dek)
    return { ok: true, keyId, expiresAt }
})
