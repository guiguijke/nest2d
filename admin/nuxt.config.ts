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
    // IMPORTANT: values here are BUILD-time defaults. Real values are injected
    // at RUNTIME from NUXT_* env vars (Nuxt maps NUXT_<KEY> to runtimeConfig.<key>
    // automatically, camelCasing NUXT_ADMIN_MONGO_URI -> adminMongoUri... except
    // it matches keys exactly, so we name keys to match the env var suffix).
    // Keep defaults empty/neutral so nothing sensitive is baked into the image.
    mongoUri: '',
    sessionSecret: '',
    notifyEmail: '',
    adminBaseUrl: 'http://localhost:7200',
    appBaseUrl: 'http://localhost:3000',
    // NUXT_ADMIN_LAN_OPEN=true -> runtimeConfig.adminLanOpen (camelCased by Nuxt).
    adminLanOpen: false,
    resendToken: '',
    resendFrom: 'onboarding@resend.dev',
    stripeSecretKey: '',
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
