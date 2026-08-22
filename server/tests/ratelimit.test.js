import { describe, expect, it } from 'vitest'
import './helpers/h3Shims'
import { clientIp, rateLimitAllow, denyRateLimit } from '~~/server/utils/ratelimit'

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
})
