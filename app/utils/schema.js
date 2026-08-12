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
