import { runPurgeOnce } from '../features/purge/sweep'
import logger from '../utils/logger'

/**
 * D-PRV-10 — sweeper purge 24 h : un run au boot (après 30 s, le temps que
 * Mongo soit prêt) puis toutes les 15 min. L'app tourne en une instance :
 * pas de verrou distribué, une simple garde in-flight suffit (si des
 * réplicas app arrivent un jour, ajouter un verrou atomique `purge_locks`
 * façon compute_pool). Kill switch : NUXT_PURGE_SWEEP_ENABLED=false.
 */
export default defineNitroPlugin(() => {
    if (process.env.NUXT_PURGE_SWEEP_ENABLED === 'false') {
        logger.info('purge sweeper disabled (NUXT_PURGE_SWEEP_ENABLED=false)')
        return
    }
    let inFlight = false
    const tick = async () => {
        if (inFlight) return
        inFlight = true
        try {
            await runPurgeOnce({})
        } catch (err) {
            // Un run raté ne doit jamais faire tomber l'app — on retentera
            // au prochain intervalle.
            logger.error('purge sweep failed:', err)
        } finally {
            inFlight = false
        }
    }
    // JAMAIS d'unref ici : en worker dev nitro, des timers unref'd laissent
    // la boucle d'événements se vider → « worker exited with code 0 ».
    setInterval(tick, 15 * 60 * 1000)
    setTimeout(tick, 30 * 1000) // laisse le boot se terminer
})
