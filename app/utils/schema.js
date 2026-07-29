/**
 * Builds the JSON-LD WebSite structured-data schema using the configured
 * public base URL. Resolved at runtime so the canonical URL follows the
 * deployment (homelab domain, localhost, etc.) instead of a hardcoded value.
 */
export function useSchemaWebSite() {
    const config = useRuntimeConfig()
    const baseUrl = (config.public.baseUrl || 'http://localhost:3000').replace(/\/$/, '')
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: `${baseUrl}/`,
        name: 'NestorCut',
        description: 'True-shape 2D nesting with a research-grade engine. Upload your DXF files, set your sheet, and get a cut-ready optimized layout in seconds.',
        publisher: {
            '@type': 'Organization',
            'name': 'NestorCut'
        }
    }
}

/**
 * Static schema kept for the nuxt.config.js build-time ld+json script tag.
 * Uses the env var if available, otherwise falls back to localhost.
 */
const baseUrl = (process.env.NUXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
export const schemaWebSite = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: `${baseUrl}/`,
    name: 'NestorCut',
    description: 'True-shape 2D nesting with a research-grade engine. Upload your DXF files, set your sheet, and get a cut-ready optimized layout in seconds.',
    publisher: {
        '@type': 'Organization',
        'name': 'NestorCut'
    }
}
