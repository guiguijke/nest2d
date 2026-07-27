import { connectDB } from '~~/server/db/mongo'
import { fingerprintKey, fingerprintsEqual } from '~~/server/utils/crypto'
import { createVaultSession } from '~~/server/utils/vault'
import { assertRateLimit } from '~~/server/utils/ratelimit'

/**
 * Unlocks the vault for a work session: the presented key is checked against
 * the stored SHA-256 fingerprint (timing-safe), then kept wrapped in the
 * ephemeral session cache (2h sliding TTL).
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    assertRateLimit(event, 'vault-unlock', { limit: 10, windowMs: 60_000 })

    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    if (!user?.encryption?.enabled) {
        throw createError({ statusCode: 400, statusMessage: 'Vault is not enabled' })
    }

    const body = await readBody(event)
    const dek = Buffer.from(String(body?.key || ''), 'base64')
    if (dek.length !== 32 || !fingerprintsEqual(fingerprintKey(dek), user.encryption.fingerprint)) {
        throw createError({ statusCode: 403, statusMessage: 'wrong_key' })
    }

    const { expiresAt } = await createVaultSession(userId, dek)
    return { ok: true, expiresAt }
})
