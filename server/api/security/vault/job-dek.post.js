import crypto from 'node:crypto'
import { connectDB } from '~~/server/db/mongo'
import { getVaultSession } from '~~/server/utils/vault'
import { assertRateLimit } from '~~/server/utils/ratelimit'

/**
 * D-PRV-7 §4.2 — per-job DEK delivery to the workers over ephemeral ECDH.
 *
 * Wire contract (shared with the Python workers — do NOT deviate):
 *  - workerKeyPub / serverPub: base64 of an uncompressed X9.62 point
 *    (65 bytes, 0x04 prefix) on P-256;
 *  - shared  = raw ECDH secret (32 bytes, x coordinate);
 *  - transport key = HKDF-SHA256(ikm=shared, salt=32 explicit zero bytes,
 *    info="nest2d-job-dek-v1", length 32);
 *  - parcel  = base64( nonce(12) || ciphertext || tag(16) ) —
 *    AES-256-GCM(transportKey, DEK, AAD = UTF-8 bytes of the jobSlug).
 *
 * The route is intentionally unauthenticated: a parcel is only openable by
 * the holder of the ephemeral private key that matches the job's
 * workerKeyPub, so a third party gets nothing exploitable (rate-limit +
 * shape validation still apply). Nothing useful is persisted — even written
 * down, the parcel is undecryptable without both private halves (RAM on both
 * sides, forward secrecy).
 */

// Collections carrying vault-encrypted work, looked up by slug.
const JOB_COLLECTIONS = [
    'nesting_jobs',
    'strip_nesting_job_queue',
    'user_dxf_files',
    'strip_user_dxf_files',
]

const HKDF_INFO = 'nest2d-job-dek-v1'
// Explicit 32 zero bytes — part of the wire contract, not a random salt.
const HKDF_SALT = Buffer.alloc(32)

/**
 * Some Node builds trim the `secp256r1` alias (seen on OpenSSL 3.5 Windows
 * builds); `prime256v1` is the exact same curve (NIST P-256), so the wire
 * format is identical either way.
 */
function createP256Ecdh() {
    try {
        return crypto.createECDH('secp256r1')
    } catch {
        return crypto.createECDH('prime256v1')
    }
}

export default defineEventHandler(async (event) => {
    assertRateLimit(event, 'vault-job-dek', { limit: 60, windowMs: 60_000 })

    const body = await readBody(event)
    const jobSlug = typeof body?.jobSlug === 'string' ? body.jobSlug.trim() : ''
    if (!jobSlug) {
        throw createError({ statusCode: 400, statusMessage: 'jobSlug is required' })
    }

    const db = await connectDB()
    let doc = null
    for (const name of JOB_COLLECTIONS) {
        doc = await db.collection(name).findOne(
            { slug: jobSlug },
            { projection: { ownerId: 1, workerKeyPub: 1 } }
        )
        if (doc) break
    }
    if (!doc) {
        throw createError({ statusCode: 404, statusMessage: 'job_not_found' })
    }

    if (!doc.workerKeyPub) {
        throw createError({ statusCode: 400, statusMessage: 'no_worker_key' })
    }
    const workerPub = Buffer.from(String(doc.workerKeyPub), 'base64')
    if (workerPub.length !== 65 || workerPub[0] !== 0x04) {
        throw createError({ statusCode: 400, statusMessage: 'invalid worker_key' })
    }

    const session = await getVaultSession(doc.ownerId)
    if (!session) {
        throw createError({ statusCode: 409, statusMessage: 'vault_locked' })
    }

    let shared = null
    let transportKey = null
    try {
        const server = createP256Ecdh()
        server.generateKeys() // uncompressed point by default (65 bytes, 0x04)
        shared = server.computeSecret(workerPub)
        transportKey = Buffer.from(crypto.hkdfSync('sha256', shared, HKDF_SALT, HKDF_INFO, 32))

        const nonce = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', transportKey, nonce, { authTagLength: 16 })
        cipher.setAAD(Buffer.from(jobSlug, 'utf8'))
        // session.dek is the vault session's own buffer — NEVER wiped here.
        const parcel = Buffer.concat([nonce, cipher.update(session.dek), cipher.final(), cipher.getAuthTag()])

        return {
            serverPub: server.getPublicKey().toString('base64'),
            parcel: parcel.toString('base64'),
        }
    } finally {
        // Ephemeral key material never outlives the request.
        if (shared) shared.fill(0)
        if (transportKey) transportKey.fill(0)
    }
})
