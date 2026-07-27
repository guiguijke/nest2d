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
import {
    createDecryptStream,
    createEncryptStream,
    decryptBuffer,
    encryptBuffer,
    fingerprintKey,
    fingerprintsEqual,
    keyIdFromFingerprint,
    polygonPartsAadId,
} from '~~/server/utils/crypto'
import {
    createVaultSession,
    requireFileAccess,
    streamToBuffer,
    uploadToBucket,
} from '~~/server/utils/vault'

const BUCKET_GETTERS = [
    getUserDxfBucket,
    getValidUserDxfBucket,
    getUserDxfFilesSvgBucket,
    getStripUserDxfBucket,
    getDxfResultBucket,
    getSvgResultBucket,
    getStripNestDxfBucket,
]

/**
 * Key rotation: the client generates a fresh DEK (and has already downloaded
 * the new key file), sends it once; every encrypted file and polygonParts
 * blob is re-encrypted from the old DEK to the new one, then the fingerprint
 * is flipped. The old key file becomes useless.
 *
 * The vault fingerprint is only updated after a successful full pass — a
 * failure leaves the vault on the old key (files already re-encrypted are
 * the exception and would need a retry with the same new key).
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    if (!user?.encryption?.enabled) {
        throw createError({ statusCode: 400, statusMessage: 'Vault is not enabled' })
    }

    // Throws 403 vault_locked when no active session exists — the old DEK is
    // required to re-encrypt.
    const { dek: oldDek } = await requireFileAccess(userId)

    const body = await readBody(event)
    const newDek = Buffer.from(String(body?.key || ''), 'base64')
    if (newDek.length !== 32) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid key' })
    }

    const newFingerprint = fingerprintKey(newDek)
    if (fingerprintsEqual(newFingerprint, user.encryption.fingerprint)) {
        throw createError({ statusCode: 400, statusMessage: 'The new key must be different from the current one' })
    }

    // 1. Re-encrypt every encrypted GridFS file old → new.
    for (const getBucket of BUCKET_GETTERS) {
        const bucket = await getBucket()
        const files = await bucket.find({ 'metadata.ownerId': userId, 'metadata.enc': { $exists: true } }).toArray()
        for (const file of files) {
            const plain = await streamToBuffer(
                bucket.openDownloadStream(file._id).pipe(
                    createDecryptStream(oldDek, file.filename, userId)
                )
            )
            await bucket.delete(file._id)
            await uploadToBucket(bucket, file.filename, plain, { ownerId: userId, dek: newDek })
        }
    }

    // 2. Re-encrypt the polygonParts blobs.
    for (const collectionName of ['user_dxf_files', 'strip_user_dxf_files']) {
        const docs = await db.collection(collectionName)
            .find({ ownerId: userId, encPolygonParts: { $exists: true } })
            .toArray()
        for (const doc of docs) {
            const parts = JSON.parse(
                decryptBuffer(oldDek, polygonPartsAadId(doc.slug), userId, Buffer.from(doc.encPolygonParts.data, 'base64'))
                    .toString('utf8')
            )
            const blob = encryptBuffer(newDek, polygonPartsAadId(doc.slug), userId, Buffer.from(JSON.stringify(parts), 'utf8'))
            await db.collection(collectionName).updateOne(
                { _id: doc._id },
                { $set: { encPolygonParts: { v: 1, data: blob.toString('base64') } } }
            )
        }
    }

    // 3. Flip the fingerprint and seed a session with the new key.
    await db.collection('users').updateOne(
        { id: userId },
        {
            $set: {
                'encryption.keyId': keyIdFromFingerprint(newFingerprint),
                'encryption.fingerprint': newFingerprint,
                'encryption.rotatedAt': new Date(),
            },
        }
    )
    const { expiresAt } = await createVaultSession(userId, newDek)

    return { ok: true, keyId: keyIdFromFingerprint(newFingerprint), expiresAt }
})
