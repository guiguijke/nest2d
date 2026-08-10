import crypto from 'node:crypto'
import { Transform } from 'node:stream'

/**
 * Zero-knowledge vault crypto — AES-256-GCM with per-frame authentication.
 *
 * File format (streamed, GridFS-agnostic):
 *   frame[i] = nonce (12 bytes) || ciphertext || GCM tag (16 bytes)
 *   AAD      = `${fileId}|${ownerId}|${frameIndex}`
 * Each frame encrypts up to PLAINTEXT_BLOCK bytes of plaintext, so every
 * frame has a fixed size (12 + PLAINTEXT_BLOCK + 16) except the last one.
 *
 * ⚠️ The Python workers implement the exact same format (see
 * workers/.../utils/crypto.py) — any change here must be mirrored there and
 * re-validated with the interop vectors in scripts/crypto-interop/.
 */

export const PLAINTEXT_BLOCK = 256 * 1024
export const NONCE_SIZE = 12
export const TAG_SIZE = 16
export const FRAME_SIZE = NONCE_SIZE + PLAINTEXT_BLOCK + TAG_SIZE
export const ENC_FLAG = { v: 1, algo: 'aes-256-gcm' }

function aadFor(fileId, ownerId, frameIndex) {
    return Buffer.from(`${fileId}|${ownerId}|${frameIndex}`, 'utf8')
}

/** SHA-256 hex of the DEK — stored server-side to verify presented keys. */
export function fingerprintKey(dekBuffer) {
    return crypto.createHash('sha256').update(dekBuffer).digest('hex')
}

/**
 * One-shot frame-format encryption (same wire format as the streams — used
 * for small payloads like the encrypted polygonParts blob, and mirrored by
 * the Python workers).
 */
export function encryptBuffer(dek, aadId, ownerId, plain) {
    const out = []
    let frameIndex = 0
    for (let off = 0; off < plain.length; off += PLAINTEXT_BLOCK) {
        const nonce = crypto.randomBytes(NONCE_SIZE)
        const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_SIZE })
        cipher.setAAD(aadFor(aadId, ownerId, frameIndex))
        frameIndex += 1
        out.push(nonce, cipher.update(plain.subarray(off, off + PLAINTEXT_BLOCK)), cipher.final(), cipher.getAuthTag())
    }
    return Buffer.concat(out)
}

export function decryptBuffer(dek, aadId, ownerId, data) {
    const out = []
    let frameIndex = 0
    let off = 0
    while (data.length - off > FRAME_SIZE) {
        out.push(openFrame(dek, aadId, ownerId, data.subarray(off, off + FRAME_SIZE), frameIndex))
        frameIndex += 1
        off += FRAME_SIZE
    }
    if (off < data.length) {
        const frame = data.subarray(off)
        if (frame.length <= NONCE_SIZE + TAG_SIZE) {
            throw new Error('Corrupted encrypted payload: truncated final frame')
        }
        out.push(openFrame(dek, aadId, ownerId, frame, frameIndex))
    }
    return Buffer.concat(out)
}

function openFrame(dek, aadId, ownerId, frame, frameIndex) {
    const nonce = frame.subarray(0, NONCE_SIZE)
    const tag = frame.subarray(frame.length - TAG_SIZE)
    const ct = frame.subarray(NONCE_SIZE, frame.length - TAG_SIZE)
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_SIZE })
    decipher.setAAD(aadFor(aadId, ownerId, frameIndex))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()])
}

/** AAD id used for the encrypted polygonParts blob stored on file docs. */
export function polygonPartsAadId(fileSlug) {
    return `polygonParts:${fileSlug}`
}

/** Short public identifier embedded in the key file name. */
export function keyIdFromFingerprint(fingerprint) {
    return fingerprint.slice(0, 8)
}

/** Timing-safe comparison of two hex fingerprints. */
export function fingerprintsEqual(a, b) {
    const bufA = Buffer.from(String(a || ''), 'utf8')
    const bufB = Buffer.from(String(b || ''), 'utf8')
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
}

/** Transform: plaintext in, framed ciphertext out. */
export function createEncryptStream(dek, fileId, ownerId) {
    let buffer = Buffer.alloc(0)
    let frameIndex = 0

    function seal(block) {
        const nonce = crypto.randomBytes(NONCE_SIZE)
        const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_SIZE })
        cipher.setAAD(aadFor(fileId, ownerId, frameIndex))
        frameIndex += 1
        const ct = Buffer.concat([cipher.update(block), cipher.final()])
        return Buffer.concat([nonce, ct, cipher.getAuthTag()])
    }

    return new Transform({
        transform(chunk, _enc, cb) {
            buffer = Buffer.concat([buffer, chunk])
            while (buffer.length >= PLAINTEXT_BLOCK) {
                this.push(seal(buffer.subarray(0, PLAINTEXT_BLOCK)))
                buffer = buffer.subarray(PLAINTEXT_BLOCK)
            }
            cb()
        },
        flush(cb) {
            if (buffer.length > 0) {
                this.push(seal(buffer))
                buffer = Buffer.alloc(0)
            }
            cb()
        },
    })
}

/** Transform: framed ciphertext in, plaintext out. */
export function createDecryptStream(dek, fileId, ownerId) {
    let buffer = Buffer.alloc(0)
    let frameIndex = 0

    function open(frame) {
        const nonce = frame.subarray(0, NONCE_SIZE)
        const tag = frame.subarray(frame.length - TAG_SIZE)
        const ct = frame.subarray(NONCE_SIZE, frame.length - TAG_SIZE)
        const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_SIZE })
        decipher.setAAD(aadFor(fileId, ownerId, frameIndex))
        decipher.setAuthTag(tag)
        frameIndex += 1
        return Buffer.concat([decipher.update(ct), decipher.final()])
    }

    return new Transform({
        transform(chunk, _enc, cb) {
            buffer = Buffer.concat([buffer, chunk])
            // Always keep the tail: the last frame may be shorter than FRAME_SIZE.
            while (buffer.length > FRAME_SIZE) {
                this.push(open(buffer.subarray(0, FRAME_SIZE)))
                buffer = buffer.subarray(FRAME_SIZE)
            }
            cb()
        },
        flush(cb) {
            if (buffer.length > 0) {
                if (buffer.length <= NONCE_SIZE + TAG_SIZE) {
                    return cb(new Error('Corrupted encrypted stream: truncated final frame'))
                }
                this.push(open(buffer))
                buffer = Buffer.alloc(0)
            }
            cb()
        },
    })
}
