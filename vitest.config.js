import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for the Nuxt server code (server/**) and the pure app logic
// behind the local (browser) compute path (app/tests/**). The app has no
// browser test harness — this config only resolves the `~~`/`~` Nuxt aliases
// so modules import cleanly outside of Nitro.
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            '~~': root,
            '~': root,
        },
    },
    test: {
        include: ['server/tests/**/*.test.js', 'app/tests/**/*.test.js'],
        environment: 'node',
    },
})
