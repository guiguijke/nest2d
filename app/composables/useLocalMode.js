/**
 * PR5 (Phase 2/3/4) : état du mode de calcul côté UI.
 *  - `mode` / `canToggle` / `reason` depuis /api/local-mode (source de vérité
 *    serveur, J-078) ;
 *  - erreurs propres i18n (entityLimit / memory / crash → propose serveur) ;
 *  - progression + temps écoulé (budget navigateur 10–15 s, J-079).
 * Tout est inerte si le flag est OFF (isLocalComputeEnabled false).
 */
import { isLocalComputeEnabled } from './localCompute'
import { useLocale } from './useLocale'

export function useLocalMode(projectSlug) {
    const { t } = useLocale()
    const state = useState(`localmode-${projectSlug}`, () => ({
        mode: 'server',
        canToggle: false,
        reason: 'choice',
        loaded: false,
    }))
    const error = useState(`localmode-err-${projectSlug}`, () => null)
    const startedAt = useState(`localmode-t0-${projectSlug}`, () => null)
    const elapsed = ref(0)
    let timer = null

    async function load(choice) {
        if (!isLocalComputeEnabled()) return
        try {
            const q = projectSlug ? `?project=${projectSlug}` : ''
            state.value = { ...(await $fetch(`/api/local-mode${q}`)), loaded: true }
        } catch {
            state.value = { mode: 'server', canToggle: false, reason: 'choice', loaded: true }
        }
    }

    function setMode(m) {
        if (state.value.canToggle) state.value.mode = m
    }

    // Traduit un échec local en message i18n proposant le mode serveur.
    // `localOnly` (AF6, L3-bis) : un projet « cet appareil » n'a AUCUNE
    // géométrie côté serveur — les conseils « réessayez en mode serveur »
    // sont impossibles à suivre : variantes dédiées.
    function mapError(err, { localOnly = false } = {}) {
        if (err === 'memory_cap') {
            return localOnly ? t('localMode.memoryLocal') : t('localMode.memorySuggest')
        }
        if (err === 'entity_limit') {
            return localOnly ? t('localMode.entityLimitLocal') : t('localMode.entityLimit')
        }
        // J-090 : géométrie d'un projet local absente de CE navigateur.
        if (err === 'geometry_missing') return t('localImport.missingGeometry')
        if (err === 'crash') {
            return localOnly ? t('localMode.crashLocal') : t('localMode.crashError')
        }
        // V8 (vérif 2026-09-04) : toutes les alternatives rejetées par la
        // garde physique (chevauchement/doublons mesurés) — job refundé.
        if (err === 'all_alternatives_invalid') {
            return localOnly ? t('localMode.allInvalidLocal') : t('localMode.allInvalid')
        }
        // Plan 2026-09-05 §1.2a : refus de capacité (aire gonflée par
        // l'espacement) — phrase actionnable avec les leviers.
        if (err === 'capacity_exceeded') return t('localMode.capacityExceeded')
        return t('localCompute.error')
    }

    function startTimer() {
        startedAt.value = Date.now()
        elapsed.value = 0
        stopTimer()
        timer = setInterval(() => {
            elapsed.value = Math.round((Date.now() - startedAt.value) / 100) / 10
        }, 100)
    }
    function stopTimer() {
        if (timer) clearInterval(timer)
        timer = null
    }

    // Budget navigateur explicite (reco spike 10–15 s) — borne affichée.
    const BROWSER_BUDGET_SEC = 15

    onBeforeUnmount(stopTimer)

    return {
        state, error, elapsed,
        BROWSER_BUDGET_SEC,
        load, setMode, mapError, startTimer, stopTimer,
        enabled: isLocalComputeEnabled,
    }
}
