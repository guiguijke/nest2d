/**
 * PR5 (Mode Local productisé, J-077/J-082) : job local de bout en bout dont
 * les RÉSULTATS restent 100 % navigateur (IndexedDB) — le serveur ne reçoit
 * QUE la comptabilité (local-quota) ou le refund (local-fail). AUCUNE
 * géométrie ne sort.
 *
 * Flux : local-payload (entrante, enrichie parts/outputUnit/addOutShape par
 * le worker) → bytes sources pré-fetchés (données d'entrée DU PROPRIÉTAIRE,
 * sens entrante — le claim J-077 porte sur le sortant) → solve worker moteur
 * → artefacts navigateur via localBridge (SVG coloré + rapport mesuré + DXF
 * combiné par tôle, parité avec la finalisation serveur) → saveLocalResult
 * (record riche : relecture + téléchargements hors-ligne) → POST local-quota
 * (scalaires) OU local-fail (échec = refund, jamais de quota consommé).
 */
import { runInWorker } from './localCompute'
import { saveLocalResult } from './localResultsStore'
import {
    buildAlternativeArtifacts,
    toServerShapeAlternatives,
    buildSheetDxf,
    normalizeLayouts,
    sheetDims,
} from './localBridge'

/** Bytes des fichiers sources (bucket validDxf, toujours DXF mm — piège #31),
 * un par slug distinct du payload. Best-effort : une source manquante
 * dégrade seulement le téléchargement DXF (SVG/rapport restent). */
async function fetchSources(payload) {
    const sources = {}
    const slugs = [...new Set((payload?.parts || []).map((p) => p.file_slug).filter(Boolean))]
    for (const slug of slugs) {
        try {
            const buf = await $fetch(`/api/files/project/dxf/${slug}`, { responseType: 'arrayBuffer' })
            sources[slug] = new Uint8Array(buf)
        } catch (e) {
            console.warn('local source fetch failed', slug, e)
        }
    }
    return sources
}

/** Frame finale synthétique pour la vue live (même forme que le reveal
 * serveur : [item_id, bin, rot_deg, x, y]). */
function buildLiveLayout(result, payload, bestAlt) {
    const layouts = normalizeLayouts(bestAlt?.solution)
    const items = []
    layouts.forEach((layout, bin) => {
        for (const pi of layout.placed_items || []) {
            items.push([
                pi.item_id,
                bin,
                pi.transformation?.rotation ?? 0,
                pi.transformation?.translation?.[0] ?? 0,
                pi.transformation?.translation?.[1] ?? 0,
            ])
        }
    })
    const [w, h] = sheetDims(payload, 0)
    return {
        stage: 'final',
        feasible: true,
        density: bestAlt?.solution?.density ?? bestAlt?.density ?? null,
        bins: layouts.length,
        sheets: [[w, h]],
        isSpp: (result?.problem || payload?.problem) === 'spp',
        items,
    }
}

export async function runLocalJobPrivate(jobSlug, { projectSlug, onLive } = {}) {
    const payload = await $fetch(`/api/results/${jobSlug}/local-payload`)
    // Avant le solve : tout ce dont les téléchargements ont besoin doit être
    // dans le navigateur (test d'acceptation : réseau coupé après payload).
    const sources = await fetchSources(payload)

    const outcome = await runInWorker(jobSlug, payload, { onLive })
    if (!outcome.ok) {
        // Échec (engine, memory_cap, crash) = refund, pas de quota consommé.
        await $fetch(`/api/results/${jobSlug}/local-fail`, {
            method: 'POST',
            body: { error: outcome.error === 'memory_cap' ? 'memory_cap' : String(outcome.error) },
        })
        return { ok: false, error: outcome.error, memory: outcome.memory }
    }

    const result = outcome.result
    // Total réel demandé = somme des quantités d'origine (payload.parts porte
    // les counts complets, indépendamment de l'instance réduite meta).
    const requested = (payload?.parts || []).reduce((n, p) => n + (p.count || 0), 0)
    const rawAlts = result?.alternatives || []
    const bestRaw = rawAlts[0]

    // Artefacts calculés navigateur (SVG/rapport/DXF), forme serveur.
    // buildAlternativeArtifacts applique l'expansion meta + post-pass et
    // MUTATE les layouts — `placed` est donc recalculé APRÈS.
    let alternatives = []
    let liveLayout = null
    let placed = 0
    try {
        const arts = await buildAlternativeArtifacts(result, payload)
        placed = normalizeLayouts(bestRaw?.solution)
            .reduce((n, l) => n + (l.placed_items?.length || 0), 0)
        alternatives = toServerShapeAlternatives(result, payload, arts) || []
        // DXF combiné par tôle (nommage serveur : {slug}_alt{r}_part_{n}.dxf).
        for (let rank = 0; rank < alternatives.length; rank++) {
            const containers = arts?.[rank]?.containers || []
            const dxfs = []
            for (let li = 0; li < containers.length; li++) {
                const d = await buildSheetDxf(
                    `${jobSlug}_alt${rank}`, li + 1, containers[li], payload, sources,
                )
                if (d) dxfs.push(d)
            }
            alternatives[rank].dxfs = dxfs
            alternatives[rank].altId = rank
        }
        liveLayout = buildLiveLayout(result, payload, bestRaw)
    } catch {
        // Les artefacts sont best-effort : le solve a réussi, la comptabilité
        // passe d'abord ; un artefact manqué dégrade l'affichage, jamais le job.
    }

    const [sheetWidth, sheetHeight] = sheetDims(payload, 0)
    try {
        await saveLocalResult({
            slug: jobSlug,
            projectSlug: projectSlug || null,
            createdAt: Date.now(),
            problem: result?.problem || payload?.problem || null,
            isSpp: (result?.problem || payload?.problem) === 'spp',
            sheets: [[sheetWidth, sheetHeight]],
            requested,
            placed,
            alternatives,
            liveLayout,
            meta: { memory: outcome.memory },
        })
    } catch {
        // IndexedDB indisponible (navigation privée) : le résultat reste
        // affichable pour la session ; on continue (comptabilité d'abord).
    }

    // Comptabilité seule — scalaires bornés côté serveur, zéro géométrie.
    const best = alternatives[0] || {}
    await $fetch(`/api/results/${jobSlug}/local-quota`, {
        method: 'POST',
        body: {
            placed,
            layoutCount: best.layoutCount ?? 0,
            density: best.density ?? null,
        },
    })
    return { ok: true, alternatives, liveLayout }
}
