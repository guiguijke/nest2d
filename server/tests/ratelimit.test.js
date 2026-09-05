import { describe, expect, it } from 'vitest'
import './helpers/h3Shims'
import { clientIp, rateLimitAllow, rateLimitPeek, rateLimitReset, denyRateLimit } from '~~/server/utils/ratelimit'

function ev(headers = {}) {
    return { node: { req: { headers, socket: { remoteAddress: '10.0.0.9' } } } }
}

describe('clientIp (pentest H-3)', () => {
    it('prefers CF-Connecting-IP over a spoofed X-Forwarded-For', () => {
        expect(clientIp(ev({
            'cf-connecting-ip': '203.0.113.10',
            'x-forwarded-for': '1.2.3.4, 203.0.113.10',
        }))).toBe('203.0.113.10')
    })

    it('uses the LAST X-Forwarded-For hop when CF is absent', () => {
        expect(clientIp(ev({
            'x-forwarded-for': '1.2.3.4, 10.0.0.1, 198.51.100.7',
        }))).toBe('198.51.100.7')
    })

    it('does not take the first spoofed hop', () => {
        expect(clientIp(ev({
            'x-forwarded-for': '8.8.8.8',
        }))).toBe('8.8.8.8')
    })
})

describe('rateLimitAllow', () => {
    it('allows up to the limit then rejects', () => {
        const key = `t-${Date.now()}-${Math.random()}`
        expect(rateLimitAllow(key, { limit: 2, windowMs: 60_000 })).toBe(true)
        expect(rateLimitAllow(key, { limit: 2, windowMs: 60_000 })).toBe(true)
        expect(rateLimitAllow(key, { limit: 2, windowMs: 60_000 })).toBe(false)
    })
})

describe('rateLimitPeek / rateLimitReset (A2 — échecs seulement)', () => {
    it('peek ne consomme pas : N peeks autorisés puis refus après N échecs réels', () => {
        const key = `peek-${Date.now()}-${Math.random()}`
        for (let i = 0; i < 5; i++) {
            expect(rateLimitPeek(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(true)
        }
        // toujours allowed : rien n'a été consommé
        expect(rateLimitPeek(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(true)
        // 5 échecs réels consomment le quota
        for (let i = 0; i < 5; i++) {
            rateLimitAllow(key, { limit: 5, windowMs: 60_000 })
        }
        const blocked = rateLimitPeek(key, { limit: 5, windowMs: 60_000 })
        expect(blocked.allowed).toBe(false)
        expect(blocked.retryAfterMs).toBeGreaterThan(0)
    })

    it('reset permet de repartir de zéro (connexion réussie)', () => {
        const key = `reset-${Date.now()}-${Math.random()}`
        for (let i = 0; i < 5; i++) {
            rateLimitAllow(key, { limit: 5, windowMs: 60_000 })
        }
        expect(rateLimitPeek(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(false)
        rateLimitReset(key)
        expect(rateLimitPeek(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(true)
    })
})

describe('denyRateLimit', () => {
    it('sets Retry-After and throws 429', () => {
        const headers = {}
        globalThis.setHeader = (_event, name, value) => { headers[name] = value }
        let err
        try {
            denyRateLimit({}, { windowMs: 15_000 })
        } catch (e) {
            err = e
        }
        expect(err.statusCode).toBe(429)
        expect(headers['Retry-After']).toBe('15')
    })

    it('porte le code stable + délai réel pour le message traduit (A2)', () => {
        globalThis.setHeader = () => {}
        const key = `deny-${Date.now()}-${Math.random()}`
        for (let i = 0; i < 2; i++) {
            rateLimitAllow(key, { limit: 2, windowMs: 60_000 })
        }
        const peek = rateLimitPeek(key, { limit: 2, windowMs: 60_000 })
        let err
        try {
            denyRateLimit({}, { windowMs: 60_000, retryAfterMs: peek.retryAfterMs })
        } catch (e) {
            err = e
        }
        expect(err.statusCode).toBe(429)
        expect(err.data.code).toBe('rate_limited')
        expect(err.data.retryAfterSec).toBeGreaterThanOrEqual(1)
        expect(err.data.retryAfterSec).toBeLessThanOrEqual(60)
    })
})
