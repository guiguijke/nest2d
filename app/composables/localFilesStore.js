/**
 * J-090 (import 100 % navigateur) : stockage IndexedDB des FICHIERS d'un
 * projet « local ». Un projet local ne voit JAMAIS ses fichiers uploadés :
 * le parsing DXF/SVG tourne dans le navigateur (bundle wasm géométrie) et
 * tout ce qui suit vit ici — DXF canonique mm (piège #31 : l'aval est
 * format-agnostique) + géométrie parsée (polygonParts navigateur).
 *
 * Record (store `files`, keyPath `slug`, index `projectSlug`) :
 *   { slug,          // identifiant opaque `f-{12 hex}{ext}` — le nom
 *                    // d'origine ne transite jamais (ni slug, ni nest)
 *     projectSlug,
 *     name,          // nom d'origine du fichier (IndexedDB seulement)
 *     addedAt,       // ISO string (tri chronologique = tri lexicographique)
 *     dxfBytes,      // ArrayBuffer — DXF canonique mm (ou bytes d'origine
 *                    // si déjà mm)
 *     parts: [{ coordinates: [[x,y]...], holes: [...], width, height,
 *               handles: [...], color: '#rrggbb' }],
 *     sourceUnits,   // code $INSUNITS source (0 = sans unité)
 *     entityCount,
 *     warnings: [] }
 *
 * Ouverture de la base partagée via localDb.js (un seul openDb versionné).
 * Jamais appelé côté serveur (SSR) : aucun accès IndexedDB au top level.
 */
import { openDb } from './localDb'

const STORE = 'files'

function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE)
}

/**
 * Identifiant opaque d'un fichier 100 % privé. L'extension d'origine est
 * conservée (DXF vs SVG) ; le nom de fichier n'entre pas dans le slug —
 * celui-ci part au nest comme clé IndexedDB, pas comme libellé.
 */
export function makeLocalFileSlug(fileName) {
    const name = String(fileName || '')
    const dotIndex = name.lastIndexOf('.')
    const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : ''
    const kept = ext === '.svg' ? '.svg' : '.dxf'
    const rand = [...crypto.getRandomValues(new Uint8Array(8))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return `f-${rand}${kept}`
}

/** Enregistre (ou remplace) un fichier local. */
export async function saveLocalFile(record) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const r = tx(db, 'readwrite').put(record)
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
    })
}

export async function getLocalFile(slug) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const r = tx(db, 'readonly').get(slug)
        r.onsuccess = () => resolve(r.result || null)
        r.onerror = () => reject(r.error)
    })
}

/** Fichiers d'un projet, triés par date d'ajout (addedAt ISO croissant). */
export async function listLocalFiles(projectSlug) {
    const db = await openDb()
    const all = await new Promise((resolve, reject) => {
        const r = projectSlug == null
            ? tx(db, 'readonly').getAll()
            : tx(db, 'readonly').index('projectSlug').getAll(projectSlug)
        r.onsuccess = () => resolve(r.result || [])
        r.onerror = () => reject(r.error)
    })
    return [...all].sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')))
}

export async function deleteLocalFile(slug) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const r = tx(db, 'readwrite').delete(slug)
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
    })
}

/** Purge alignée sur la rétention serveur : appelée à la suppression d'un
 * projet (miroir de purgeProject côté résultats). */
export async function purgeProjectFiles(projectSlug) {
    const db = await openDb()
    const all = projectSlug == null ? [] : await listLocalFiles(projectSlug)
    await Promise.all(all.map((rec) => new Promise((resolve) => {
        const r = tx(db, 'readwrite').delete(rec.slug)
        r.onsuccess = () => resolve()
        r.onerror = () => resolve()
    })))
}

/** Somme des octets stockés (dxfBytes) — garde-fou quota navigateur. */
export async function localFilesBytes(projectSlug) {
    const all = await listLocalFiles(projectSlug)
    return all.reduce((total, rec) => total + (rec?.dxfBytes?.byteLength || 0), 0)
}
