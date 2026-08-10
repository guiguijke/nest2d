/**
 * Interop lock for the D-PRV-7 job-dek delivery (THREAT-MODEL §4.2).
 *
 * Direction 1 (this script, Node = server role): generates a worker P-256
 * keypair + a DEK, seals the parcel EXACTLY like
 * server/api/security/vault/job-dek.post.js does (same primitives — keep in
 * sync), self-checks the opening, then writes vector-jobdek-node.json for
 * the Python side.
 *
 * Direction 2 (second pass): when vector-jobdek-py.json exists (written by
 * verify_jobdek.py, Python = server role), this script opens the
 * Python-sealed parcel with the worker private key — proving Node opens
 * Python parcels.
 *
 * Chain: node verify_jobdek.mjs → python verify_jobdek.py → node verify_jobdek.mjs
 *
 * Wire contract (do NOT deviate):
 *  - public keys: base64 of an uncompressed X9.62 point (65 bytes, 0x04);
 *  - shared = raw ECDH secret (32 bytes, x coordinate);
 *  - transport key = HKDF-SHA256(ikm=shared, salt=32 explicit zero bytes,
 *    info="nest2d-job-dek-v1", length 32);
 *  - parcel = base64( nonce(12) || ciphertext || tag(16) ),
 *    AES-256-GCM(transportKey, DEK, AAD = UTF-8 bytes of the job slug).
 */
import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const HERE = new URL('.', import.meta.url)
const NODE_VECTOR = new URL('./vector-jobdek-node.json', import.meta.url)
const PY_VECTOR = new URL('./vector-jobdek-py.json', import.meta.url)

const HKDF_INFO = 'nest2d-job-dek-v1'
const HKDF_SALT = Buffer.alloc(32) // explicit zeros — part of the contract

// Same fallback as job-dek.post.js: some Node builds lack the secp256r1 alias.
function createP256Ecdh() {
    try {
        return crypto.createECDH('secp256r1')
    } catch {
        return crypto.createECDH('prime256v1')
    }
}

function sealParcel({ workerPubRaw, dek, jobSlug }) {
    const server = createP256Ecdh()
    server.generateKeys()
    const shared = server.computeSecret(workerPubRaw)
    const transportKey = Buffer.from(crypto.hkdfSync('sha256', shared, HKDF_SALT, HKDF_INFO, 32))
    const nonce = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', transportKey, nonce, { authTagLength: 16 })
    cipher.setAAD(Buffer.from(jobSlug, 'utf8'))
    const parcel = Buffer.concat([nonce, cipher.update(dek), cipher.final(), cipher.getAuthTag()])
    shared.fill(0)
    transportKey.fill(0)
    return { serverPub: server.getPublicKey(), parcel }
}

function openParcel({ workerPrivRaw, serverPubRaw, parcelRaw, jobSlug }) {
    const worker = createP256Ecdh()
    worker.setPrivateKey(workerPrivRaw)
    const shared = worker.computeSecret(serverPubRaw)
    const transportKey = Buffer.from(crypto.hkdfSync('sha256', shared, HKDF_SALT, HKDF_INFO, 32))
    const nonce = parcelRaw.subarray(0, 12)
    const tag = parcelRaw.subarray(parcelRaw.length - 16)
    const ct = parcelRaw.subarray(12, parcelRaw.length - 16)
    const decipher = crypto.createDecipheriv('aes-256-gcm', transportKey, nonce, { authTagLength: 16 })
    decipher.setAAD(Buffer.from(jobSlug, 'utf8'))
    decipher.setAuthTag(tag)
    const dek = Buffer.concat([decipher.update(ct), decipher.final()])
    shared.fill(0)
    transportKey.fill(0)
    return dek
}

// --- Pass 1: Node seals (server role), self-checks, writes the vector. ---
if (!existsSync(PY_VECTOR)) {
    const jobSlug = 'interop-job-dek'
    const dek = crypto.randomBytes(32)
    const worker = createP256Ecdh()
    worker.generateKeys()
    const workerPrivRaw = worker.getPrivateKey()
    const workerPubRaw = worker.getPublicKey()
    if (workerPubRaw.length !== 65 || workerPubRaw[0] !== 0x04) {
        throw new Error('worker public key is not an uncompressed X9.62 point')
    }

    const { serverPub, parcel } = sealParcel({ workerPubRaw, dek, jobSlug })

    // Node↔Node sanity: the same worker key must open the parcel.
    const opened = openParcel({ workerPrivRaw, serverPubRaw: serverPub, parcelRaw: parcel, jobSlug })
    if (!opened.equals(dek)) throw new Error('Node self-check failed: parcel does not open')
    console.log('✓ Node seals and opens its own job-dek parcel (self-check)')

    writeFileSync(NODE_VECTOR, JSON.stringify({
        job_slug: jobSlug,
        dek: dek.toString('base64'),
        dek_fingerprint: crypto.createHash('sha256').update(dek).digest('hex'),
        worker_priv: workerPrivRaw.toString('base64'),
        worker_pub: workerPubRaw.toString('base64'),
        server_pub: serverPub.toString('base64'),
        parcel: parcel.toString('base64'),
    }, null, 2))
    console.log('✓ vector-jobdek-node.json written — now run verify_jobdek.py')
} else {
    // --- Pass 2: open the Python-sealed parcel (worker role). ---
    const nodeVector = JSON.parse(readFileSync(NODE_VECTOR, 'utf8'))
    const pyVector = JSON.parse(readFileSync(PY_VECTOR, 'utf8'))
    const dek = openParcel({
        workerPrivRaw: Buffer.from(nodeVector.worker_priv, 'base64'),
        serverPubRaw: Buffer.from(pyVector.server_pub, 'base64'),
        parcelRaw: Buffer.from(pyVector.parcel, 'base64'),
        jobSlug: pyVector.job_slug,
    })
    if (dek.toString('base64') !== pyVector.dek) {
        throw new Error('Python-sealed parcel opened to the WRONG dek')
    }
    console.log('✓ Node opens the Python-sealed job-dek parcel (HKDF + AES-GCM aligned)')
    console.log('\nJob-dek interop OK in both directions.')
}
