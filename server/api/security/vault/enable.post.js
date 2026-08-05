import { connectDB } from '~~/server/db/mongo'
import { fingerprintKey, keyIdFromFingerprint } from '~~/server/utils/crypto'
import { createVaultSession } from '~~/server/utils/vault'

/**
 * Enables the zero-knowledge vault. The client generates the DEK in the
 * browser and sends it ONCE over TLS; the server stores only its SHA-256
 * fingerprint (to verify future unlocks) and a wrapped copy in the ephemeral
 * session cache — then forgets it.
 *
 * The vault is opt-in on EVERY plan (D-PRV-5, J-049) — privacy is never a
 * paid feature; the legacy `hasPrivacyTier` gate is gone.
 *
 * IMPORTANT: the session is created BEFORE the `encryption` fingerprint is
 * persisted. createVaultSession() wraps the DEK with the deployment master
 * key (NUXT_ENCRYPTION_MASTER_KEY); if that key is misconfigured the wrap
 * throws. By doing it first we guarantee the user is never left in a
 * half-enabled state (fingerprint set, no session, locked out forever).
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const db = await connectDB()
    const existing = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1, provider: 1, emailVerified: 1 } }
    )

    // Guard order (D-PAY-2): a local account with an unverified email can
    // never activate the vault — this check stays FIRST, before any other
    // validation. Google accounts are verified by Google at creation.
    if (existing?.provider === 'local' && existing?.emailVerified === false) {
        throw createError({ statusCode: 403, statusMessage: 'email_not_verified' })
    }

    const body = await readBody(event)
    const dek = Buffer.from(String(body?.key || ''), 'base64')
    if (dek.length !== 32) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid key' })
    }

    if (existing?.encryption?.enabled) {
        throw createError({ statusCode: 409, statusMessage: 'Vault already enabled — use key rotation instead' })
    }

    const fingerprint = fingerprintKey(dek)
    const keyId = keyIdFromFingerprint(fingerprint)

    // 1. Wrap the DEK into the session cache FIRST. If the deployment master
    //    key is misconfigured, this throws here — before we touch the user
    //    document — so the account is never left half-enabled.
    const { expiresAt } = await createVaultSession(userId, dek)

    // 2. Only then persist the fingerprint that marks the vault as enabled.
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

    return { ok: true, keyId, expiresAt }
})
