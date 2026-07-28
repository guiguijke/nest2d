import {
    connectDB,
    getDxfResultBucket,
    getStripNestDxfBucket,
    getStripUserDxfBucket,
    getSvgResultBucket,
    getUserDxfBucket,
    getUserDxfFilesSvgBucket,
    getValidUserDxfBucket,
} from '~~/server/db/mongo'
import { clearVaultSessions } from '~~/server/utils/vault'
import { assertRateLimit } from '~~/server/utils/ratelimit'

/**
 * Destroys the vault and ALL user data, without requiring an unlocked session.
 *
 * This is the recovery path for a user whose vault is in a broken/locked
 * state (e.g. the deployment master key is misconfigured so the DEK can no
 * longer be unwrapped, or the key file was lost). Crypto-shredding: the
 * encrypted files are deleted outright — they were unrecoverable noise
 * anyway, so no DEK is needed. This deliberately does NOT call
 * requireFileAccess / getVaultSession, which is what blocks the normal
 * disable('destroy') flow when locked.
 *
 * Expects a confirmation payload so it cannot be triggered accidentally.
 */
const BUCKET_GETTERS = [
    getUserDxfBucket,
    getValidUserDxfBucket,
    getUserDxfFilesSvgBucket,
    getStripUserDxfBucket,
    getDxfResultBucket,
    getSvgResultBucket,
    getStripNestDxfBucket,
]

// Collections scoped by ownerId that hold the user's nesting/strip data.
// Cleared as part of a full wipe (the legacy disable('destroy') missed these).
const OWNER_COLLECTIONS = [
    'user_dxf_files',
    'strip_user_dxf_files',
    'projects',
    'strip_projects',
    'nesting_jobs',
    'strip_nesting_job_queue',
]

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    assertRateLimit(event, 'vault-destroy', { limit: 5, windowMs: 60_000 })

    const body = await readBody(event)
    if (body?.confirm !== 'DESTROY') {
        throw createError({
            statusCode: 400,
            statusMessage: 'Confirmation required (expected confirm: "DESTROY")',
        })
    }

    const db = await connectDB()

    // 1. Delete every user file across all owner-carrying GridFS buckets.
    //    No DEK involved — crypto-shredding just deletes the ciphertext.
    for (const getBucket of BUCKET_GETTERS) {
        const bucket = await getBucket()
        const files = await bucket.find({ 'metadata.ownerId': userId }).toArray()
        await Promise.all(files.map((f) => bucket.delete(f._id)))
    }

    // 2. Delete the user-scoped Mongo collections (wider than legacy destroy).
    await Promise.all(
        OWNER_COLLECTIONS.map((name) =>
            db.collection(name).deleteMany({ ownerId: userId })
        )
    )

    // 3. Drop the wrapped DEK session (plain deleteMany, no unwrap needed).
    await clearVaultSessions(userId)

    // 4. Flip encryption off last — even if a step above failed partway, the
    //    data was unrecoverable anyway, and the user must be able to keep
    //    using the app in plaintext mode afterwards.
    await db.collection('users').updateOne(
        { id: userId },
        { $unset: { encryption: '' } }
    )

    return { ok: true, destroyed: true }
})
