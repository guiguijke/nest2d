// Nuxt config for the APlasma administration panel.
//
// This is a SEPARATE Nuxt app living in ./admin, sharing the same MongoDB as
// the main app but with its own auth (collection `admins`), its own server
// process and its own (private) port. It is NOT part of the public app.
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  future: { compatibilityVersion: 4 },

  ssr: true,
  devServer: { port: 7200, host: '0.0.0.0' },

  runtimeConfig: {
    // Server-only. The admin app reads from the SAME database as the main app.
    mongoUri: process.env.NUXT_ADMIN_MONGO_URI || process.env.NUXT_MONGO_URI || '',
    // Secret used to sign/derive admin session ids. Generate a random 64-char string.
    sessionSecret: process.env.NUXT_ADMIN_SESSION_SECRET || '',
    // Where admin notifications (new signups) are sent.
    notifyEmail: process.env.NUXT_ADMIN_NOTIFY_EMAIL || '',
    // Public base URL of this admin panel (used for links inside emails).
    adminBaseUrl: process.env.NUXT_ADMIN_BASE_URL || 'http://localhost:7200',
    // Public base URL of the MAIN app (used for deep links to user projects).
    appBaseUrl: process.env.NUXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    // Reused from the main app.
    resendToken: process.env.NUXT_RESEND_TOKEN || '',
    resendFrom: process.env.NUXT_RESEND_FROM || 'onboarding@resend.dev',
    stripeSecretKey: process.env.NUXT_STRIPE_SECRET_KEY || '',
    public: {
      appBaseUrl: process.env.NUXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    },
  },

  modules: ['@nuxtjs/tailwindcss'],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'APlasma — Administration',
      htmlAttrs: { lang: 'fr' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // The admin panel must NEVER be indexed.
        { name: 'robots', content: 'noindex, nofollow, noarchive' },
      ],
    },
  },

  nitro: {
    compressPublicAssets: true,
  },

  typescript: {
    strict: false,
    typeCheck: false,
  },
})
