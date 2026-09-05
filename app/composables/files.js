
import { computed, reactive, readonly } from 'vue'
import { processingType } from '~~/constants/files.constants'
import { convertInputValue, displayToMm, DEFAULT_SHEET, equivalentSheetPreset } from '~/utils/units'
import { getUnitState } from '~/composables/useUnit'

const { actions } = globalStore
const { getProjects, setModalNestData } = actions

/**
 * Factory defaults for the nesting form (display-unit strings, mm factory).
 * Extracted so a project switch can RESET to a clean form without leaking
 * the previous project's (or the demo's) settings.
 */
function factoryParams() {
    return {
        sheets: [{ width: '1000', height: '2000', count: '1' }],
        space: '0.1',
        addOutShape: false,
        // Allow nesting smaller parts inside the cutouts of holed parts
        // (engine opens them with a hairline channel; off = sealed cutouts).
        fillHoles: true,
        rotationCount: 4,
        // D-MOT-5 amendé : 1 sens = 1 layout (le meilleur). Cocher plus
        // de sens = plus de propositions.
        directions: ['left'],
    }
}

// Cloisonnement par projet (QA 2026-08-30 : changer de projet pendant un
// nesting RÉINITIALISAIT les quantités saisies et laissait les params
// fuiter d'un projet à l'autre — la démo écrasait les réglages des vrais
// projets). Snapshot par slug : params (+ leur unité d'expression) et
// quantités/rotations par fichier — sauvegardé en quittant le projet,
// restauré en y revenant. Les fichiers sont rechargés depuis le serveur ;
// seul le choix utilisateur est snapshoté.
const projectSnapshots = new Map()
const PROJECT_SNAPSHOT_MAX = 20
// Backing sessionStorage : un RECHARGEMENT complet (F5, lien externe) vide
// la Map module — le sessionStorage la restitue (durée de vie = l'onglet,
// les bons semantics pour des brouillons de réglages).
const SNAPSHOT_STORAGE_KEY = 'nestorcut:projectSnapshots'
function loadSnapshotsFromStorage() {
    if (typeof sessionStorage === 'undefined') return
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY)
        if (!raw) return
        for (const [slug, snap] of Object.entries(JSON.parse(raw))) {
            projectSnapshots.set(slug, snap)
        }
    } catch { /* stockage indisponible/corrompu : mémoire seule */ }
}
function persistSnapshotsToStorage() {
    if (typeof sessionStorage === 'undefined') return
    try {
        sessionStorage.setItem(
            SNAPSHOT_STORAGE_KEY,
            JSON.stringify(Object.fromEntries(projectSnapshots))
        )
    } catch { /* quota plein : mémoire seule */ }
}
loadSnapshotsFromStorage()

// Posé par la page (démo) juste après avoir appliqué ses défauts curated
// au montage : setProjectFiles (async, APRÈS le setup) ne doit alors pas
// écraser ces params par les défauts d'usine — première visite seulement.
// Une fois le projet chargé, le drapeau est consommé ; au RETOUR sur le
// projet, c'est le snapshot qui gagne (les curated defaults ne repassent
// pas par-dessus les réglages de l'utilisateur).
let pendingCuratedDefaults = false
function markCuratedDefaults() {
    pendingCuratedDefaults = true
}

function snapshotCurrentProject() {
    if (state.projectSlug == null) return
    projectSnapshots.set(state.projectSlug, {
        params: JSON.parse(JSON.stringify(state.params)),
        paramsUnit,
        countBySlug: Object.fromEntries(
            (state.projectFiles || []).map((file) => [file.slug, file.count])
        ),
        rotationBySlug: Object.fromEntries(
            (state.projectFiles || []).map((file) => [file.slug, file.rotation])
        ),
    })
    if (projectSnapshots.size > PROJECT_SNAPSHOT_MAX) {
        projectSnapshots.delete(projectSnapshots.keys().next().value)
    }
    persistSnapshotsToStorage()
}

// R-7 (audit 2026-08-31 §R-6) : la persistance ne se déclenchait qu'au
// CHANGEMENT de projet — un F5 SANS navigation préalable ramenait les
// défauts d'usine (et au retour sur un projet déjà snapshoté, l'ANCIEN
// snapshot). Débounce sur chaque mutation des réglages/quantités, plus
// pagehide en filet de sécurité (charge d'onglet, F5).
let snapshotPersistTimer = null
function scheduleSnapshotPersist() {
    if (snapshotPersistTimer) clearTimeout(snapshotPersistTimer)
    snapshotPersistTimer = setTimeout(() => {
        snapshotPersistTimer = null
        snapshotCurrentProject()
    }, 500)
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', snapshotCurrentProject)
}

const state = reactive({
    projectFiles: null,
    projectSlug: null,
    projectName: '',
    projectDemo: false,
    // J-090 : projet « 100 % privé » — fichiers en IndexedDB, jamais uploadés.
    projectLocal: false,
    // Clé i18n de la dernière erreur d'import navigateur (affichée en page).
    localImportError: '',
    lastParams: '',
    // Set when a demo nesting hits the monthly demo quota — shown on the
    // project page instead of the paywall (demo 402s are reason=demo_quota).
    demoQuotaReached: false,
    // Set when the server-side free sheet cap actually fired (403
    // sheet_cap_exceeded) — defense-in-depth: the project page mirror
    // normally disables the launch before this can happen.
    sheetCapError: false,
    // R-2 (audit 2026-08-31 §R-1) : clé i18n de la dernière erreur de
    // soumission non gérée ailleurs (409 concurrent_limit, 5xx…) — avant,
    // l'erreur était avalée ET lastParams marqué → bouton grisé muet.
    nestError: '',
    // Z1 (vérif 2026-09-05) : payload structuré du refus 422 capacité
    // (aire gonflée > seuil) — {reason, ratio, sheetsNeeded,
    // maxPartsAtSpacing, maxSpacingForFitMm} pour le bandeau à leviers.
    nestUnfit: null,
    // Soumission en vol : bloque le double-clic pendant la latence du POST
    // (2 requêtes = 2 charges possibles chez un Free, cf. R-1 serveur).
    nestBusy: false,
    params: factoryParams(),
    isSvgLoaded: computed(
        () =>
            state.projectFiles?.every(
                (file) => file.processingStatus !== processingType.inProgress
            ) || false
    ),
    filesStatusDone: computed(
        () =>
            state.projectFiles?.filter(
                (file) => file.processingStatus === processingType.done
            ) || []
    ),
    filesToNest: computed(() =>
        state.filesStatusDone.map((file) => ({
            slug: file.slug,
            count: file.count,
            // Per-file rotation override wins; otherwise use the global setting.
            rotation: file.rotation || JSON.stringify(buildRotationAngles(Number(state.params.rotationCount))),
            // Projet 100 % privé : pas de `name` — le serveur n'en a pas
            // besoin (quota + slugs opaques suffisent). Le libellé reste
            // dans IndexedDB, affiché ici seulement.
        }))
    ),
    currentFilesSlug: computed(
        () => new Set(state.projectFiles?.map((file) => file.slug) || [])
    ),
    // Nom honnête (m-7 audit 2026-08-31 §R-m.7) : ce computed vaut « les
    // paramètres sont INVALIDES » — l'ancien nom isValidParams (sémantique
    // inversée) était un piège de maintenance.
    isInvalidParams: computed(() => {
        const sheets = normalizedSheets(state.params)
        if (sheets.length === 0) return false
        const invalid = sheets.some(
            (sheet) =>
                !isValidNumber(sheet.width) ||
                !isValidNumber(sheet.height) ||
                !/^\d+$/.test(String(sheet.count)) ||
                Number(sheet.count) < 1
        )
        return invalid || !isValidNumber(state.params.space)
    }),
    requestBody: computed(() => {
        const sheets = normalizedSheets(state.params)
        const first = sheets[0] || { width: 0, height: 0, count: 0 }
        // Params hold DISPLAY-unit strings (the user's preferred unit) — the
        // API and the whole pipeline speak canonical mm, so convert here,
        // at the boundary.
        const unit = getUnitState()
        const toMm = (v) => displayToMm(Number(v), unit)
        return JSON.stringify({
            files: state.filesToNest,
            params: {
                sheets: sheets.map((sheet) => ({
                    width: toMm(sheet.width),
                    height: toMm(sheet.height),
                    count: Number(sheet.count),
                })),
                // Legacy mirror of the first sheet — older workers/APIs only
                // understand width/height/sheetCount.
                width: toMm(first.width),
                height: toMm(first.height),
                sheetCount: Number(first.count),
                tolerance: Number(state.params.tolerance),
                space: toMm(state.params.space),
                addOutShape: state.params.addOutShape,
                fillHoles: state.params.fillHoles !== false,
                rotationCount: Number(state.params.rotationCount),
                // Layout directions to optimize towards (server re-validates
                // against the tier allowance); undefined = server default.
                directions: Array.isArray(state.params.directions) && state.params.directions.length
                    ? state.params.directions
                    : undefined,
                // Demo-only: 1 / 4 / 8 walks (Free / Unlimited / Pro preview).
                // Server allow-lists; ignored on non-demo jobs.
                demoWalks: state.params.demoWalks != null
                    ? Number(state.params.demoWalks)
                    : undefined,
            }
        })
    })
})

let updateTimer

// J-090 : fichiers déposés sur la home à la création d'un projet « 100 %
// privé » — la page projet les consomme à l'arrivée pour l'import navigateur
// (module state : des File objects ne survivent pas une navigation).
let pendingLocalFiles = []
function setPendingLocalFiles(files) {
    pendingLocalFiles = Array.isArray(files) ? files : []
}
function consumePendingLocalFiles() {
    const files = pendingLocalFiles
    pendingLocalFiles = []
    return files
}

// Keep polling the project while any uploaded file is still being processed
// by the file processing worker, so the UI flips from a loader to the
// selectable file as soon as processing completes. Mirrors strip.js.
function scheduleFilesRefresh(path) {
    if (updateTimer) {
        clearTimeout(updateTimer)
        updateTimer = null
    }
    const hasProcessing = (state.projectFiles || []).some(
        (file) => file.processingStatus === processingType.inProgress
    )
    // Only re-poll if we are still on the same project — otherwise the timer
    // would keep fetching the previous project after navigating away.
    if (hasProcessing && path && path === state.projectSlug) {
        updateTimer = setTimeout(() => getProject(path), 5000)
    }
}

// m-6 (audit 2026-08-31 §R-m.6) : sur navigation rapide, la réponse la plus
// LENTE gagnait et collait les fichiers/params d'un AUTRE projet sur l'URL
// courante. On ne retient que la réponse de la dernière demande émise.
let lastProjectRequest = null

async function getProject(path) {
    lastProjectRequest = path
    try {
        const data = await $fetch(path)
        if (path !== lastProjectRequest) return
        state.projectLocal = Boolean(data.local)
        state.projectDemo = Boolean(data.isDemo)
        if (data.local) {
            // J-090 : les fichiers d'un projet « 100 % privé » vivent dans
            // IndexedDB — le serveur ne sert que le nom/slug du projet.
            const { listLocalFiles } = await import('./localFilesStore')
            const { localRecordToUiFile } = await import('./localImport')
            const { titleFromFileName } = await import('../utils/projectTitle')
            const records = await listLocalFiles(data.slug)
            setProjectFiles(records.map(localRecordToUiFile), path)
            // Display name from the first file, IndexedDB only — never PATCH.
            const fromFile = titleFromFileName(records[0]?.name)
            setProjectName(fromFile || data.name || '')
        } else {
            if (data.name) setProjectName(data.name)
            setProjectFiles(data.files, path)
        }
    } catch (error) {
        if (path !== lastProjectRequest) return
        if (error?.data?.statusMessage === 'vault_locked') {
            const vaultUnlockDialog = useVaultUnlockDialog();
            vaultUnlockDialog.value = true;
            return
        }
        console.error('Error fetching project:', error)
        navigateTo("/home");
    }
}
function setProjectName(name) {
    state.projectName = name
}
function setProjectFiles(files, path) {
    // Cloisonnement (QA 2026-08-30) : en QUITTANT un projet on snapshotte
    // ses réglages ; en ARRIVANT sur un autre, on restaure SON snapshot —
    // ou les défauts d'usine (plus de fuite des params d'un projet à
    // l'autre, la démo comprise). Sur un rechargement du MÊME projet
    // (upload de fichiers), le comportement historique est conservé :
    // les counts/rotations sélectionnés sont portés par slug.
    const sameProject = path != null && path === state.projectSlug
    if (!sameProject) {
        snapshotCurrentProject()
    }
    const snap = (!sameProject && path != null)
        ? projectSnapshots.get(path)
        : null
    const countBySlug = new Map(
        sameProject
            ? (state.projectFiles || []).map((file) => [file.slug, file.count])
            : Object.entries(snap?.countBySlug || {})
    )
    const rotationBySlug = new Map(
        sameProject
            ? (state.projectFiles || []).map((file) => [file.slug, file.rotation])
            : Object.entries(snap?.rotationBySlug || {})
    )
    state.projectFiles = files.map((file) => ({
        ...file,
        // Demo files carry their suggested quantity from the seed; anything
        // else starts at 1 (or keeps the user's previous pick on reload —
        // désormais aussi au RETOUR sur le projet, via le snapshot).
        count: countBySlug.has(file.slug) ? countBySlug.get(file.slug) : (file.demoQuantity ?? 1),
        rotation: rotationBySlug.has(file.slug) ? rotationBySlug.get(file.slug) : null
    }))
    state.projectSlug = path ?? null
    if (!sameProject) {
        // Reset the "already nested" marker so the Nest button reflects the
        // newly loaded project rather than the previous one.
        state.lastParams = ''
        // Params du projet visité : son snapshot s'il existe (l'utilisateur
        // était déjà passé), sinon les curated defaults posés au montage
        // (démo), sinon les défauts d'usine.
        if (snap) {
            state.params = JSON.parse(JSON.stringify(snap.params))
            paramsUnit = snap.paramsUnit
        } else if (!pendingCuratedDefaults) {
            state.params = factoryParams()
            paramsUnit = 'mm'
        }
        pendingCuratedDefaults = false
    }
    scheduleFilesRefresh(path)
}
async function addFiles(files, slug) {
    if (state.projectLocal) {
        // J-090 : import 100 % navigateur (parse wasm + IndexedDB) — aucun
        // byte ne transite par le serveur.
        state.localImportError = ''
        try {
            const { importLocalFile } = await import('./localImport')
            for (const file of files) {
                await importLocalFile(file, slug)
            }
        } catch (err) {
            state.localImportError = err?.message || 'localImport.parseError'
        }
        await getProject(API_ROUTES.PROJECT(slug))
        return
    }
    const formData = new FormData()
    formData.append('projectName', state.projectName)
    files.forEach((file) => formData.append('dxf', file))
    try {
        await $fetch(API_ROUTES.ADDFILES(slug), {
            method: 'POST',
            body: formData
        })

        await getProject(API_ROUTES.PROJECT(slug))
    } catch (error) {
        console.error('Error while uploading files:', error)
    }
}
function isValidNumber(value) {
    return /^\d+([.,]\d+)?$/.test(value)
}
/**
 * Sheets list with backward compatibility: params written before the
 * multi-sheet feature only had widthPlate/heightPlate/sheetCount.
 */
function normalizedSheets(params) {
    if (Array.isArray(params.sheets) && params.sheets.length > 0) {
        return params.sheets
    }
    if (params.widthPlate != null) {
        return [{
            width: params.widthPlate,
            height: params.heightPlate,
            count: params.sheetCount ?? 1,
        }]
    }
    return []
}
function updateParams(param) {
    state.params = { ...state.params, ...param }
    scheduleSnapshotPersist()
}
function updateSheet(index, patch) {
    const sheets = normalizedSheets(state.params).map((sheet, i) =>
        i === index ? { ...sheet, ...patch } : sheet
    )
    state.params = { ...state.params, sheets }
    scheduleSnapshotPersist()
}
function addSheet() {
    const sheets = normalizedSheets(state.params)
    const last = sheets[sheets.length - 1] || { ...DEFAULT_SHEET.mm, count: '1' }
    state.params = { ...state.params, sheets: [...sheets, { ...last, count: '1' }] }
    scheduleSnapshotPersist()
}

// The unit state.params is CURRENTLY expressed in. Starts at mm (factory
// defaults); tracked so a unit sync is idempotent — re-applying the same
// unit (SPA remount, DB re-sync) never double-converts user values.
let paramsUnit = 'mm'

/**
 * Brings the in-progress form values to `toUnit` (called on unit switch AND
 * on init, when the cookie/DB preference differs from the mm factory
 * defaults). Sheets exactly matching a standard preset snap to the
 * equivalent REGIONAL standard (1000×2000 mm -> 48×96", never
 * 39.37×78.74"); custom sizes and the spacing are converted numerically
 * (0.1 mm <-> 0.004" round-trips exactly through the display trimming).
 */
function syncParamsToUnit(toUnit) {
    if (!toUnit || paramsUnit === toUnit) return
    const fromUnit = paramsUnit
    const p = state.params
    const sheets = normalizedSheets(p)
    const conv = (v) => convertInputValue(v, fromUnit, toUnit)
    const convSheet = (s) => {
        const eq = equivalentSheetPreset(s.width, s.height, fromUnit, toUnit)
        return eq ? { ...s, ...eq } : { ...s, width: conv(s.width), height: conv(s.height) }
    }
    state.params = {
        ...p,
        sheets: sheets.map(convSheet),
        space: conv(p.space),
    }
    paramsUnit = toUnit
    scheduleSnapshotPersist()
}
function removeSheet(index) {
    const sheets = normalizedSheets(state.params)
    if (sheets.length <= 1) return
    state.params = { ...state.params, sheets: sheets.filter((_, i) => i !== index) }
    scheduleSnapshotPersist()
}
/**
 * Builds the array of allowed rotation angles (in degrees) from a rotation
 * count. N rotations are spread evenly around the full circle, always
 * including 0°. Examples:
 *   1 -> [0]
 *   2 -> [0, 180]
 *   4 -> [0, 90, 180, 270]
 *   8 -> [0, 45, 90, ..., 315]
 * Clamped to [1, 360] to stay sane.
 */
function buildRotationAngles(count) {
    const n = Math.min(360, Math.max(1, Math.floor(Number(count) || 4)))
    if (n === 1) return [0]
    const step = 360 / n
    return Array.from({ length: n }, (_, i) => Math.round(i * step))
}
function increment(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count + step <= 999) {
        state.projectFiles[index].count += step
    } else {
        state.projectFiles[index].count = 999
    }
    scheduleSnapshotPersist()
}
function decrement(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count - step >= 0) {
        state.projectFiles[index].count -= step
    } else {
        state.projectFiles[index].count = 0
    }
    scheduleSnapshotPersist()
}
function updateCount(value, index) {
    if (!isValidNumber(value)) {
        state.projectFiles[index].count = 0
    } else if (Number(value) > 999) {
        state.projectFiles[index].count = 999
    } else {
        state.projectFiles[index].count = Number(value)
    }
    scheduleSnapshotPersist()
}
function updateRotation(value, index) {
    if (state.projectFiles[index]) {
        state.projectFiles[index].rotation = value
    }
    scheduleSnapshotPersist()
}
async function nest(slug) {
    // R-2 (audit 2026-08-31 §R-1) : garde de double soumission — un 2e clic
    // pendant la latence du POST passait le compteur de concurrence serveur
    // et pouvait doubler la charge de quota.
    if (state.nestBusy) return
    state.nestBusy = true
    try {
        try {
            state.nestError = ''
            state.nestUnfit = null
            state.demoQuotaReached = false
            state.sheetCapError = false
            const data = await $fetch(API_ROUTES.NEST(slug), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: state.requestBody
            })
            setModalNestData(data)
            // Refresh the cached user so the free-quota banner reflects the
            // operation that was just consumed.
            await authStore.actions.setUser()
        } catch (error) {
            if (error?.data?.statusMessage === 'capacity_exceeded') {
                // Z1 (vérif 2026-09-05) : refus 422 du pré-contrôle de
                // capacité (SANS quota consommé) — le bandeau à leviers de
                // la page prend le relais du message générique.
                state.nestUnfit = error?.data?.data?.unfit || null
                return
            }
            if (error?.data?.statusMessage === 'sheet_cap_exceeded') {
                // Server-side free sheet cap fired (client mirror bypassed).
                state.sheetCapError = true
                return
            }
            if (error?.response?.status === 402) {
                // Demo nestings draw from their own monthly quota — show the
                // dedicated message, never the subscription paywall.
                if (error?.data?.data?.reason === 'demo_quota') {
                    state.demoQuotaReached = true
                    return
                }
                // Skip the paywall dialog when paid plans are temporarily
                // disabled — it would only offer a "Coming soon" CTA.
                const paidDisabled = useRuntimeConfig().public.paidPlansDisabled === true
                if (!paidDisabled) {
                    const buyCreditsDialog = useBuyCreditsDialog();
                    buyCreditsDialog.value = true;
                }
                return
            }
            if (error?.data?.statusMessage === 'email_not_verified') {
                // Local account without a confirmed email — send the user to
                // the verification page (with a resend button).
                const router = useRouter()
                router.push({ path: '/auth/check-email' })
                return
            }
            if (error?.data?.statusMessage === 'vault_locked') {
                const vaultUnlockDialog = useVaultUnlockDialog();
                vaultUnlockDialog.value = true;
                return
            }
            // Erreur non gérée (409 concurrent_limit, 5xx…) : AVANT, on
            // tombait dans la suite de la fonction — rien à l'écran ET
            // lastParams marqué → bouton grisé jusqu'à modifier les
            // réglages à la main. Message visible + sortie propre :
            // isNewParams reste vrai, le bouton reste utilisable.
            state.nestError = error?.data?.statusMessage === 'concurrent_limit'
                ? 'nest.error.concurrent'
                : 'nest.error.generic'
            return
        }

        await Promise.all([getProjects()])

        state.lastParams = state.requestBody
    } catch (err) {
        console.error('Nest operation failed:', err)
    } finally {
        state.nestBusy = false
    }
}

/** Z1 (vérif 2026-09-05) : ferme le bandeau capacité (après action). */
function dismissNestUnfit() {
    state.nestUnfit = null
}

/** AA2 (vérif L1 2026-09-05) : appelé sur toute annulation — le bouton
 * Nest redevient actif avec les MÊMES paramètres (isNewParams repasse à
 * vrai ; sans ce reset, il fallait modifier un réglage ou recharger). */
function resetLastParams() {
    state.lastParams = ''
}

export const filesStore = readonly({
    getters: {
        projectFiles: computed(() => state.projectFiles),
        projectSlug: computed(() => state.projectSlug),
        projectName: computed(() => state.projectName),
        projectDemo: computed(() => state.projectDemo),
        projectLocal: computed(() => state.projectLocal),
        localImportError: computed(() => state.localImportError),
        filesCount: computed(() =>
            state.filesStatusDone.reduce((acc, curr) => acc + curr.count, 0)
        ),
        isNewParams: computed(() => state.requestBody !== state.lastParams),
        demoQuotaReached: computed(() => state.demoQuotaReached),
        sheetCapError: computed(() => state.sheetCapError),
        nestError: computed(() => state.nestError),
        nestUnfit: computed(() => state.nestUnfit),
        nestBusy: computed(() => state.nestBusy),
        params: computed(() => state.params),
        nestRequestError: computed(() => {
            if (filesStore.getters.filesCount < 1) {
                // Local empty IndexedDB is a state, not a form error (ux1).
                return state.projectLocal ? '' : 'project.needFiles'
            }
            if (state.isInvalidParams) {
                return 'project.invalidParams'
            }

            return ''
        })
    },
    actions: {
        setProjectFiles,
        setProjectName,
        setPendingLocalFiles,
        consumePendingLocalFiles,
        markCuratedDefaults,
        updateParams,
        updateSheet,
        addSheet,
        removeSheet,
        syncParamsToUnit,
        updateCount,
        updateRotation,
        getProject,
        increment,
        decrement,
        addFiles,
        nest,
        dismissNestUnfit,
        resetLastParams,
    }
})
