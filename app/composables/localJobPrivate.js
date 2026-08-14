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

/**
 * J-090 — projet « 100 % privé » : assemble le payload moteur 100 %
 * navigateur. local-payload n'a servi QUE des métadonnées (params, comptes,
 * rotations, profil imposé) ; la géométrie est lue d'IndexedDB, l'instance
 * est construite par localPayloadBuilder (miroir exact du worker Python),
 * les bytes sources pour l'export DXF viennent du store local.
 */
async function buildClientPayload(meta) {
    const [{ buildLocalPayload }, { getLocalFile }, { geoOpenHoles, geoPinwheelCapacity }] = await Promise.all([
        import('./localPayloadBuilder'),
        import('./localFilesStore'),
        import('./geometryClient'),
    ])
    const files = []
    const sources = {}
    for (const f of meta.files || []) {
        const record = await getLocalFile(f.slug)
        if (!record) {
            // Fichier importé sur un autre appareil, ou IndexedDB vidée :
            // erreur explicite — le job sera refundé (local-fail).
            throw new Error('local_geometry_missing')
        }
        files.push({
            slug: f.slug,
            name: f.name,
            count: f.count,
            rotations: f.rotations,
            parts: record.parts,
        })
        sources[f.slug] = new Uint8Array(record.dxfBytes)
    }
    const { payload, itemMap } = await buildLocalPayload(
        { files, params: meta.params, profile: meta.localConfig },
        {
            openHoles: (coords, holes, spaceMm) => geoOpenHoles(coords, holes, spaceMm),
            pinwheelCapacity: (ring, coords, spaceMm, allowed) => geoPinwheelCapacity(ring, coords, spaceMm, allowed),
        },
    )
    return { payload, sources, itemMap }
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
    const fetched = await $fetch(`/api/results/${jobSlug}/local-payload`)
    let payload
    let sources
    // J-090 : correspondance id moteur → {slug, part} — construite par le
    // builder client (le job d'un projet local n'a pas d'itemMap serveur).
    let itemMap = null
    if (fetched?.mode === 'client-built') {
        try {
            const built = await buildClientPayload(fetched)
            payload = built.payload
            sources = built.sources
            itemMap = built.itemMap
        } catch (e) {
            // Géométrie locale absente ou instance invalide : refund propre,
            // jamais de quota consommé sur un job qui n'a pas pu démarrer.
            await $fetch(`/api/results/${jobSlug}/local-fail`, {
                method: 'POST',
                body: { error: 'client_payload_build' },
            }).catch(() => {})
            return { ok: false, error: e?.message === 'local_geometry_missing' ? 'geometry_missing' : 'payload_build' }
        }
    } else {
        payload = fetched
        // Avant le solve : tout ce dont les téléchargements ont besoin doit
        // être dans le navigateur (test d'acceptation : réseau coupé après
        // payload).
        sources = await fetchSources(payload)
    }

    // J-093 : taille du pool imposée serveur (localConfig = projet 100 %
    // client ; payload.walks = préparé worker). Résolue ici pour les frames
    // live ; le swap runInWorker → runPool consomme la même valeur.
    const poolWalks = Math.max(1, Number(fetched?.localConfig?.walks ?? payload?.walks ?? 1) || 1)
    const poolConc = Math.max(1, Number(
        fetched?.localConfig?.concurrency ?? payload?.engineConfig?.browser_concurrency ?? poolWalks,
    ) || 1)

    // J-085 : l'instance réduite est réindexée — les frames live du moteur
    // portent les ids réduits, la vue live (itemMap) les ids d'origine.
    const idMap = payload?.meta?.idMap
    const liveHandler = !onLive
        ? undefined
        : (evt) => onLive({
              ...evt,
              // J-090 : la vue puise itemMap dans la frame quand le job est
              // 100 % client (pas d'itemMap sur le doc serveur).
              itemMap: itemMap || evt?.itemMap,
              // J-093 : taille du pool affichée par la vue (stat libellée).
              walks: poolConc,
              items: Array.isArray(idMap)
                  ? (evt?.items || []).map((it) => [idMap[it[0]] ?? it[0], ...it.slice(1)])
                  : evt?.items,
          })

    // J-093 : pool de walks (taille imposée serveur, 1 = chemin mono-walk
    // historique inchangé). runPool orchestre spawn/seeds/merge moteur.
    const { runPool } = await import('./localPool')
    const outcome = await runPool(jobSlug, payload, { onLive: liveHandler, walks: poolWalks, concurrency: poolConc })
    if (!outcome.ok) {
        // J-093 : annulation — le serveur a déjà finalisé + refundé via
        // POST /cancel ; JAMAIS de local-fail ensuite.
        if (outcome.error === 'cancelled') {
            return { ok: false, error: 'cancelled' }
        }
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
    return { ok: true, alternatives, liveLayout, itemMap }
}
