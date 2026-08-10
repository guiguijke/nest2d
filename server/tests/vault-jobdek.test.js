import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// D-PRV-7 §4.2 — POST /api/security/vault/job-dek: per-job DEK delivery to
// the workers over ephemeral ECDH P-256. The test plays the worker side:
// generate an ephemeral pair, plant the public key on a fake job doc, call
// the handler, then derive shared/HKDF and open the parcel.

const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

import jobDekHandler from '~~/server/api/security/vault/job-dek.post.js'
import { fakeDb } from './helpers/fakeMongo'

// Real vault session cache (RAM Map) — not mocked here.
const realVault = await vi.importActual('~~/server/utils/vault')

/** Same curve-alias fallback as the route (some Node builds lack secp256r1). */
function createP256Ecdh() {
    try {
        return crypto.createECDH('secp256r1')
    } catch {
        return crypto.createECDH('prime256v1')
    }
}

/** Plays the worker: fresh ephemeral P-256 pair, public key as base64. */
function makeWorkerKeys() {
    const ecdh = createP256Ecdh()
    ecdh.generateKeys()
    return { ecdh, pubB64: ecdh.getPublicKey().toString('base64') }
}

const ev = (body) => ({ context: {}, _body: body })

async function expectErr(promise, statusCode, statusMessage) {
    await expect(promise).rejects.toMatchObject({ statusCode, statusMessage })
}

beforeEach(() => {
    state.db = null
})

describe('POST /api/security/vault/job-dek (D-PRV-7)', () => {
    it('400 when jobSlug is missing or empty', async () => {
        state.db = fakeDb({})
        await expectErr(jobDekHandler(ev({})), 400, 'jobSlug is required')
        await expectErr(jobDekHandler(ev({ jobSlug: '   ' })), 400, 'jobSlug is required')
    })

    it('404 job_not_found for an unknown slug', async () => {
        state.db = fakeDb({ nesting_jobs: [{ slug: 'other', ownerId: 'w1' }] })
        await expectErr(jobDekHandler(ev({ jobSlug: 'nope' })), 404, 'job_not_found')
    })

    it('400 no_worker_key when the job carries no workerKeyPub', async () => {
        state.db = fakeDb({ nesting_jobs: [{ slug: 'job-1', ownerId: 'w1' }] })
        await expectErr(jobDekHandler(ev({ jobSlug: 'job-1' })), 400, 'no_worker_key')
    })

    it('400 invalid worker_key on a malformed point (wrong length / prefix)', async () => {
        state.db = fakeDb({
            nesting_jobs: [
                { slug: 'job-2', ownerId: 'w1', workerKeyPub: Buffer.alloc(33, 1).toString('base64') },
                // 65 bytes but compressed-point prefix (0x02) — not the wire format.
                { slug: 'job-3', ownerId: 'w1', workerKeyPub: Buffer.concat([Buffer.from([2]), Buffer.alloc(64, 1)]).toString('base64') },
            ],
        })
        await expectErr(jobDekHandler(ev({ jobSlug: 'job-2' })), 400, 'invalid worker_key')
        await expectErr(jobDekHandler(ev({ jobSlug: 'job-3' })), 400, 'invalid worker_key')
    })

    it('409 vault_locked without an active session for the job owner', async () => {
        const worker = makeWorkerKeys()
        state.db = fakeDb({
            nesting_jobs: [{ slug: 'job-4', ownerId: 'w-no-session', workerKeyPub: worker.pubB64 }],
        })
        await expectErr(jobDekHandler(ev({ jobSlug: 'job-4' })), 409, 'vault_locked')
    })

    it('finds jobs across every vault-capable collection', async () => {
        const worker = makeWorkerKeys()
        state.db = fakeDb({
            strip_user_dxf_files: [{ slug: 'job-5', ownerId: 'w5', workerKeyPub: worker.pubB64 }],
        })
        await realVault.createVaultSession('w5', crypto.randomBytes(32))
        const res = await jobDekHandler(ev({ jobSlug: 'job-5' }))
        expect(res.serverPub).toBeTruthy()
        expect(res.parcel).toBeTruthy()
        await realVault.clearVaultSessions('w5')
    })

    it('happy path: the worker derives the same transport key and opens the parcel', async () => {
        const worker = makeWorkerKeys()
        const dek = crypto.randomBytes(32)
        state.db = fakeDb({
            nesting_jobs: [{ slug: 'job-happy', ownerId: 'w6', workerKeyPub: worker.pubB64 }],
        })
        await realVault.createVaultSession('w6', dek)

        const res = await jobDekHandler(ev({ jobSlug: 'job-happy' }))

        // serverPub: base64 uncompressed X9.62 point (65 bytes, 0x04).
        const serverPub = Buffer.from(res.serverPub, 'base64')
        expect(serverPub.length).toBe(65)
        expect(serverPub[0]).toBe(0x04)

        // Worker side: shared = ECDH(workerPriv, serverPub), then HKDF with
        // the contract's explicit zero salt and info string.
        const shared = worker.ecdh.computeSecret(serverPub)
        const transportKey = Buffer.from(
            crypto.hkdfSync('sha256', shared, Buffer.alloc(32), 'nest2d-job-dek-v1', 32)
        )

        // parcel = base64( nonce(12) || ciphertext || tag(16) ), AAD = jobSlug.
        const parcel = Buffer.from(res.parcel, 'base64')
        const nonce = parcel.subarray(0, 12)
        const tag = parcel.subarray(parcel.length - 16)
        const ct = parcel.subarray(12, parcel.length - 16)
        const decipher = crypto.createDecipheriv('aes-256-gcm', transportKey, nonce, { authTagLength: 16 })
        decipher.setAAD(Buffer.from('job-happy', 'utf8'))
        decipher.setAuthTag(tag)
        const opened = Buffer.concat([decipher.update(ct), decipher.final()])
        expect(opened.equals(dek)).toBe(true)

        // AAD is binding: the same parcel under another slug must NOT open.
        const wrong = crypto.createDecipheriv('aes-256-gcm', transportKey, nonce, { authTagLength: 16 })
        wrong.setAAD(Buffer.from('another-slug', 'utf8'))
        wrong.setAuthTag(tag)
        expect(() => Buffer.concat([wrong.update(ct), wrong.final()])).toThrow()

        // The session DEK survives: the route must never wipe the Map buffer.
        const session = await realVault.getVaultSession('w6')
        expect(session.dek.equals(dek)).toBe(true)
        await realVault.clearVaultSessions('w6')
    })
})
