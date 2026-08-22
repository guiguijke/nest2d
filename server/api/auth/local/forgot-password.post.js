import crypto from 'node:crypto'
import { connectDB } from '~~/server/db/mongo'
import { sendPasswordResetEmail } from '~~/server/features/notification/sendEmail'
import logger from '~~/server/utils/logger'
import { assertRateLimit, rateLimitAllow, denyRateLimit } from '~~/server/utils/ratelimit'

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    if (config.public.localAuthEnabled === false || config.public.localAuthEnabled === 'false') {
        throw createError({ statusCode: 403, statusMessage: 'Local authentication is disabled' })
    }

    const body = await readBody(event)
    const email = String(body?.email || '').trim().toLowerCase()

    if (!email) {
        throw createError({ statusCode: 400, statusMessage: 'Email is required' })
    }

    assertRateLimit(event, 'forgot-ip', { limit: 10, windowMs: 60 * 60_000 })
    if (!rateLimitAllow(`forgot-email:${email}`, { limit: 3, windowMs: 60 * 60_000 })) {
        denyRateLimit(event, { windowMs: 60 * 60_000 })
    }

    const db = await connectDB()
    const userId = `local:${email}`
    const user = await db.collection('users').findOne({ id: userId })

    // Always return ok to avoid leaking which emails have an account.
    if (user) {
        const token = crypto.randomBytes(32).toString('hex')
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

        // Invalidate any previous reset tokens for this user.
        await db.collection('passwordResets').deleteMany({ userId })
        await db.collection('passwordResets').insertOne({
            userId,
            tokenHash,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            createdAt: new Date(),
        })

        const resetUrl = `${config.public.baseUrl}/auth/reset-password?token=${token}`
        try {
            await sendPasswordResetEmail(email, resetUrl)
        } catch (err) {
            logger.error('Failed to send password reset email:', err)
            throw createError({ statusCode: 500, statusMessage: 'Failed to send the reset email. Please try again later.' })
        }
    }

    return { ok: true }
})
