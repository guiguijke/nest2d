import bcrypt from 'bcryptjs'
import { connectDB } from '~~/server/db/mongo'
import { generateSession } from '~~/server/utils/auth'
import { setSessionCookie } from '~~/server/utils/user'
import {
    clientIp,
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

    // A2 (audit compte 2026-09-05) : les compteurs login ne comptent QUE
    // les ÉCHECS — l'ancien compteur d'appels bloquait un utilisateur
    // légitime à trois appareils (5 connexions / 15 min), et une connexion
    // réussie REMET les compteurs à zéro. Peek sans consommer, incrément
    // uniquement sur mot de passe invalide.
    // AA6 (vérif L1 2026-09-05) : le compteur IP suit la même mécanique
    // (50 échecs / 15 min) — un atelier derrière un NAT ne se bloque plus
    // par ses connexions RÉUSSIES.
    const failLimits = {
        email: { limit: 5, windowMs: 15 * 60_000 },
        ip: { limit: 50, windowMs: 15 * 60_000 },
    }
    const failKeys = {
        email: `login-email:${email}`,
        ip: `login-ip:${clientIp(event)}`,
    }
    for (const scope of ['ip', 'email']) {
        const peek = rateLimitPeek(failKeys[scope], failLimits[scope])
        if (!peek.allowed) {
            denyRateLimit(event, { windowMs: failLimits[scope].windowMs, retryAfterMs: peek.retryAfterMs })
        }
    }

    const db = await connectDB()
    const userId = `local:${email}`
    const user = await db.collection('users').findOne({ id: userId })

    // Compare in constant-ish time regardless of existence to limit user enumeration.
    const dummyHash = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0vW3q3aQ3vP3p3p3p3p3p3p3p3p3'
    const hash = user?.passwordHash || dummyHash
    const ok = await bcrypt.compare(password, hash)

    if (!user || !ok) {
        // A2/AA6 : c'est un ÉCHEC — lui seul consomme les quotas.
        rateLimitAllow(failKeys.email, failLimits.email)
        rateLimitAllow(failKeys.ip, failLimits.ip)
        throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
    }
    // A2/AA6 : succès — remise à zéro des compteurs d'échecs.
    rateLimitReset(failKeys.email)
    rateLimitReset(failKeys.ip)

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
