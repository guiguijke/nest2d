/**
 * PR5 (Mode Local productisé, J-077) : stockage des résultats de nesting
 * 100 % navigateur (IndexedDB, par projet). La géométrie ne quitte JAMAIS le
 * navigateur : le serveur ne reçoit que la comptabilité (local-quota).
 *
 * Schéma : store `results` keyPath `slug` (v2, J-082 — record riche pour le
 * rendu et les téléchargements hors-ligne) :
 *   { slug, projectSlug, createdAt, problem, isSpp, sheets, requested,
 *     placed, alternatives: [{altId, seed, strategy, density, layoutCount,
 *     offcut, report, svgs: [SVG texte], dxfs: [{fileName, content}]}],
 *     liveLayout, meta }
 * Les records v1 (sans artefacts exploitables) sont simplement ignorés par
 * l'hydratation — aucune migration de contenu nécessaire.
 * Purge alignée sur la rétention serveur : `purgeProject` appelé à la
 * suppression d'un projet ; `prune` borne le nombre de résultats conservés.
 *
 * Aucune dépendance — API IndexedDB native. Jamais appelé côté serveur (SSR).
 */

const DB_NAME = 'nestorcut-local'
const DB_VERSION = 2
const STORE = 'results'
const MAX_RESULTS_PER_PROJECT = 20

let dbPromise = null

function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexeddb_unavailable'))
    dbPromise = dbPromise || new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'slug' })
                store.createIndex('projectSlug', 'projectSlug', { unique: false })
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
    // Un échec (navigation privée, quota) ne doit pas être caché pour
    // toujours : remettre à null permet de retenter au prochain appel.
    dbPromise.catch(() => { dbPromise = null })
    return dbPromise
}

function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE)
}

export async function saveLocalResult(record) {
    const db = await openDb()
    await new Promise((resolve, reject) => {
        const r = tx(db, 'readwrite').put(record)
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
    })
    await prune(record.projectSlug)
}

export async function getLocalResult(slug) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const r = tx(db, 'readonly').get(slug)
        r.onsuccess = () => resolve(r.result || null)
        r.onerror = () => reject(r.error)
    })
}

export async function listLocalResults(projectSlug) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const r = projectSlug == null
            ? tx(db, 'readonly').getAll()
            : tx(db, 'readonly').index('projectSlug').getAll(projectSlug)
        r.onsuccess = () => resolve(r.result || [])
        r.onerror = () => reject(r.error)
    })
}

export async function purgeProject(projectSlug) {
    const db = await openDb()
    const all = projectSlug == null ? [] : await listLocalResults(projectSlug)
    await Promise.all(all.map((rec) => new Promise((resolve) => {
        const r = tx(db, 'readwrite').delete(rec.slug)
        r.onsuccess = () => resolve()
        r.onerror = () => resolve()
    })))
}

async function prune(projectSlug) {
    const all = await listLocalResults(projectSlug)
    if (all.length <= MAX_RESULTS_PER_PROJECT) return
    const db = await openDb()
    const sorted = [...all].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    const excess = sorted.slice(0, all.length - MAX_RESULTS_PER_PROJECT)
    await Promise.all(excess.map((rec) => new Promise((resolve) => {
        const r = tx(db, 'readwrite').delete(rec.slug)
        r.onsuccess = () => resolve()
        r.onerror = () => resolve()
    })))
}
