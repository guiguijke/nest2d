import logger from '~~/server/utils/logger';
import { clientIp } from '~~/server/utils/ratelimit';

/**
 * Public contact endpoint for the nestorcut.com static site.
 *
 * The in-app support chat requires authentication, so prospects have no way
 * to reach us. This endpoint accepts a contact-form submission and forwards
 * it by email via Resend, with the visitor's address as reply-to.
 *
 * Abuse protection:
 *  - honeypot field ("website") — bots fill it, humans never see it
 *  - per-IP rate limit (in-memory, 5 messages/hour)
 *  - strict input validation and length caps
 * CORS is restricted to the marketing site origins (see contact.options.js).
 */

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const hits = new Map(); // ip -> timestamps[]

const ALLOWED_ORIGINS = [
    'https://nestorcut.com',
    'https://www.nestorcut.com',
    // Cloudflare Pages preview + local dev
    'https://nestorcut-website.pages.dev',
    'http://localhost:4321',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = { name: 120, email: 200, subject: 200, message: 5000 };

function setCors(event) {
    const origin = getRequestHeader(event, 'origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        setResponseHeader(event, 'Access-Control-Allow-Origin', origin);
        setResponseHeader(event, 'Vary', 'Origin');
    }
}

function isRateLimited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (list.length >= RATE_LIMIT_MAX) {
        hits.set(ip, list);
        return true;
    }
    list.push(now);
    hits.set(ip, list);
    return false;
}

export default defineEventHandler(async (event) => {
    setCors(event);

    const ip = clientIp(event);
    if (isRateLimited(ip)) {
        throw createError({ statusCode: 429, statusMessage: 'Too many messages, please try again later.' });
    }

    const body = await readBody(event);
    const name = String(body?.name ?? '').trim().slice(0, MAX.name);
    const email = String(body?.email ?? '').trim().slice(0, MAX.email);
    const subject = String(body?.subject ?? '').trim().slice(0, MAX.subject);
    const message = String(body?.message ?? '').trim().slice(0, MAX.message);
    const honeypot = String(body?.website ?? '').trim();

    // Honeypot filled → bot. Pretend success so it learns nothing.
    if (honeypot) {
        logger.warn(`Contact honeypot triggered by ${ip}`);
        return { ok: true };
    }

    if (!name || !EMAIL_RE.test(email) || message.length < 10) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid contact form payload.' });
    }

    const config = useRuntimeConfig();
    const recipient = config.public.supportEmail || 'support@example.com';
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const htmlBody = `
        <p><strong>New contact message from nestorcut.com</strong></p>
        <p><strong>Name:</strong> ${escape(name)}<br>
        <strong>Email:</strong> ${escape(email)}<br>
        <strong>Subject:</strong> ${escape(subject) || '—'}</p>
        <p><strong>Message:</strong></p>
        <p>${escape(message).replace(/\n/g, '<br>')}</p>
    `;

    try {
        await $fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.resendToken}`,
            },
            body: {
                from: config.resendFrom || 'onboarding@resend.dev',
                to: recipient,
                reply_to: email,
                subject: `[NestorCut contact] ${subject || `Message from ${name}`}`,
                html: htmlBody,
            },
        });
        logger.info(`Contact message forwarded from ${email}`);
    } catch (error) {
        logger.error('Failed to forward contact message:', error);
        throw createError({ statusCode: 502, statusMessage: 'Message could not be sent, please try again later.' });
    }

    return { ok: true };
});
