import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { connectDB } from '~~/server/db/mongo'
import { assertRateLimit } from '~~/server/utils/ratelimit'

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    if (config.public.localAuthEnabled === false || config.public.localAuthEnabled === 'false') {
        throw createError({ statusCode: 403, statusMessage: 'Local authentication is disabled' })
    }

    const body = await readBody(event)
    const token = String(body?.token || '')
    const password = String(body?.password || '')

    if (!token) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid reset link' })
    }
    if (password.length < 8) {
        throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
    }

    assertRateLimit(event, 'reset-ip', { limit: 10, windowMs: 60 * 60_000 })

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const db = await connectDB()
    const reset = await db.collection('passwordResets').findOne({
        tokenHash,
        expiresAt: { $gt: new Date() },
    })

    if (!reset) {
        throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    // Update the password and drop all sessions to force a fresh login
    // everywhere the account was connected.
    await db.collection('users').updateOne(
        { id: reset.userId },
        { $set: { passwordHash, sessions: [] } }
    )
    await db.collection('passwordResets').deleteMany({ userId: reset.userId })

    return { ok: true }
})
