import { schemaWebSite } from './app/utils/schema'
import { fileURLToPath } from 'node:url'

// Sass requires forward-slash paths in @import, even on Windows.
const scssDir = fileURLToPath(new URL('./app/assets/scss/', import.meta.url)).replace(/\\/g, '/')

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
        resendToken: '',
        resendFrom: 'onboarding@resend.dev',
        encryptionMasterKey: '',
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
            title: 'APlasma Nesting - Smart Nesting for Laser Cutting and CNC machining',
            meta: [
                { charset: 'utf-8' },
                {
                    name: 'viewport',
                    content: 'width=device-width, initial-scale=1'
                },
                {
                    hid: 'description',
                    name: 'description',
                    content: 'The service for nesting DXF files. APlasma Nesting optimizes your material usage. Inspired by Nest2D, fully open-source and built for efficiency.'
                },
                {
                    hid: 'keywords',
                    name: 'keywords',
                    content: 'Nest DXF online, DXF files, material dimensions, APlasma Nesting, maximize material usage, open-source, efficiency, smart nesting, laser cutting'
                },
                {
                    hid: 'robots',
                    name: 'robots',
                    content: 'index, follow'
                },
                {
                    hid: 'author',
                    name: 'author',
                    content: 'APlasma Nesting'
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

    nitro: {
        compressPublicAssets: true,
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
            '/_nuxt/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable'
                }
            },
            '/**': {
                headers: {
                    'cache-control': 'public,max-age=0,s-maxage=86400,stale-while-revalidate'
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
