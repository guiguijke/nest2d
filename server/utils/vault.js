import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { connectDB } from '~~/server/db/mongo'
import {
    ENC_FLAG,
    createDecryptStream,
    createEncryptStream,
    decryptBuffer,
    polygonPartsAadId,
    unwrapDek,
    wrapDek,
} from '~~/server/utils/crypto'

/**
 * Vault session cache — the only place a DEK exists server-side.
 *
 * The DEK is stored wrapped (AES-256-GCM under the deployment master key) in
 * the `session_keys` collection with a TTL index: it is never persisted in
 * clear, never logged, and disappears at expiry. Sliding TTL (2h) refreshed
 * on activity.
 */

export const VAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000

let indexesReady = false

async function ensureVaultIndexes(db) {
    if (indexesReady) return
    await db.collection('session_keys').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
    )
    await db.collection('session_keys').createIndex({ userId: 1 }, { unique: true })
    indexesReady = true
}

export async function createVaultSession(userId, dekBuffer) {
    const db = await connectDB()
    await ensureVaultIndexes(db)
    const expiresAt = new Date(Date.now() + VAULT_SESSION_TTL_MS)
    await db.collection('session_keys').updateOne(
        { userId },
        {
            $set: {
                userId,
                wrappedDek: wrapDek(dekBuffer),
                expiresAt,
                updatedAt: new Date(),
            },
        },
        { upsert: true }
    )
    return { expiresAt }
}

/**
 * Returns the unwrapped DEK if an active session exists (sliding TTL
 * refresh), null otherwise.
 */
export async function getVaultSession(userId) {
    const db = await connectDB()
    await ensureVaultIndexes(db)
    const doc = await db.collection('session_keys').findOne({
        userId,
        expiresAt: { $gt: new Date() },
    })
    if (!doc) return null

    const expiresAt = new Date(Date.now() + VAULT_SESSION_TTL_MS)
    await db.collection('session_keys').updateOne(
        { userId },
        { $set: { expiresAt, updatedAt: new Date() } }
    )
    return { dek: unwrapDek(doc.wrappedDek), expiresAt }
}

export async function clearVaultSessions(userId) {
    const db = await connectDB()
    await db.collection('session_keys').deleteMany({ userId })
}

export async function getVaultStatus(userId) {
    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    const enabled = Boolean(user?.encryption?.enabled)
    const session = enabled ? await getVaultSession(userId) : null
    return {
        enabled,
        locked: enabled && !session,
        expiresAt: session?.expiresAt || null,
        keyId: user?.encryption?.keyId || null,
        createdAt: user?.encryption?.createdAt || null,
    }
}

/**
 * Gate for file-touching routes. Returns { dek } when the vault is unlocked,
 * { dek: null } when encryption is disabled (legacy plaintext path), and
 * throws 403 vault_locked when the user has an encrypted vault but no active
 * session.
 */
export async function requireFileAccess(userId) {
    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    if (!user?.encryption?.enabled) return { dek: null }

    const session = await getVaultSession(userId)
    if (!session) {
        throw createError({ statusCode: 403, statusMessage: 'vault_locked' })
    }
    return { dek: session.dek }
}

/**
 * Upload a buffer to a GridFS bucket, encrypting on the fly when a DEK is
 * provided. Sets metadata.ownerId and the enc flag so readers (Node routes
 * and Python workers) can distinguish encrypted files from legacy plaintext.
 * Returns a promise resolving when the file is fully persisted.
 */
export async function uploadToBucket(bucket, filename, buffer, { ownerId, dek = null, extraMetadata = {} }) {
    const metadata = { ownerId, ...extraMetadata }
    if (dek) metadata.enc = ENC_FLAG

    const uploadStream = bucket.openUploadStream(filename, { metadata })
    const source = Readable.from(buffer)
    if (dek) {
        await pipeline(source, createEncryptStream(dek, filename, ownerId), uploadStream)
    } else {
        await pipeline(source, uploadStream)
    }
}

/**
 * Open a download stream, transparently decrypting when the file carries the
 * enc flag. `fileDoc` is the GridFS files document (already fetched by the
 * caller for ownership checks).
 */
export function openDownloadFromBucket(bucket, filename, { fileDoc, ownerId, dek = null }) {
    const raw = bucket.openDownloadStreamByName(filename)
    const encrypted = Boolean(fileDoc?.metadata?.enc)
    if (!encrypted) return raw
    if (!dek) {
        throw createError({ statusCode: 403, statusMessage: 'vault_locked' })
    }
    return raw.pipe(createDecryptStream(dek, filename, ownerId))
}

export async function streamToBuffer(stream) {
    const chunks = []
    for await (const chunk of stream) {
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

/**
 * Returns the polygonParts of a file document, decrypting the enc blob when
 * the file was processed while the vault was enabled. Throws 403
 * vault_locked when parts are encrypted but no session is active.
 */
export async function resolvePolygonParts(userId, fileDoc) {
    if (fileDoc?.encPolygonParts?.data) {
        const { dek } = await requireFileAccess(userId)
        const plain = decryptBuffer(
            dek,
            polygonPartsAadId(fileDoc.slug),
            userId,
            Buffer.from(fileDoc.encPolygonParts.data, 'base64')
        )
        return JSON.parse(plain.toString('utf8'))
    }
    return fileDoc?.polygonParts || []
}

/**
 * Shared download gate for /api/files/** routes: auth, ownership (owner or
 * admin), vault unlock check, transparent decryption. Returns the stream to
 * use as response body and whether the file is encrypted (so callers can
 * downgrade Cache-Control to private, no-store).
 */
export async function openOwnedFileStream(event, bucket, fileName) {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const files = await bucket.find({ filename: fileName }).toArray()
    const fileDoc = files[0]
    if (!fileDoc) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    const ownerId = fileDoc.metadata?.ownerId
    if (ownerId !== userId && event.context.auth?.isAdmin !== true) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const encrypted = Boolean(fileDoc.metadata?.enc)
    let dek = null
    if (encrypted) {
        // Throws 403 vault_locked when the vault has no active session.
        ;({ dek } = await requireFileAccess(userId))
    }

    return {
        stream: openDownloadFromBucket(bucket, fileName, { fileDoc, ownerId, dek }),
        encrypted,
        fileDoc,
    }
}
