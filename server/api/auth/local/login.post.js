import bcrypt from 'bcryptjs'
import { connectDB } from '~~/server/db/mongo'
import { generateSession } from '~~/server/utils/auth'
import { setSessionCookie } from '~~/server/utils/user'
import {
    assertRateLimit,
    denyRateLimit,
    rateLimitAllow,
    rateLimitPeek,
    rateLimitReset,
} from '~~/server/utils/ratelimit'

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    if (config.public.localAuthEnabled === false || config.public.localAuthEnabled === 'false') {
        throw createError({ statusCode: 403, statusMessage: 'Local authentication is disabled' })
    }

    const body = await readBody(event)
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '')

    if (!email || !password) {
        throw createError({ statusCode: 400, statusMessage: 'Email and password are required' })
    }

    assertRateLimit(event, 'login-ip', { limit: 20, windowMs: 15 * 60_000 })
    // A2 (audit compte 2026-09-05) : le compteur par e-mail ne compte QUE
    // les ÉCHECS — l'ancien compteur d'appels bloquait un utilisateur
    // légitime à trois appareils (5 connexions / 15 min), et une connexion
    // réussie REMET le compteur à zéro. Peek sans consommer, incrément
    // uniquement sur mot de passe invalide.
    const failKey = `login-email:${email}`
    const failLimit = { limit: 5, windowMs: 15 * 60_000 }
    const peek = rateLimitPeek(failKey, failLimit)
    if (!peek.allowed) {
        denyRateLimit(event, { windowMs: failLimit.windowMs, retryAfterMs: peek.retryAfterMs })
    }

    const db = await connectDB()
    const userId = `local:${email}`
    const user = await db.collection('users').findOne({ id: userId })

    // Compare in constant-ish time regardless of existence to limit user enumeration.
    const dummyHash = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0vW3q3aQ3vP3p3p3p3p3p3p3p3p3'
    const hash = user?.passwordHash || dummyHash
    const ok = await bcrypt.compare(password, hash)

    if (!user || !ok) {
        // A2 : c'est un ÉCHEC — lui seul consomme le quota.
        rateLimitAllow(failKey, failLimit)
        throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
    }
    // A2 : succès — remise à zéro du compteur d'échecs.
    rateLimitReset(failKey)

    // Banned accounts cannot log in (ban is set from the admin panel).
    if (user.banned) {
        throw createError({ statusCode: 403, statusMessage: 'This account has been suspended' })
    }

    const session = generateSession()
    await db.collection('users').updateOne(
        { id: userId },
        {
            $set: { lastActiveAt: new Date() },
            $push: { sessions: session },
        }
    )

    setSessionCookie(event, session)
    return { ok: true }
})
