import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Admin session management.
//
// Sessions live INSIDE the admin document (same pattern as the main app's
// users.sessions array). The sessionId sent in the cookie is a 32-byte random
// token; we store its SHA-256 hash so a DB leak never yields live sessions.
//
// Cookie name: `adminSessionId` — intentionally distinct from the main app's
// `sessionId` so the two never collide.

const SESSION_COOKIE = 'adminSessionId'
const SESSION_TTL_DAYS = 30

export function generateSession() {
  const token = randomBytes(32).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  return { token, tokenHash: hashToken(token), createdAt: now, expiresAt }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyToken(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function setAdminSessionCookie(event: any, token: string, expiresAt: Date) {
  setCookie(event, SESSION_COOKIE, token, {
    expires: expiresAt,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
}

export function clearAdminSessionCookie(event: any) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export function readAdminSessionToken(event: any): string | undefined {
  return getCookie(event, SESSION_COOKIE)
}
