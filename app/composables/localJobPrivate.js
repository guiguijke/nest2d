/**
 * PR5 (Mode Local productisé) : job local de bout en bout dont les RÉSULTATS
 * restent 100 % navigateur (IndexedDB) — le serveur ne reçoit QUE la
 * comptabilité (local-quota) ou le refund (local-fail). AUCUNE géométrie ne
 * sort (décision centrale J-077 ; test d'acceptation dans la PR).
 *
 * Flux : local-payload (entrante, ok) → solve worker moteur → exports+rapport
 * navigateur → saveLocalResult → POST local-quota (scalaires) OU local-fail
 * (échec = refund, jamais de quota consommé).
 */
import { runInWorker } from './localCompute'
import { saveLocalResult } from './localResultsStore'
import { buildArtifacts } from './localDownloads'

export async function runLocalJobPrivate(jobSlug, { projectSlug, sources = {} } = {}) {
    const payload = await $fetch(`/api/results/${jobSlug}/local-payload`)
    const outcome = await runInWorker(jobSlug, payload)

    if (!outcome.ok) {
        // Échec (engine, memory_cap, crash) = refund, pas de quota consommé.
        await $fetch(`/api/results/${jobSlug}/local-fail`, {
            method: 'POST',
            body: { error: outcome.error === 'memory_cap' ? 'memory_cap' : String(outcome.error) },
        })
        return { ok: false, error: outcome.error, memory: outcome.memory }
    }

    const result = outcome.result
    // Artefacts calculés navigateur (SVG/rapport/DXF) + stockage local.
    let artifacts = null
    try {
        artifacts = await buildArtifacts(result, sources)
    } catch {
        artifacts = null
    }
    try {
        await saveLocalResult({
            slug: jobSlug,
            projectSlug: projectSlug || null,
            createdAt: Date.now(),
            alternatives: result.alternatives,
            artifacts,
            meta: { memory: outcome.memory },
        })
    } catch {
        // IndexedDB indisponible (navigation privée) : le résultat reste
        // affichable pour la session ; on continue (comptabilité d'abord).
    }

    // Comptabilité seule — scalaires bornés côté serveur, zéro géométrie.
    const best = result.alternatives?.[0] || {}
    const placed = best.layouts?.reduce((n, l) => n + (l.placed_items?.length || 0), 0) ?? 0
    await $fetch(`/api/results/${jobSlug}/local-quota`, {
        method: 'POST',
        body: {
            placed,
            layoutCount: best.layoutCount ?? best.layouts?.length ?? 0,
            density: best.density ?? null,
        },
    })
    return { ok: true }
}
