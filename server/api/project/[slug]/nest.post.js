import { defineEventHandler, readBody } from 'h3'
import { connectDB } from '~~/server/db/mongo'
import { DOMAINS } from '~~/server/core/domains'
import { enqueueNestingJob } from '~~/server/core/project/service'
import { trackEvent } from '~~/server/tracking/add'
import { assertCanNest, assertCanNestDemo, assertSheetCountWithinTier, BROWSER_COMPUTE, browserWalksForTier, COMPUTE_TIERS, QUALITY_WALKS, getComputeProfile, getComputeTier, resolveComputeLocation, validateDirections, NEST_DIRECTIONS } from '~~/server/utils/entitlement'
import {
    DEMO_MAX_DIRECTIONS,
    DEMO_MAX_PARTS,
    DEMO_PRIORITY,
    DEMO_TIME_BUDGET_SEC,
    DEMO_VCORES,
    resolveDemoWalks,
} from '~~/shared/constants/demo.constants'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Unauthorized',
        })
    }
    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId })
    if (!user) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Unauthorized',
        })
    }

    const projectSlug = getRouterParam(event, 'slug')

    trackEvent(event, 'request_nesting', {
        projectSlug: projectSlug,
    })

    // The shared demo project is nestable by everyone (its own free quota);
    // regular projects require ownership (404, never reveal existence).
    const project = await db.collection('projects').findOne({ slug: projectSlug })
    if (!project || (!project.isDemo && project.ownerId !== userId)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Project not found',
        })
    }
    const isDemo = Boolean(project.isDemo)

    const body = await readBody(event)
    /**
     * @type {{originFiles: {name: string, count: int}[], params: {height: float, width: float, space: float}}}
     **/
    const { files, params } = body

    const filteredFiles = files.filter((file) => file.count > 0)

    // Global rotation setting: N rotations spread evenly around the circle.
    // Falls back to the historical 4 rotations (0/90/180/270) if not provided.
    const rotationCount = Math.min(360, Math.max(1, Math.floor(Number(params?.rotationCount) || 4)))
    const globalRotations =
        rotationCount === 1
            ? [0]
            : Array.from({ length: rotationCount }, (_, i) => Math.round((i * 360) / rotationCount))

    // Demo nestings may only reference the demo project's own files — the
    // slugs are predictable by design, so scope them strictly.
    const filesQuery = isDemo
        ? { projectSlug, isDemo: true }
        : { slug: { $in: filteredFiles.map((file) => file.slug) } }
    const userDxfFilesDatabase = await db
        .collection('user_dxf_files')
        .find(filesQuery)
        .project({
            _id: 0,
            slug: 1,
            name: 1,
            purgedAt: 1,
        })
        .toArray()

    // Purge 24 h (D-PRV-10) : un fichier expiré (géométrie purgée) ne peut
    // plus être nesté — 409 explicite plutôt qu'un job raté opaque côté
    // worker. Les fichiers démo ne sont jamais purgés.
    if (!isDemo) {
        const expired = userDxfFilesDatabase.filter((file) => Boolean(file.purgedAt))
        if (expired.length > 0) {
            throw createError({
                statusCode: 409,
                statusMessage: `files_expired: ${expired.map((f) => f.name).join(', ')}`,
            })
        }
    }

    const fileMetadata = project.local
        ? // J-090 : projet 100 % client — aucun doc fichier côté serveur, les
          // métadonnées viennent du corps de requête (slugs générés client).
          filteredFiles
              .map((file) => ({
                  slug: file.slug,
                  simpleName: String(file.name || file.slug).replace(/\.(dxf|svg)$/i, ''),
                  count: file.count || 0,
                  rotations: file.rotation ? JSON.parse(file.rotation) : globalRotations,
              }))
              .filter((file) => file.count > 0)
        : userDxfFilesDatabase.map((file) => {
              const requestFile = filteredFiles.find((f) => f.slug === file.slug)
              return {
                  slug: file.slug,
                  simpleName: file.name.replace('.dxf', ''),
                  count: requestFile?.count || 0,
                  // Per-file override wins; otherwise apply the global rotation setting.
                  rotations: requestFile?.rotation ? JSON.parse(requestFile.rotation) : globalRotations,
              }
          }).filter((file) => file.count > 0)

    if (isDemo) {
        const totalParts = fileMetadata.reduce((sum, file) => sum + file.count, 0)
        if (fileMetadata.length === 0 || totalParts === 0) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Please request at least one demo part.',
            })
        }
        if (totalParts > DEMO_MAX_PARTS) {
            throw createError({
                statusCode: 400,
                statusMessage: `Demo nestings are limited to ${DEMO_MAX_PARTS} parts.`,
            })
        }
    }

    // Multi-sheet: the client sends params.sheets (list of sheet types with
    // their own dimensions and stock). Legacy clients send a single
    // width/height/sheetCount — normalized to the same shape. Demo nestings
    // accept the client's sheets exactly like regular projects (the demo is
    // a playground); the anti-abuse lives in the imposed compute profile and
    // the DEMO_MAX_PARTS cap, not in fixed geometry.
    let sheets = null
    if (Array.isArray(params.sheets) && params.sheets.length > 0) {
        sheets = params.sheets
            .map((sheet) => ({
                width: Number(sheet.width),
                height: Number(sheet.height),
                count: Math.floor(Number(sheet.count)),
            }))
            .filter(
                (sheet) =>
                    Number.isFinite(sheet.width) &&
                    sheet.width > 0 &&
                    Number.isFinite(sheet.height) &&
                    sheet.height > 0 &&
                    Number.isFinite(sheet.count) &&
                    sheet.count >= 1,
            )
            .slice(0, 10)
        if (sheets.length === 0) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Please provide at least one valid sheet (width, height, count).',
            })
        }
    }

    // Spacing must be a finite non-negative number — validated explicitly on
    // the demo path too since it is a public free surface.
    const space = Number(params.space)
    if (params.space != null && (!Number.isFinite(space) || space < 0)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Please provide a valid spacing.',
        })
    }

    let dbParams
    let charge
    let compute
    const config = useRuntimeConfig(event)
    if (isDemo) {
        // Demo gate: its own monthly free quota (never touches the user's
        // regular free nestings). Geometry params (sheets, spacing, hole
        // filling, rotations) come from the client like a regular project —
        // but the COMPUTE profile stays server-imposed (4 vcores, 90 s wall
        // cap, 3 directions max) so the free demo can never be abused into
        // more machine time.
        // Local compute (flag ON) burns no server vcores — skip the monthly
        // demo quota. Server-side demo still consumes it (anti-abuse).
        const demoLocal =
            resolveComputeLocation(config.public.localComputeEnabled, true, 'demo', project) === 'local'
        charge = demoLocal
            ? { type: 'demo', skippedQuota: true }
            : await assertCanNestDemo(userId)
        const directions = validateDirections(params.directions, DEMO_MAX_DIRECTIONS)
        dbParams = sheets
            ? {
                  sheets,
                  space: params.space,
                  addOutShape: params.addOutShape,
                  fillHoles: params.fillHoles !== false,
              }
            : {
                  height: params.height,
                  width: params.width,
                  space: params.space,
                  sheetCount: params.sheetCount,
                  addOutShape: params.addOutShape,
                  fillHoles: params.fillHoles !== false,
              }
        dbParams.timeBudgetSec = DEMO_TIME_BUDGET_SEC
        dbParams.alternativesCount = directions.length
        dbParams.computeLevel = 'demo'
        dbParams.vcores = DEMO_VCORES
        dbParams.directions = directions
        dbParams.walks = QUALITY_WALKS
        compute = { priority: DEMO_PRIORITY }
    } else if (project.local) {
        // J-090 — projet 100 % client : la géométrie n'est JAMAIS côté
        // serveur. Le job part directement en awaiting_local (aucun worker
        // ne prépare de payload) ; le navigateur assemble l'instance depuis
        // IndexedDB et résout en WASM. Ici : validations + quota uniquement
        // (P3) — le profil compute est imposé par le bloc
        // computeLocation === 'local' commun, plus bas.
        const importEnabled =
            (config.public.localComputeEnabled === true || config.public.localComputeEnabled === 'true') &&
            (config.public.localImportEnabled === true || config.public.localImportEnabled === 'true')
        if (!importEnabled) {
            throw createError({ statusCode: 404, statusMessage: 'Not found' })
        }
        // DWG = conversion serveur (dwgread, D-PRV-2) — jamais compatible
        // avec un projet dont les fichiers ne quittent pas le navigateur.
        if (filteredFiles.some((f) => String(f.name || f.slug).toLowerCase().endsWith('.dwg'))) {
            throw createError({ statusCode: 400, statusMessage: 'dwg_requires_cloud' })
        }
        dbParams = sheets
            ? {
                  sheets,
                  space: params.space,
                  addOutShape: params.addOutShape,
                  fillHoles: params.fillHoles !== false,
              }
            : {
                  height: params.height,
                  width: params.width,
                  space: params.space,
                  sheetCount: params.sheetCount,
                  addOutShape: params.addOutShape,
                  fillHoles: params.fillHoles !== false,
              }
        // Mêmes plafonds que les projets cloud : cap tôles par tier, puis
        // quota (consommé une fois la requête validée ; refundé si échec).
        const tier = await getComputeTier(userId, null)
        const totalSheets = sheets
            ? sheets.reduce((sum, sheet) => sum + sheet.count, 0)
            : Math.max(1, Math.floor(Number(params.sheetCount) || 1))
        assertSheetCountWithinTier(totalSheets, tier)
        charge = await assertCanNest(userId)
        const tierProfile = COMPUTE_TIERS[tier] || COMPUTE_TIERS.free
        compute = {
            priority: tierProfile.priority,
            level: tier,
            maxDirections: tierProfile.maxDirections,
        }
    } else {
        dbParams = sheets
            ? {
                  sheets,
                  space: params.space,
                  addOutShape: params.addOutShape,
                  fillHoles: params.fillHoles !== false,
              }
            : {
                  height: params.height,
                  width: params.width,
                  space: params.space,
                  sheetCount: params.sheetCount,
                  addOutShape: params.addOutShape,
                  fillHoles: params.fillHoles !== false,
              }

        // Sheet cap by tier (D-PAY-9): free jobs are capped at 2 sheets
        // TOTAL (sum of counts over every format, identical or different).
        // Resolved from the stored account state and enforced BEFORE any
        // quota is consumed (P3 — the client can never inflate its own
        // allowance). Edge accepted: a stored-but-stale expired subscription
        // resolves as free here; the next entitlement refresh fixes it.
        // Demo nestings are exempt (dedicated quota, J-056) — they never
        // reach this branch.
        const tier = await getComputeTier(userId, null)
        const totalSheets = sheets
            ? sheets.reduce((sum, sheet) => sum + sheet.count, 0)
            : Math.max(1, Math.floor(Number(params.sheetCount) || 1))
        assertSheetCountWithinTier(totalSheets, tier)

        // Subscription / free-quota gate. Consumes a unit only once the request is
        // fully validated. The charge is stored on the job so the worker can refund
        // it if the nesting fails.
        charge = await assertCanNest(userId)

        // Server-side compute profile by tier (never trust the client for this):
        // vcores (parallel walks), wall-clock cap, and the direction allowance.
        // The client only picks WHICH directions (fewer = faster result).
        compute = await getComputeProfile(userId, charge)
        const directions = validateDirections(params.directions, compute.maxDirections)
        dbParams.timeBudgetSec = compute.wallCapSec
        dbParams.alternativesCount = directions.length
        dbParams.computeLevel = compute.level
        dbParams.vcores = compute.vcores
        dbParams.directions = directions
        // D-PAY-12 : taille de recherche identique (8 walks) ; vcores =
        // concurrence rayon seulement. Le chemin local écrase plus bas.
        dbParams.walks = QUALITY_WALKS
    }

    // Phase 2 (flag-gated internal QA — NOT a privacy feature): route the job
    // to the browser WASM engine. Written SERVER-SIDE (P3): flag OFF writes
    // nothing (pipeline strictly unchanged); 'local' swaps the compute
    // profile for the explicit browser budget (BROWSER_COMPUTE, 13 s) — the
    // Python worker then only PREPARES the payload and the client solves.
    // J-090 : un projet « local » part TOUJOURS en compute navigateur — le
    // serveur n'a pas la géométrie, aucun autre routage n'est possible.
    const computeLocation = project.local
        ? 'local'
        : resolveComputeLocation(
              config.public.localComputeEnabled,
              isDemo,
              isDemo ? 'demo' : compute.level,
              project,
          )
    if (computeLocation) {
        dbParams.computeLocation = computeLocation
    }
    if (computeLocation === 'local') {
        // D-PAY-12 : même recherche (QUALITY_WALKS jusqu'au plateau) pour
        // tous. Le tier / le sélecteur démo ne règle que la CONCURRENCE
        // (vitesse). Le mur est le filet COMPUTE_TIERS, plus le 13 s QA.
        const concurrency = isDemo
            ? resolveDemoWalks(params.demoWalks)
            : browserWalksForTier(compute.level)
        const wall = isDemo
            ? COMPUTE_TIERS.free.wallCapSec
            : (COMPUTE_TIERS[compute.level]?.wallCapSec ?? COMPUTE_TIERS.free.wallCapSec)
        const maxDirs = isDemo ? DEMO_MAX_DIRECTIONS : (compute.maxDirections ?? 1)
        const directions = validateDirections(params.directions, maxDirs)
        dbParams.timeBudgetSec = wall
        dbParams.alternativesCount = directions.length
        dbParams.computeLevel = isDemo ? 'demo' : (compute.level === 'free' ? 'browser' : compute.level)
        dbParams.vcores = concurrency
        dbParams.directions = directions
        compute.priority = isDemo ? DEMO_PRIORITY : (compute.priority ?? BROWSER_COMPUTE.priority)
        dbParams.browser_walks = QUALITY_WALKS
        dbParams.browser_concurrency = concurrency
        dbParams.walks = QUALITY_WALKS
    }
    // Unit for the exported result DXF, taken from the server-side user
    // profile (never the client). Internal geometry stays mm — the worker
    // converts only at the export boundary.
    dbParams.outputUnit = user.preferredUnit === 'inch' ? 'inch' : 'mm'

    // Vault gate + job insertion (the already-consumed charge is passed so
    // the quota is not consumed twice). Demo jobs skip the vault gate: the
    // demo files are plaintext and shared — a privacy-tier user with a locked
    // vault can still try the demo. Projets locaux (J-090) : gate sauté aussi
    // — aucun worker ne lit de fichier, la session DEK n'a pas à exister.
    return await enqueueNestingJob(DOMAINS.bin, {
        userId,
        projectSlug,
        fileMetadata,
        params: dbParams,
        extraFields: {
            priority: isDemo ? DEMO_PRIORITY : compute.priority,
            // J-090 : pas de worker pour renseigner `requested` plus tard —
            // le compte demandé est connu dès l'enqueue (métadonnée).
            ...(project.local
                ? { requested: fileMetadata.reduce((sum, f) => sum + (f.count || 0), 0) }
                : {}),
        },
        charge,
        skipVaultGate: isDemo || Boolean(project.local),
        // J-090 : exécution 100 % navigateur dès la création — le job attend
        // le client, aucune préparation worker. localConfig = le profil
        // imposé serveur que le navigateur appliquera (P3).
        initialStatus: project.local ? 'awaiting_local' : 'pending',
        localConfig: project.local
            ? {
                  timeBudgetSec: dbParams.timeBudgetSec,
                  vcores: dbParams.vcores,
                  maxDirections: dbParams.directions?.length || 1,
                  directions: dbParams.directions,
                  level: dbParams.computeLevel,
                  walks: dbParams.browser_walks ?? QUALITY_WALKS,
                  concurrency: dbParams.browser_concurrency ?? 1,
              }
            : null,
    })
})
