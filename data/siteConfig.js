/**
 * Centralized site-wide contact and branding config.
 *
 * Override at runtime via env vars:
 *   NUXT_PUBLIC_SUPPORT_EMAIL  — contact/refund/support email
 *   NUXT_PUBLIC_GITHUB_REPO    — full GitHub URL of your fork
 *   NUXT_PUBLIC_COPYRIGHT_YEAR — year shown in the footer (defaults to current year)
 *
 * These values are read client-side via useRuntimeConfig() so they can be
 * configured per-deployment without code changes.
 */
export function useSiteConfig() {
    const config = useRuntimeConfig().public
    return {
        supportEmail: config.supportEmail || 'support@example.com',
        githubRepo: config.githubRepo || 'https://github.com/guiguijke/nest2d',
        githubIssues: (config.githubRepo || 'https://github.com/guiguijke/nest2d') + '/issues/new',
        copyrightYear: config.copyrightYear || String(new Date().getFullYear()),
    }
}
