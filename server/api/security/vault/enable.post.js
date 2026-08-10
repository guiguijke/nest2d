import { connectDB } from '~~/server/db/mongo'
import { fingerprintKey, keyIdFromFingerprint } from '~~/server/utils/crypto'
import { createVaultSession } from '~~/server/utils/vault'

/**
 * Enables the zero-knowledge vault. The client generates the DEK in the
 * browser and sends it ONCE over TLS; the server stores only its SHA-256
 * fingerprint (to verify future unlocks) and keeps the DEK in the
 * process-local RAM session cache (D-PRV-7) — then forgets it.
 *
 * The vault is opt-in on EVERY plan (D-PRV-5, J-049) — privacy is never a
 * paid feature; the legacy `hasPrivacyTier` gate is gone.
 *
 * IMPORTANT: the session is created BEFORE the `encryption` fingerprint is
 * persisted. Historically this ordering protected against a misconfigured
 * deployment master key (the wrap threw here, before the user doc was
 * touched). D-PRV-7 removed the wrap: createVaultSession() is RAM-only and
 * can no longer fail that way — the session-first order is kept for
 * simplicity and still guarantees the user is never left half-enabled
 * (fingerprint set, no session).
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

    // 1. Open the RAM session FIRST (see header: kept for simplicity — the
    //    account is never left half-enabled).
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
