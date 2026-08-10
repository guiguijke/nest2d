/**
 * Standalone round-trip test for server/utils/crypto.js.
 * Stubs the Nuxt auto-imports the module relies on, then verifies:
 *  - encrypt → decrypt over multi-frame + partial-frame payloads
 *  - tamper detection (GCM tag)
 *  - writes the JS→Python interop vector for scripts/crypto-interop/
 *
 * Run: node scripts/crypto-roundtrip.mjs
 */
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { writeFileSync } from 'node:fs'

// --- Stubs for Nuxt auto-imports used inside server/utils/crypto.js ---
globalThis.createError = (opts) => Object.assign(new Error(opts.statusMessage), opts)

const {
    PLAINTEXT_BLOCK,
    fingerprintKey,
    createEncryptStream,
    createDecryptStream,
} = await import('../server/utils/crypto.js')

async function pipe(streams, input) {
    const chunks = []
    let s = Readable.from(input)
    for (const t of streams) s = s.pipe(t)
    for await (const c of s) chunks.push(c)
    return Buffer.concat(chunks)
}

const dek = crypto.randomBytes(32)
const fileId = 'test-file-abc123.dxf'
const ownerId = 'local:test@example.com'

// 1. Multi-frame + partial frame round-trip (2.5 blocks of pseudo-random data)
const sizes = [0, 1, 100, PLAINTEXT_BLOCK, PLAINTEXT_BLOCK + 7, 2 * PLAINTEXT_BLOCK + 12345, 3 * PLAINTEXT_BLOCK]
for (const size of sizes) {
    const plain = crypto.randomBytes(size)
    const encrypted = await pipe([createEncryptStream(dek, fileId, ownerId)], plain)
    const expected = size === 0 ? 0 : Math.ceil(size / PLAINTEXT_BLOCK) * (12 + 16) + size
    if (encrypted.length !== expected) {
        throw new Error(`size ${size}: expected ${expected} encrypted bytes, got ${encrypted.length}`)
    }
    const decrypted = await pipe([createDecryptStream(dek, fileId, ownerId)], encrypted)
    if (!decrypted.equals(plain)) throw new Error(`round-trip mismatch at size ${size}`)
    console.log(`✓ round-trip ${size} bytes (${Math.ceil(size / PLAINTEXT_BLOCK)} frame(s))`)
}

// 2. Streaming with tiny chunks (GridFS-like chunking on the decrypt side)
{
    const plain = crypto.randomBytes(PLAINTEXT_BLOCK + 500)
    const encrypted = await pipe([createEncryptStream(dek, fileId, ownerId)], plain)
    const dec = createDecryptStream(dek, fileId, ownerId)
    const out = []
    for (let i = 0; i < encrypted.length; i += 997) {
        const c = dec.write(encrypted.subarray(i, i + 997))
        // drain via async iterator instead:
    }
    dec.end()
    const chunks = []
    for await (const c of dec) chunks.push(c)
    if (!Buffer.concat(chunks).equals(plain)) throw new Error('chunked decrypt mismatch')
    console.log('✓ decrypt with 997-byte input chunks')
}

// 3. Tamper detection
{
    const plain = crypto.randomBytes(1000)
    const encrypted = await pipe([createEncryptStream(dek, fileId, ownerId)], plain)
    encrypted[20] ^= 0xff
    let failed = false
    try {
        await pipe([createDecryptStream(dek, fileId, ownerId)], encrypted)
    } catch {
        failed = true
    }
    if (!failed) throw new Error('tampered ciphertext was NOT rejected')
    console.log('✓ tampered ciphertext rejected')
}

// 4. Wrong AAD (different fileId) rejected
{
    const plain = crypto.randomBytes(1000)
    const encrypted = await pipe([createEncryptStream(dek, fileId, ownerId)], plain)
    let failed = false
    try {
        await pipe([createDecryptStream(dek, 'other-file.dxf', ownerId)], encrypted)
    } catch {
        failed = true
    }
    if (!failed) throw new Error('wrong AAD was NOT rejected')
    console.log('✓ wrong AAD rejected')
}

// 5. Interop vector for the Python workers (fixed key, fixed nonces? No —
// nonces are random per frame, so the vector is a full encrypted payload the
// Python side must be able to decrypt).
{
    const vectorDek = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex')
    const vectorFileId = 'interop-vector.dxf'
    const vectorOwnerId = 'local:interop@nest2d.dev'
    const plain = Buffer.concat([
        Buffer.from('Nest2D interop vector — the quick brown fox jumps over the lazy dog.\n'),
        crypto.randomBytes(PLAINTEXT_BLOCK + 42),
    ])
    const encrypted = await pipe([createEncryptStream(vectorDek, vectorFileId, vectorOwnerId)], plain)
    writeFileSync('scripts/crypto-interop/vector-js.json', JSON.stringify({
        dek: vectorDek.toString('base64'),
        fileId: vectorFileId,
        ownerId: vectorOwnerId,
        plaintext_sha256: crypto.createHash('sha256').update(plain).digest('hex'),
        ciphertext: encrypted.toString('base64'),
        dek_fingerprint: fingerprintKey(vectorDek),
    }, null, 2))
    console.log('✓ interop vector written to scripts/crypto-interop/vector-js.json')
}

console.log('\nAll crypto round-trip tests passed.')
