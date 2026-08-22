import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { connectDB } from '../db/mongo'
import { DEMO_OWNER_ID } from '../../shared/constants/demo.constants'
import {
    ENC_FLAG,
    createDecryptStream,
    createEncryptStream,
    decryptBuffer,
    polygonPartsAadId,
} from './crypto'

/**
 * Vault session cache (D-PRV-7) — the only place a DEK exists server-side.
 *
 * Process-local RAM only: userId → { dek, expiresAt }. NOTHING is persisted
 * (the legacy `session_keys` Mongo collection with its master-key-wrapped
 * DEKs is dropped at boot by the vault-dprv7 plugin): a database dump or
 * backup can no longer expose even a wrapped DEK. Sliding TTL (2h) refreshed
 * on activity; expired entries are wiped (Buffer.fill(0)) opportunistically
 * on access — no timers. A process restart drops every session (users simply
 * re-unlock). Mono-instance deployment is assumed: future app replicas will
 * need sticky sessions.
 */

export const VAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000

/** @type {Map<string, { dek: Buffer, expiresAt: number }>} */
const sessions = new Map()

function wipeEntry(entry) {
    entry.dek.fill(0)
}

/**
 * Opportunistic sweep of expired sessions (wipe + delete). The Map is tiny
 * (one entry per unlocked user), so an O(n) scan on each access is fine and
 * avoids any timer.
 */
function sweepExpired(now) {
    for (const [userId, entry] of sessions) {
        if (entry.expiresAt <= now) {
            wipeEntry(entry)
            sessions.delete(userId)
        }
    }
}

/**
 * Opens (or replaces) a vault session. Stores a DEFENSIVE COPY of the DEK —
 * the session owns its buffer regardless of what the caller does with its
 * own. Any previous session for the user is wiped first.
 */
export async function createVaultSession(userId, dekBuffer) {
    const previous = sessions.get(userId)
    if (previous) wipeEntry(previous)
    const expiresAt = Date.now() + VAULT_SESSION_TTL_MS
    sessions.set(userId, { dek: Buffer.from(dekBuffer), expiresAt })
    return { expiresAt: new Date(expiresAt) }
}

/**
 * Returns the live DEK when an active session exists (sliding TTL refresh),
 * null otherwise. Expired entries are wiped on the way.
 *
 * ⚠️ The returned Buffer IS the session's buffer: callers must NEVER mutate
 * or wipe it. Wiping happens exclusively here, on expiry or via
 * clearVaultSessions().
 */
export async function getVaultSession(userId) {
    const now = Date.now()
    sweepExpired(now)
    const entry = sessions.get(userId)
    if (!entry) return null
    entry.expiresAt = now + VAULT_SESSION_TTL_MS
    return { dek: entry.dek, expiresAt: new Date(entry.expiresAt) }
}

export async function clearVaultSessions(userId) {
    const entry = sessions.get(userId)
    if (entry) {
        wipeEntry(entry)
        sessions.delete(userId)
    }
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
    // Demo project files (technical DEMO_OWNER_ID account) are world-readable:
    // the shared read-only demo project must be browsable by every user.
    // 404 (not 401) for a foreign file: a 401 on an existing slug was an
    // existence oracle for authenticated brute-force (pentest C-1).
    if (ownerId !== userId && ownerId !== DEMO_OWNER_ID) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    const encrypted = Boolean(fileDoc.metadata?.enc)
    let dek = null
    if (encrypted) {
        // Throws 403 vault_locked when the vault has no active session.
        ;({ dek } = await requireFileAccess(userId))
    }

    let stream
    try {
        stream = openDownloadFromBucket(bucket, fileName, { fileDoc, ownerId, dek })
        if (encrypted) {
            // Decrypt BEFORE sending bytes so a GCM failure is a 404, not a
            // mid-stream 500 (oracle of encryption / existence).
            const plain = await streamToBuffer(stream)
            stream = Readable.from(plain)
        }
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    return {
        stream,
        encrypted,
        fileDoc,
    }
}
