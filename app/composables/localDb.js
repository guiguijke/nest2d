/**
 * J-090 : point d'accès UNIQUE à la base IndexedDB `nestorcut-local`.
 * Plusieurs modules (résultats locaux, fichiers locaux) partagent la même
 * DB : une seule fonction openDb() versionnée évite les conflits d'upgrade
 * (deux ouvertures de la même base avec des versions différentes = blocage
 * ou écrasement silencieux du schéma).
 *
 * Schéma v3 :
 *   - store `results` (keyPath `slug`, index `projectSlug`) — J-077/J-082 ;
 *   - store `files`   (keyPath `slug`, index `projectSlug`) — J-090 : DXF
 *     canonique mm + géométrie parsée des projets 100 % navigateur.
 * L'upgrade v1/v2 → v3 préserve `results` (createObjectStore seulement si
 * le store est absent — jamais de migration de contenu).
 *
 * Jamais appelé côté serveur (SSR) : aucun accès IndexedDB au top level.
 */

export const DB_NAME = 'nestorcut-local'
export const DB_VERSION = 3

const STORES = ['results', 'files']

let dbPromise = null

export function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexeddb_unavailable'))
    dbPromise = dbPromise || new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
            const db = req.result
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name, { keyPath: 'slug' })
                        .createIndex('projectSlug', 'projectSlug', { unique: false })
                }
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
