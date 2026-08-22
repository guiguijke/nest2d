/**
 * Nuxt sets `x-powered-by: Nuxt` on the Node response after request
 * middleware, so routeRules / 0_security_headers cannot clear it.
 * Strip it at the last Nitro hooks (pentest M-1).
 *
 * Relative imports only — Nitro plugins boot on the Windows host (piège #36b).
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('beforeResponse', (event) => {
        try {
            event.node?.res?.removeHeader?.('x-powered-by')
        } catch {
            /* headers already sent */
        }
    })
    nitroApp.hooks.hook('render:response', (response) => {
        if (!response?.headers) return
        delete response.headers['x-powered-by']
        delete response.headers['X-Powered-By']
    })
})
