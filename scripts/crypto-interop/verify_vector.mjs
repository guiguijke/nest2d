/**
 * Interop test: Python -> JS. Decrypts vector-py.json with the server-side
 * crypto module. Run after scripts/crypto-interop/verify_vector.py.
 *
 * Run: node scripts/crypto-interop/verify_vector.mjs
 */
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

globalThis.useRuntimeConfig = () => ({ encryptionMasterKey: '' })
globalThis.createError = (opts) => Object.assign(new Error(opts.statusMessage), opts)

const { decryptBuffer, fingerprintKey } = await import('../../server/utils/crypto.js')

const vector = JSON.parse(readFileSync(new URL('./vector-py.json', import.meta.url), 'utf8'))
const dek = Buffer.from(vector.dek, 'base64')
const plain = decryptBuffer(dek, vector.fileId, vector.ownerId, Buffer.from(vector.ciphertext, 'base64'))
const digest = crypto.createHash('sha256').update(plain).digest('hex')

if (digest !== vector.plaintext_sha256) {
    throw new Error(`Python vector decryption mismatch: ${digest} != ${vector.plaintext_sha256}`)
}
if (fingerprintKey(dek) !== vector.dek_fingerprint) {
    throw new Error('fingerprint mismatch')
}
console.log('✓ Node decrypts the Python vector (multi-frame) and fingerprints match')
