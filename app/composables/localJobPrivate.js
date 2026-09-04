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
    decorateLiveLayout,
    expandMeta,
} from './localBridge'
// Import STATIQUE (audit 2026-08-31 §R-i) : la sentinelle d'annulation des
// zones est comparée dans runLocalJobPrivate — référencée sans import, elle
// ne résolvait que par l'auto-import Nuxt (fragile : ReferenceError pile
// dans le chemin d'annulation hors transform Nuxt). Le reste du pass
// structurel reste en import dynamique (lazy).
import { ZONE_CANCELLED } from './structureClient'

/**
 * Pass structurel navigateur (miroir de core/structure.py + intégration
 * main.py) : détecte le cas « rectangle dominant + petites pièces » sur la
 * vue ORIGINALE de l'instance (constat 2026-08-29 : « trous d'abord »
 * J-085 extrait les petites pièces vers les trous des hôtes — à demande
 * exacte l'instance réduite n'a plus qu'1 classe et la grille ne se
 * déclenchait JAMAIS), construit la grille canonique (zones remplies par
 * mini-pools wasm mono-walk, trous des hôtes en 2e réservoir) et rend une
 * alternative moteur-shaped {structural: true} si elle reste à STRUCT_TOL
 * de la meilleure moteur.
 */
async function buildGridAlternative(jobSlug, payload, result, { onZone } = {}) {
    if ((result?.problem || payload?.problem) !== 'spp') return null
    const instance = payload?.instance || {}
    const items = instance.items || []
    if (!items.length || Array.isArray(instance.bins)) return null
    const sheetW = Number(payload?.engineConfig?.max_strip_width) || 0
    const sheetH = Number(instance.strip_height) || 0
    if (sheetW <= 0 || sheetH <= 0) return null
    const space = Number(payload?.engineConfig?.min_item_separation) || 0
    const parts = payload?.parts || []
    // D3 (audit 2026-09-03) : garde non-quart-de-tour — la grille canonique
    // et sa validation (rotatedBbox/rotateRing) ne savent calculer que les
    // quarts de tour ; un angle libre (45°, 30°… autorisé par l'UI)
    // produirait des anneaux faux → poses chevauchantes acceptées.
    const isQuarter = (deg) => {
        const m = Math.abs(deg) % 90
        return m < 1e-6 || 90 - m < 1e-6
    }
    for (const part of parts) {
        for (const r of (part.rotations?.length ? part.rotations : [0, 90, 180, 270])) {
            if (!isQuarter(Number(r) || 0)) return null
        }
    }
    const idMap = payload?.meta?.idMap
    const partsById = new Map(parts.map((p) => [Number(p.id), p]))
    const best = result?.alternatives?.[0]
    // Objectif : −Y natif si le job ne demande QUE bottom (la grille doit
    // répondre à la question posée) ; −X sinon ; Mixed SEUL : pas de grille
    // (l'objectif « bras équilibrés » n'a pas de canon rectangulaire —
    // miroir du garde côté serveur).
    const biases = payload?.engineConfig?.biases || []
    const objective = !Array.isArray(biases) || biases.length !== 1
        ? 'x'
        : (biases[0] === 'bottom' ? 'y' : (biases[0] === 'balanced' ? null : 'x'))
    if (objective == null) return null
    const bestExtent = Number(
        objective === 'y'
            ? (best?.used_height ?? best?.solution?.used_height)
            : (best?.solution?.strip_width ?? best?.strip_width),
    )
    if (!Number.isFinite(bestExtent) || bestExtent <= 0) return null

    // Vue ORIGINALE à 2 classes : parts porte les quantités complètes
    // (l'instance de solve est RÉDUITE : ids réindexés, fillers extraits).
    // Rotations : item d'instance si la classe y vit encore, sinon les
    // rotations pinwheel VALIDÉES de la meta (filler extrait).
    const meta = payload?.meta || null
    const instByOrig = new Map(items.map((it) => [
        Array.isArray(idMap) && Number.isInteger(it.id) && it.id >= 0 && it.id < idMap.length
            ? idMap[it.id]
            : it.id,
        it,
    ]))
    const unionRingRotations = (ringRotations) => {
        const u = []
        for (const rr of ringRotations || []) {
            for (const r of rr || []) if (!u.includes(r)) u.push(r)
        }
        return u
    }
    const origItems = []
    const rotationsByOrig = new Map()
    for (const p of parts) {
        if (!(p.count > 0)) continue
        const inst = instByOrig.get(Number(p.id))
        let rotations = inst?.allowed_orientations || null
        if (!rotations && meta && !meta.packs && Number(meta.fill) === Number(p.id)) {
            rotations = unionRingRotations(meta.ringRotations)
        }
        origItems.push({ id: Number(p.id), demand: p.count })
        rotationsByOrig.set(Number(p.id), rotations)
    }
    const geomOf = (itemId) => {
        const part = partsById.get(Number(itemId))
        if (!part) return null
        return { coords: part.coords, rotations: rotationsByOrig.get(Number(itemId)) }
    }

    const { runPool, deriveSeed } = await import('./localPool')
    const {
        STRUCT_TOL, buildStructuralLayout, layoutUsedExtent, layoutFitsSheet,
    } = await import('./structureClient')
    const { detectStructuralCase } = await import('./structureClient')
    let totalArea = 0
    for (const it of origItems) {
        const g = geomOf(it.id)
        if (!g) return null
        totalArea += Math.abs(polygonArea(g.coords)) * (Number(it.demand) || 0)
    }
    const caseInfo = detectStructuralCase(origItems, geomOf, totalArea)
    if (!caseInfo) return null

    const masterSeed = String(payload?.engineConfig?.prng_seed ?? '0')
    let zoneIdx = 0
    const smallId = caseInfo.small.id
    const smallRotations = rotationsByOrig.get(smallId) || [0, 90, 180, 270]
    const solveZone = async (count, stripH, maxW, budgetSec, transposed = false) => {
        const smallPart = partsById.get(Number(smallId))
        if (!smallPart) return null
        const coords = smallPart.coords || []
        const zoneShape = transposed
            ? { type: 'simple_polygon', data: coords.map(([x, y]) => [y, -x]) }
            : { type: 'simple_polygon', data: coords }
        const zonePayload = {
            problem: 'spp',
            instance: {
                name: `${instance.name || 'job'}-zone`,
                strip_height: stripH,
                items: [{
                    id: 0,
                    demand: count,
                    allowed_orientations: smallRotations,
                    shape: zoneShape,
                }],
            },
            engineConfig: {
                ...payload?.engineConfig,
                time_budget_sec: budgetSec,
                plateau_patience_sec: 4,
                max_strip_width: maxW,
                biases: ['left'],
                n_workers: 1,
                separator_workers: 1,
                live_events: false,
                browser_walks: 1,
                browser_concurrency: 1,
                prng_seed: deriveSeed(masterSeed, 1000 + zoneIdx++).toString(),
            },
        }
        const outcome = await runPool(`${jobSlug}-zone${zoneIdx}`, zonePayload,
            { walks: 1, concurrency: 1 })
        if (!outcome.ok) {
            // Annulation : les pools de zones sont tués par préfixe
            // (cancelPool) — propager la sentinelle, ne PAS retry.
            if (outcome.error === 'cancelled') {
                throw ZONE_CANCELLED
            }
            return null
        }
        const alt = outcome.result?.alternatives?.[0]
        const layout = alt?.solution?.layout || alt?.solution?.layouts?.[0]
        return layout?.placed_items || null
    }
    function polygonArea(coords) {
        // Anneau fermé OU non : boucle circulaire (bord de fermeture nul
        // quand first == last — exact dans les deux cas).
        let s = 0
        for (let i = 0; i < coords.length; i++) {
            const [x1, y1] = coords[i]
            const [x2, y2] = coords[(i + 1) % coords.length]
            s += x1 * y2 - x2 * y1
        }
        return s / 2
    }

    // Trous des hôtes (mode « trous d'abord ») : rotations pinwheel validées
    // par anneau — la grille remplit les zones internes A/C d'abord, les
    // trous absorbent l'excédent (silhouette rectangulaire pleine), la zone
    // B ne garde que l'incompressible.
    const rectPart = partsById.get(Number(caseInfo.rect.id))
    let holePlan = null
    let holeRotations = null
    if (meta && !meta.packs && Array.isArray(meta.ringRotations)
        && Number(meta.host) === Number(caseInfo.rect.id)
        && Number(meta.fill) === Number(smallId)
        && (rectPart?.holes || []).length) {
        holePlan = {
            hostId: Number(caseInfo.rect.id),
            fillId: Number(smallId),
            rings: rectPart.holes,
            ringRotations: meta.ringRotations,
        }
        holeRotations = meta.ringRotations
    }

    const struct = await buildStructuralLayout(origItems, geomOf, sheetW, sheetH,
        space, solveZone, objective, onZone, holePlan,
        holePlan
            ? (hostId, fillId, slots, layouts) => expandMeta(
                parts, hostId, fillId, slots, layouts, holeRotations)
            : null)
    if (!struct) return null
    // Garde anti-perte (miroir du part-loss guard serveur) : un layout
    // structurel incomplet ne doit JAMAIS remplacer le résultat moteur
    // (bug réel 2026-08-29 : placements de la zone B non poussés → 689/900
    // livrés en rang 0).
    const totalRequested = origItems.reduce((n, it) => n + (Number(it.demand) || 0), 0)
    if (struct.placed_items.length !== totalRequested) return null
    // P-4 (audit 2026-08-31 §P-4) : garde POSITION en aval du garde COMPTE
    // (piège #45) — le layout grille ne se répare pas, une pièce hors tôle
    // = repli moteur. buildStructuralLayout vérifie déjà en interne ; ce
    // double filet protège contre toute divergence entre les deux appels.
    if (!layoutFitsSheet(struct, geomOf, sheetW, sheetH)) return null
    const axis = objective === 'y' ? 'y' : 'x'
    const structExtent = layoutUsedExtent(struct, geomOf, space, axis)
    if (typeof window !== 'undefined') {
        window.__structDiag = { ...(window.__structDiag || {}), objective,
            structExtent, bestExtent, tol: STRUCT_TOL, case: struct.case }
    }
    if (structExtent > bestExtent * (1 + STRUCT_TOL)) return null
    const layout = { container_id: 0, placed_items: struct.placed_items }
    // Densité à l'échelle moteur (aire MATÉRIAU placée / bande utilisée —
    // l'aire des trous n'est pas de la matière, sinon >1 quand les fans
    // y vivent) : sans elle, la frame live et le repli du modal affichent
    // 0 % pour la grille (stats « cassées », constat 2026-08-28).
    const cross = objective === 'y' ? sheetW : sheetH
    let placedArea = 0
    for (const it of origItems) {
        const part = partsById.get(Number(it.id))
        if (!part) return null
        const holesArea = (part.holes || [])
            .reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
        placedArea += Math.max(0, Math.abs(polygonArea(part.coords)) - holesArea)
            * (Number(it.demand) || 0)
    }
    const structDensity = placedArea / (structExtent * cross)
    return {
        rank: 0,
        seed: null,
        bias: null,
        structural: true,
        // Layout AUTO-SUFFISANT quand le solve était réduit (ids d'origine,
        // trous remplis ici) : buildAlternativeArtifacts saute remap idMap /
        // expansion meta / post-pass hole-fill pour CETTE alternative.
        // R-m.4 (audit 2026-08-31 §R-m.4) : suit holePlan, pas meta — un
        // meta packs SANS hole_plan ne rend PAS la grille auto-suffisante
        // (le serveur applique apply_hole_fill, miroir main.py::1233).
        selfContained: Boolean(holePlan),
        strip_width: objective === 'x' ? structExtent : null,
        used_height: objective === 'y' ? structExtent : null,
        density: structDensity,
        solution: {
            layout,
            layouts: [layout],
            strip_width: objective === 'x' ? structExtent : null,
            density: structDensity,
            cost: 1,
        },
    }
}

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
            name: record.name,
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
        // V6 : bias de l'alternative — la frame finale doit vivre dans SA
        // classe (et remplace de toute façon toutes les classes).
        bias: bestAlt?.bias ?? null,
        density: bestAlt?.solution?.density ?? bestAlt?.density ?? null,
        // Portés explicitement : sans strip_width, fitsSheet retourne
        // true par défaut et une frame finale hors-tôle passerait pour
        // présentable (piège #6). used_height alimente le tie-break du
        // champion (même critère que le merge SPP).
        strip_width: bestAlt?.solution?.strip_width ?? bestAlt?.strip_width ?? null,
        used_height: bestAlt?.used_height ?? bestAlt?.solution?.used_height ?? null,
        bins: layouts.length,
        sheets: [[w, h]],
        isSpp: (result?.problem || payload?.problem) === 'spp',
        items,
    }
}

export async function runLocalJobPrivate(jobSlug, { projectSlug, onLive } = {}) {
    // §M.3 (audit 2026-08-29, durci 2026-08-31) : fetch SANS timeout — un
    // serveur qui ne répond jamais laissait le slot du registre occupé à vie
    // (running=1, bouton « Imbriquer » muet jusqu'au rechargement). Borné :
    // l'erreur remonte, le job passe en error (re-filable — R-5 registre).
    const fetched = await $fetch(`/api/results/${jobSlug}/local-payload`, {
        timeout: 60_000,
    })
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
    const { resolvePoolShape } = await import('./localPool')
    const { walks: poolWalks, concurrency: poolConc } = resolvePoolShape({
        localConfig: fetched?.localConfig,
        payload,
    })

    // J-085 : l'instance réduite est réindexée — les frames live du moteur
    // portent les ids réduits, la vue live (itemMap) les ids d'origine.
    const idMap = payload?.meta?.idMap
    const liveHandler = !onLive
        ? undefined
        : (evt) => {
              const remapped = Array.isArray(idMap)
                  ? (evt?.items || []).map((it) => [idMap[it[0]] ?? it[0], ...it.slice(1)])
                  : evt?.items
              const decorated = decorateLiveLayout({ ...evt, items: remapped }, payload)
              onLive({
                  ...decorated,
                  // J-090 : la vue puise itemMap dans la frame quand le job est
                  // 100 % client (pas d'itemMap sur le doc serveur).
                  itemMap: itemMap || evt?.itemMap,
                  // J-093 : taille du pool affichée par la vue (stat libellée).
                  walks: poolConc,
              })
          }

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

    // Pass structurel (grille canonique) — miroir de core/structure.py :
    // SPP, item rectangulaire dominant + petites pièces → alternative
    // 'grid' (colonnes exactes + zones denses), comparée à la tolérance
    // STRUCT_TOL puis AJOUTÉE aux alternatives moteur AVANT les artefacts
    // (le remap J-085 de buildAlternativeArtifacts s'applique pareil).
    // Échec quelconque ⇒ silencieux, résultat moteur inchangé. onZone remonte
    // la progression de remplissage (feedback pendant la phase silencieuse).
    // L'annulation réelle transite par cancelPool (préfixe zones) qui fait
    // lever ZONE_CANCELLED par les sous-solves — l'ancien hook isCancelled
    // (drapeau jamais armé) était du code mort, supprimé (audit 2026-08-31).
    try {
        const struct = await buildGridAlternative(jobSlug, payload, result, {
            onZone: (z) => onLive && onLive({ type: 'zone', ...z }),
        })
        if (typeof window !== 'undefined') {
            // Fusion et non écrasement : le second write détruisait le
            // diagnostic détaillé de buildGridAlternative (sonde QA).
            window.__structDiag = struct
                ? { ...(window.__structDiag || {}), built: true, width: struct.strip_width }
                : { ...(window.__structDiag || {}), built: false }
        }
        if (struct) result.alternatives = [struct, ...(result.alternatives || [])]
    } catch (e) {
        if (e === ZONE_CANCELLED) {
            // Annulation utilisateur pendant les zones : sortie propre, la
            // carte du job suit le flux « cancelled » — JAMAIS de local-fail.
            return { ok: false, error: 'cancelled' }
        }
        if (typeof window !== 'undefined') {
            window.__structDiag = { ...(window.__structDiag || {}), built: false, error: String(e) }
        }
        console.warn('structural grid pass failed', e)
    }

    const rawAlts = result?.alternatives || []

    // Artefacts calculés navigateur (SVG/rapport/DXF), forme serveur.
    // buildAlternativeArtifacts applique l'expansion meta + post-pass et
    // MUTATE les layouts — `placed` est donc recalculé APRÈS.
    let alternatives = []
    let liveLayout = null
    let placed = 0
    let allAlternativesInvalid = false
    try {
        let arts = await buildAlternativeArtifacts(result, payload)
        // P-4 (audit 2026-08-31 §P-4) + A4/D13 (audit 2026-09-03) — filet
        // aval miroir de _finalize_alternative : mesure indépendante
        // (report wasm) sur l'état POST-PASS (arts[i].containers). Une alt
        // STRUCTURELLE hors tôle, une alt au compte PAR CLASSE erroné
        // (doublon + perte compensée passaient : seul le total était
        // vérifié) ou une alt mesurée en chevauchement/doublons est
        // ÉCARTÉE. arts suit la même permutation que
        // result.alternatives (indices alignés).
        const requestedById = new Map(
            (payload?.parts || []).map((p) => [String(p.id), Number(p.count) || 0]),
        )
        const { perClassCountsMatch } = await import('./localBridge')
        const keptIdx = []
        rawAlts.forEach((alt, i) => {
            const art = arts?.[i]
            if (alt.structural && art?.report?.verify?.insideSheet === false) return
            if (art?.containers?.length
                && !perClassCountsMatch(art.containers, requestedById)) {
                console.error('[local] alternative per-class count mismatch, discarding', {
                    strategy: alt.bias || alt.strategy || 'engine',
                })
                return
            }
            const verify = art?.report?.verify
            if (verify && (verify.overlapFree === false || (verify.duplicatePoses || 0) > 0)) {
                console.error('[local] alternative physically invalid, discarding', {
                    strategy: alt.bias || alt.strategy || 'engine',
                    overlapFree: verify.overlapFree,
                    duplicatePoses: verify.duplicatePoses,
                })
                return
            }
            keptIdx.push(i)
        })
        if (keptIdx.length !== rawAlts.length) {
            result.alternatives = keptIdx.map((i) => rawAlts[i])
            arts = keptIdx.map((i) => arts?.[i] ?? null)
        }
        // V8 (vérif 2026-09-04) : TOUTES les alternatives rejetées par la
        // garde (chevauchement/doublons mesurés) ≠ job réussi à 0 pièce —
        // l'ancien flux livrait placed = 0 avec quota consommé et une
        // frame finale vide qui battait tout champion (bins: 0). Sortie
        // local-fail : refund, carte en erreur, message dédié.
        if (!keptIdx.length && rawAlts.length) {
            allAlternativesInvalid = true
            throw new Error('all_alternatives_invalid')
        }
        const bestRaw = result.alternatives[0]
        placed = normalizeLayouts(bestRaw?.solution)
            .reduce((n, l) => n + (l.placed_items?.length || 0), 0)
        alternatives = toServerShapeAlternatives(result, payload, arts) || []
        // m-1 (audit 2026-08-31 §R-m.1) : même ordre d'affichage que la
        // finalisation SERVEUR (main.py — grille d'abord par choix produit,
        // puis classes canoniques left/bottom/balanced, qualité mesurée
        // layoutCount/usedSheetShare au sein de chaque classe). Sans ce tri,
        // « Option 1 » différait entre THIS DEVICE et le serveur. La
        // permutation réordonne les containers d'artefacts EN PARALLÈLE
        // (arts est indexé sur l'ordre moteur, pas l'ordre affiché).
        const DIRECTION_ORDER = { grid: -1, left: 0, bottom: 1, balanced: 2 }
        const known = alternatives.some((a) => a.strategy in DIRECTION_ORDER)
        const cmp = (x, y) => {
            if (known) {
                const dx = DIRECTION_ORDER[x.strategy] ?? 99
                const dy = DIRECTION_ORDER[y.strategy] ?? 99
                if (dx !== dy) return dx - dy
            }
            const lx = x.layoutCount || 0
            const ly = y.layoutCount || 0
            if (lx !== ly) return lx - ly
            return (x.usedSheetShare ?? 1.0) - (y.usedSheetShare ?? 1.0)
        }
        const idx = alternatives.map((_, i) => i).sort((a, b) => cmp(alternatives[a], alternatives[b]))
        const containersOrdered = idx.map((i) => arts?.[i]?.containers || [])
        alternatives = idx.map((i) => alternatives[i])
        // DXF combiné par tôle (nommage serveur : {slug}_alt{r}_part_{n}.dxf).
        for (let rank = 0; rank < alternatives.length; rank++) {
            const containers = containersOrdered[rank]
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
    } catch (e) {
        // V8 : la sentinelle avorte le reste des artefacts — le flag
        // portera le local-fail (refund) APRÈS le catch ; une exception
        // nue sortirait de run() sans refund.
        if (e?.message !== 'all_alternatives_invalid') {
            // Les artefacts sont best-effort : le solve a réussi, la
            // comptabilité passe d'abord ; un artefact manqué dégrade
            // l'affichage, jamais le job.
        }
    }

    // V8 : toutes les alternatives rejetées par la garde physique →
    // local-fail (refund), message dédié — JAMAIS un job done à 0 pièce.
    if (allAlternativesInvalid) {
        await $fetch(`/api/results/${jobSlug}/local-fail`, {
            method: 'POST',
            body: { error: 'all_alternatives_invalid' },
        })
        return { ok: false, error: 'all_alternatives_invalid' }
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
