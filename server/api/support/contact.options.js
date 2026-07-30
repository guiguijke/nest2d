/**
 * CORS preflight for the public contact endpoint (see contact.post.js).
 */

const ALLOWED_ORIGINS = [
    'https://nestorcut.com',
    'https://www.nestorcut.com',
    'https://nestorcut-website.pages.dev',
    'http://localhost:4321',
];

export default defineEventHandler((event) => {
    const origin = getRequestHeader(event, 'origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        setResponseHeader(event, 'Access-Control-Allow-Origin', origin);
        setResponseHeader(event, 'Vary', 'Origin');
    }
    setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');
    setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type');
    setResponseHeader(event, 'Access-Control-Max-Age', '86400');
    setResponseStatus(event, 204);
    return null;
});
