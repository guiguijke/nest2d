/**
 * Centralized site-wide contact and branding config.
 *
 * Override at runtime via env vars:
 *   NUXT_PUBLIC_SUPPORT_EMAIL  — contact/refund/support email
 *   NUXT_PUBLIC_GITHUB_REPO    — full GitHub URL of your fork
 *   NUXT_PUBLIC_DISCORD_URL    — Discord invite URL (footer link hidden if empty)
 *   NUXT_PUBLIC_COPYRIGHT_YEAR — year shown in the footer (defaults to current year)
 *
 * These values are read client-side via useRuntimeConfig() so they can be
 * configured per-deployment without code changes.
 */
export function useSiteConfig() {
    const config = useRuntimeConfig().public
    return {
        siteName: 'NestorCut',
        supportEmail: config.supportEmail || 'support@example.com',
        githubRepo: config.githubRepo || 'https://github.com/guiguijke/nestorcut',
        githubIssues: (config.githubRepo || 'https://github.com/guiguijke/nestorcut') + '/issues/new',
        discordUrl: config.discordUrl || 'https://discord.gg/VW4EM8wNDW',
        copyrightYear: config.copyrightYear || String(new Date().getFullYear()),
        // Legal entity (France) — used by the legal pages (mentions légales, CGU, privacy).
        legal: {
            entityName: 'Guillaume Jerke EI',
            tradeName: 'APlasma',
            siren: '942 877 028',
            address: 'Saint Martin Lalande, 11400, France',
            phone: '+33 6 31 75 23 39',
            vatNote: 'TVA non applicable, art. 293 B du CGI',
            // Product branding: "NestorCut by APlasma"
            brandLine: 'NestorCut by APlasma',
        },
    }
}
