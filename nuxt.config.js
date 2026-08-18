import { schemaWebSite } from './app/utils/schema'
import { fileURLToPath } from 'node:url'

// Sass requires forward-slash paths in @import, even on Windows.
const scssDir = fileURLToPath(new URL('./app/assets/scss/', import.meta.url)).replace(/\\/g, '/')
// Absolute path: nitro resolves serverAssets.dir against its own srcDir
// (<root>/server), so a relative './server/...' would point nowhere.
const demoSeedDir = fileURLToPath(new URL('./server/seed/demo', import.meta.url))
// Windows host: Nitro rewrites `~~/shared` to too many `../` and lands in
// the user home (`C:\Users\…\shared\…`). Pin the alias to the repo folder.
const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))

export default defineNuxtConfig({
    compatibilityDate: "2025-07-15",
    devtools: { enabled: true },
    future: {
        compatibilityVersion: 4,
    },
    typescript: {
        strict: false,
        typeCheck: false
    },
    runtimeConfig: {
        mongoUri: '',
        stripeSecretKey: '',
        // Signing secret for the Stripe webhook endpoint (whsec_...). Set via
        // NUXT_STRIPE_WEBHOOK_SECRET. Empty string disables signature checks
        // (webhook then returns 503 — we refuse to run unauthenticated).
        stripeWebhookSecret: '',
        // Clé API Abby (suk_...) pour pousser les encaissements Stripe dans le
        // livre des recettes (webhook invoice.payment_succeeded →
        // features/accounting/abby.js). Vide = intégration désactivée.
        abbyApiKey: '',
        resendToken: '',
        resendFrom: 'onboarding@resend.dev',
        // Self-hosted listmonk newsletter (optional — signup checkbox is a
        // no-op until these are set). API user created in listmonk Settings.
        listmonkUrl: '',
        listmonkUser: '',
        listmonkPassword: '',
        listmonkListId: '',
        apiToken: '',
        googleClientSecret: '',
        blockedCountries: '',
        // Destination for admin notifications (new signups). Optional; when
        // unset the admin panel's periodic digest still catches new signups.
        adminNotifyEmail: '',
        public: {
            baseUrl: "http://localhost:3000",
            gitCommitSha: "",
            googleClientId: "",
            clarityId: "",
            localAuthEnabled: true,
            supportEmail: "",
            githubRepo: "",
            copyrightYear: "",
            // Temporarily hides the paid-plan CTAs (Unlimited trial + Pro
            // upgrade). Set NUXT_PUBLIC_PAID_PLANS_DISABLED=false to restore.
            paidPlansDisabled: false,
            // Global kill-switch for the strip nesting feature (tab, /strip
            // pages and API). Disabled by default while the feature is being
            // reworked; set NUXT_PUBLIC_STRIP_ENABLED=true to re-enable.
            stripEnabled: false,
            // Master switch for imperial units (inches): shows the unit
            // switcher and honors users.preferredUnit. Ships dark; set
            // NUXT_PUBLIC_UNIT_SWITCH_ENABLED=true to enable.
            unitSwitchEnabled: false,
            // Phase 2 (internal QA, NOT a privacy feature yet): routes
            // eligible nestings to the browser WASM engine. DXF/SVG parsing
            // stays server-side — "local" = local SOLVE on server-parsed
            // geometry, no privacy claim, no public UI mention. Ships dark;
            // set NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true to enable.
            localComputeEnabled: false,
            // J-090 (import 100 % client) : projets « 100 % privés » dont les
            // fichiers sont parsés dans le navigateur et ne quittent JAMAIS
            // la machine (IndexedDB). Exige localComputeEnabled. Ships dark ;
            // NUXT_PUBLIC_LOCAL_IMPORT_ENABLED=true pour activer.
            localImportEnabled: false,
            // Chantier B (turbo hybride client+serveur, J-093 suite) : bouton
            // Turbo (boîte + interrupteur + notice). DEV/staging seulement
            // tant que la course n'est pas codée — la préférence enregistrée
            // est réservée aux payants côté serveur (P3).
            // NUXT_PUBLIC_TURBO_ENABLED=true pour activer.
            turboEnabled: false,
        },
    },

    css: [
        '@/assets/css/main.css',
    ],

    plugins: [
        '@/plugins/theme.js'
    ],

    vite: {
        css: {
            preprocessorOptions: {
                scss: {
                    // Use Dart Sass' modern compiler API. Removes the
                    // "Sass is currently using the legacy JS API" deprecation.
                    api: 'modern-compiler',
                    // The design system still relies on global @import of
                    // variables/mixins/fonts via additionalData. Migrating to
                    // @use/@forward is a larger refactor; silence the
                    // deprecation in the meantime.
                    silenceDeprecations: ['legacy-js-api', 'import'],
                    additionalData: `
                        @import "${scssDir}variables.scss";
                        @import "${scssDir}mixins.scss";
                        @import "${scssDir}fonts.scss";
                        @import "${scssDir}global.scss";
                    `
                }
            }
        },
        build: {
            minify: 'terser',
            chunkSizeWarningLimit: 1000,
        }
    },

    app: {
        head: {
            title: 'NestorCut — State-of-the-art nesting for laser, plasma & CNC cutting',
            meta: [
                { charset: 'utf-8' },
                {
                    name: 'viewport',
                    content: 'width=device-width, initial-scale=1'
                },
                {
                    hid: 'description',
                    name: 'description',
                    content: 'True-shape 2D nesting with a research-grade engine. Upload your DXF files, set your sheet, and get a cut-ready optimized layout in seconds. 10 free nestings every month.'
                },
                {
                    hid: 'keywords',
                    name: 'keywords',
                    content: 'nesting software, nest DXF online, true-shape nesting, laser cutting nesting, plasma cutting, CNC nesting, sheet metal optimization, reduce material waste, NestorCut'
                },
                {
                    hid: 'robots',
                    name: 'robots',
                    // The app subdomain is a product surface, not a marketing
                    // one — nestorcut.com owns SEO, so keep app.* out of the
                    // index while still letting crawlers follow links.
                    content: 'noindex, follow'
                },
                {
                    hid: 'author',
                    name: 'author',
                    content: 'NestorCut'
                }
            ],
            link: [
                {
                    rel: 'apple-touch-icon',
                    sizes: '180x180',
                    href: '/favicon/apple-touch-icon.png'
                },
                {
                    rel: 'icon',
                    type: 'image/png',
                    sizes: '32x32',
                    href: '/favicon/favicon-32x32.png'
                },
                {
                    rel: 'icon',
                    type: 'image/png',
                    sizes: '16x16',
                    href: '/favicon/favicon-16x16.png'
                },
                {
                    rel: 'icon',
                    type: 'image/x-icon',
                    href: '/favicon/favicon.ico'
                }
            ],
            script: [
                {
                    async: true,
                    type: 'application/ld+json',
                    children: JSON.stringify(schemaWebSite)
                },
                // Microsoft Clarity analytics — only injected when NUXT_PUBLIC_CLARITY_ID is set.
                ...(process.env.NUXT_PUBLIC_CLARITY_ID ? [{
                    children: `
                        (function(c,l,a,r,i,t,y){
                            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                        })(window, document, "clarity", "script", "${process.env.NUXT_PUBLIC_CLARITY_ID}");
                    `,
                    type: 'text/javascript'
                }] : [])
            ]
        }
    },

    alias: {
        '#shared': sharedDir,
    },
    nitro: {
        alias: {
            '#shared': sharedDir,
            '~~/shared': sharedDir,
        },
        // Dev Windows: keep shared/ inlined. Otherwise Nitro emits
        // `../../../../../../shared/...` from .nuxt/dev/index.mjs and
        // Node looks in the user home (piège #36).
        externals: {
            inline: [/[/\\]shared[/\\]constants[/\\]/],
        },
        compressPublicAssets: true,
        // Demo project assets (generated DXF + manifest, committed under
        // server/seed/demo): bundled into .output so the seed plugin works
        // in the production image (which only ships .output).
        serverAssets: [
            { baseName: 'demo-seed', dir: demoSeedDir },
        ],
        routeRules: {
            '/blog': { redirect: '/changelog' },
            '/icons/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,s-maxage=31536000,immutable'
                }
            },
            '/fonts/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,s-maxage=31536000,immutable'
                }
            },
            // Engine WASM artifact (Phase 2, flag-gated): regenerated in
            // place by workers/nesting/engine/build-wasm.sh — a short cache
            // lets updates through while avoiding a 900 KB refetch per visit.
            '/engine/**': {
                headers: {
                    'cache-control': 'public,max-age=3600,must-revalidate'
                }
            },
            '/_nuxt/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable'
                }
            },
            // HTML SSR : JAMAIS de s-maxage. Un cache partagé (reverse proxy)
            // garderait des pages périmées 24 h (ex. /plans affichant "Bientôt
            // disponible" après la synchro Stripe) et pourrait servir le HTML
            // d'une session connectée à un autre visiteur. no-cache = le
            // navigateur/proxy revalide à chaque fois, le SSR reste frais.
            '/**': {
                headers: {
                    'cache-control': 'no-cache'
                }
            }
        }
    },

    experimental: {
        payloadExtraction: true
    },

    build: {
        extractCSS: true,
    },
});
