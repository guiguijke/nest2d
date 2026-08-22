/**
 * Baseline security headers on every response (pentest M-1).
 *
 * CSP is deliberately loose on script-src ('unsafe-inline' + wasm-unsafe-eval):
 * Nuxt hydrates with inline scripts and the local nesting engine is WASM.
 * frame-ancestors / object-src / base-uri are the high-value bits.
 */
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.clarity.ms https://scripts.clarity.ms",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // blob: : dxf-viewer fetch() les DXF locaux (IndexedDB → createObjectURL).
    // Sans ça Firefox lève « NetworkError when attempting to fetch resource »
    // alors que l'aperçu SVG (img-src data:) continue de marcher.
    "connect-src 'self' blob: https://www.clarity.ms https://*.clarity.ms https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://api.stripe.com",
    "worker-src 'self' blob:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://checkout.stripe.com",
].join('; ')

export default defineEventHandler((event) => {
    const proto = String(event.node?.req?.headers?.['x-forwarded-proto'] || '')
    if (proto === 'https') {
        setHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
    setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
    setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    setHeader(event, 'Content-Security-Policy', CSP)
    removeResponseHeader(event, 'x-powered-by')
})
