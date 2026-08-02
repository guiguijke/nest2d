import crypto from 'node:crypto'
import { connectDB } from '~~/server/db/mongo'
import logger from '~~/server/utils/logger'

/**
 * Email verification for local signups.
 *
 * Mirrors the password-reset pattern: a random 32-byte token is emailed in
 * plaintext, only its SHA-256 hash is stored (single active token per user,
 * single use, 24 h expiry). No TTL index — expiry is checked at read time.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function sendEmailVerification(event, userId, email) {
    const config = useRuntimeConfig(event)
    const db = await connectDB()

    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Invalidate any previous verification tokens for this user.
    await db.collection('emailVerifications').deleteMany({ userId })
    await db.collection('emailVerifications').insertOne({
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        createdAt: new Date(),
    })

    const verifyUrl = `${config.public.baseUrl}/api/auth/local/verify-email?token=${token}`
    const { sendVerificationEmail } = await import('~~/server/features/notification/sendEmail')
    await sendVerificationEmail(email, verifyUrl)
    logger.info(`Verification email sent to ${email}`)
}

export async function consumeVerificationToken(token) {
    const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex')

    const db = await connectDB()
    const record = await db.collection('emailVerifications').findOne({
        tokenHash,
        expiresAt: { $gt: new Date() },
    })
    if (!record) {
        return null
    }

    await db.collection('users').updateOne(
        { id: record.userId },
        { $set: { emailVerified: true, emailVerifiedAt: new Date() } }
    )
    // Single use: all tokens for this user are now pointless.
    await db.collection('emailVerifications').deleteMany({ userId: record.userId })
    return record.userId
}
