import bcrypt from 'bcryptjs'
import { connectDB } from '~~/server/db/mongo'
import { generateSession } from '~~/server/utils/auth'
import { setSessionCookie } from '~~/server/utils/user'
import { sendWelcomeMessage } from '~~/server/features/support/welcomemessage'
import { notifyAdminNewUser } from '~~/server/features/notification/adminNotify'
import { COUNTRY_HEADER_NAME } from '~~/server/tracking/const'
import logger from '~~/server/utils/logger'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    if (config.public.localAuthEnabled === false || config.public.localAuthEnabled === 'false') {
        throw createError({ statusCode: 403, statusMessage: 'Local authentication is disabled' })
    }

    const body = await readBody(event)
    const email = String(body?.email || '').trim().toLowerCase()
    const name = String(body?.name || '').trim()
    const password = String(body?.password || '')

    if (!EMAIL_RE.test(email)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
    }
    if (!name || name.length < 1 || name.length > 80) {
        throw createError({ statusCode: 400, statusMessage: 'Name is required' })
    }
    if (password.length < 8) {
        throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
    }

    const db = await connectDB()
    const userId = `local:${email}`

    const existing = await db.collection('users').findOne({ id: userId })
    if (existing) {
        throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const session = generateSession()

    await db.collection('users').insertOne({
        id: userId,
        provider: 'local',
        email,
        name,
        // No avatar file; /api/user/avatar returns a generated placeholder.
        avatarFileName: null,
        avatarUrl: null,
        passwordHash,
        sessions: [session],
        createdAt: new Date(),
        balance: 30,
        isStripFeatureEnable: true,
        freeNestingUsed: 0,
        // Geo + provenance, captured at signup for the admin panel. Country
        // comes from Cloudflare's cf-ipcountry header (null without it).
        signupCountry: (event.node.req.headers[COUNTRY_HEADER_NAME] || null),
        signupIp:
            event.node.req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
            event.node.req.socket?.remoteAddress ||
            null,
    })

    try {
        await sendWelcomeMessage(userId)
    } catch (err) {
        logger.warn('Error sending welcome message', err)
    }

    // Best-effort admin notification (never blocks registration).
    notifyAdminNewUser(event, { id: userId, email, name, provider: 'local' }).catch((err) => {
        logger.warn('Error notifying admin of new signup', err)
    })

    setSessionCookie(event, session)
    return { ok: true }
})
