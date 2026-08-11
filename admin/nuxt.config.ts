// Nuxt config for the NestorCut administration panel.
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
    // IMPORTANT: Nuxt maps NUXT_* env vars to runtimeConfig keys by camelCasing
    // the suffix of an EXACT key match. So NUXT_ADMIN_MONGO_URI -> runtimeConfig.
    // adminMongoUri. The key names below are chosen to match the env vars used
    // in docker-compose.yml. Keep defaults empty/neutral so nothing sensitive is
    // baked into the image.
    // Mongo URI of the MAIN app (shared DB). NUXT_ADMIN_MONGO_URI.
    adminMongoUri: '',
    adminSessionSecret: '',
    adminNotifyEmail: '',
    adminBaseUrl: 'http://localhost:7200',
    // NUXT_PUBLIC_BASE_URL -> public.appBaseUrl (Nuxt camelCases public.* too,
    // NUXT_PUBLIC_BASE_URL matches the public.appBaseUrl key).
    appBaseUrl: 'http://localhost:3000',
    // NUXT_ADMIN_LAN_OPEN=true -> runtimeConfig.adminLanOpen.
    adminLanOpen: false,
    // NUXT_RESEND_TOKEN / NUXT_STRIPE_SECRET_KEY map directly (exact key match).
    resendToken: '',
    resendFrom: 'onboarding@resend.dev',
    stripeSecretKey: '',
    // listmonk (self-hosted newsletter): NUXT_ADMIN_LISTMONK_* takes
    // precedence, with fallback on the main app's NUXT_LISTMONK_* so a single
    // .env (env_file in docker-compose) covers both apps.
    listmonkUrl: process.env.NUXT_ADMIN_LISTMONK_URL || process.env.NUXT_LISTMONK_URL || '',
    listmonkUser: process.env.NUXT_ADMIN_LISTMONK_USER || process.env.NUXT_LISTMONK_USER || '',
    listmonkPassword: process.env.NUXT_ADMIN_LISTMONK_PASSWORD || process.env.NUXT_LISTMONK_PASSWORD || '',
    public: {
      appBaseUrl: 'http://localhost:3000',
      // Mirrored for the client-side guard.
      adminLanOpen: false,
    },
  },

  modules: ['@nuxtjs/tailwindcss'],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'NestorCut — Administration',
      htmlAttrs: { lang: 'fr' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // The admin panel must NEVER be indexed.
        { name: 'robots', content: 'noindex, nofollow, noarchive' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
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
