import { connectDB } from '../db/mongo'
import logger from '../utils/logger'

/**
 * D-PRV-7 boot migration (one-shot, idempotent — no timers):
 *
 *  a) NUXT_ENCRYPTION_MASTER_KEY no longer has any role: vault sessions are
 *     process-local RAM only and the master-key wrap is gone. Warn when the
 *     variable is still set so operators can drop it from the environment.
 *  b) Drop the legacy `session_keys` collection (wrapped-DEK cache) so no
 *     stale wrapped DEKs survive in the database. Idempotent: a missing
 *     collection (Mongo code 26, NamespaceNotFound) is a no-op.
 *
 * NOTE: startup plugins do not resolve the `~~/` alias in dev — relative
 * imports only.
 */
export default defineNitroPlugin(async () => {
    if (process.env.NUXT_ENCRYPTION_MASTER_KEY) {
        console.warn(
            '[vault] NUXT_ENCRYPTION_MASTER_KEY is deprecated (D-PRV-7): vault sessions are ' +
                'process-local RAM now and the master-key wrap is gone — the variable can be ' +
                'removed from the environment.'
        )
    }

    const db = await connectDB()
    try {
        await db.dropCollection('session_keys')
        logger.info('[vault] dropped legacy session_keys collection (D-PRV-7)')
    } catch (err) {
        // NamespaceNotFound = already dropped (or never existed) — idempotent.
        if (err?.code === 26 || /ns not found|namespace not found/i.test(String(err?.message))) {
            return
        }
        throw err
    }
})
