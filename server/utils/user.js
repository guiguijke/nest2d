import { connectDB } from '~~/server/db/mongo'
import { generateSession } from './auth'
import { sendWelcomeMessage } from '~~/server/features/support/welcomemessage'
import { notifyAdminNewUser } from '~~/server/features/notification/adminNotify'
import { COUNTRY_HEADER_NAME } from '~~/server/tracking/const'
import { downloadAndStoreAvatar } from './avatar'
import logger from './logger'
import { clientIp } from './ratelimit'

export async function createOrUpdateUser({ event, sessionId, providerId, email, name, avatarUrl }) {
    if (!providerId || !email || !name) {
        logger.error('Missing required user data', {
            providerId,
            email,
            name,
        })
        throw new Error('Missing required user data')
    }

    const session = generateSession()
    const db = await connectDB()

    const avatarKey = await downloadAndStoreAvatar(providerId, avatarUrl)

    // Geo + provenance captured at signup (admin panel). Only meaningful on
    // first insert; we pass them via $setOnInsert so they never overwrite a
    // real signup country on subsequent logins.
    const signupCountry = event ? event.node.req.headers[COUNTRY_HEADER_NAME] || null : null
    const signupIp = event ? clientIp(event) : null

    const updateData = {
        $set: {
            provider: 'google',
            email,
            name,
            avatarFileName: avatarKey,
        },
        $setOnInsert: {
            createdAt: new Date(),
            isStripFeatureEnable: true,
            freeNestingUsed: 0,
            // Measurement unit preference ('mm' | 'inch') — default metric.
            preferredUnit: 'mm',
            signupCountry,
            signupIp,
            // Google accounts are verified by Google itself — no email
            // verification step needed (unlike local signups).
            emailVerified: true,
        },
        $push: {
            sessions: session,
        },
    }

    const userId = `google:${providerId}`
    const isUserExists = await db.collection('users').findOne({ id: userId })

    // Banned accounts cannot authenticate via Google either.
    if (isUserExists?.banned) {
        throw new Error('This account has been suspended')
    }

    await db.collection('users').updateOne({ id: userId }, updateData, { upsert: true })

    if (!isUserExists) {
        try {
            await sendWelcomeMessage(userId)
        } catch (err) {
            logger.warn('Error sending welcome message', err)
        }
        // Best-effort admin notification for new Google signups.
        if (event) {
            notifyAdminNewUser(event, { id: userId, email, name, provider: 'google' }).catch((err) => {
                logger.warn('Error notifying admin of new signup', err)
            })
        }
    }

    await db
        .collection('tracking')
        .updateMany({ sessionKey: sessionId, userId: { $exists: false } }, { $set: { userId: userId } })

    return session
}

/**
 * Sets the session cookie in the response
 * @param {Object} event - The H3 event object
 * @param {Object} session - The session object containing sessionId and expiresAt
 */
export function setSessionCookie(event, session) {
    setCookie(event, 'sessionId', session.sessionId, {
        expires: new Date(session.expiresAt),
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    })
}
