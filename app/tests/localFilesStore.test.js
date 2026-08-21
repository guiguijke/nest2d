import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// IndexedDB factice en memoire (fake-indexeddb n'est PAS dans les deps — pas
// d'installation ajoutee). Couvre exactement la surface utilisee par
// localDb/localFilesStore/localResultsStore : open(name, version) +
// onupgradeneeded/onsuccess/onerror, objectStoreNames.contains,
// createObjectStore/createIndex, transaction().objectStore(),
// put/get/delete/getAll, index().getAll(key). Requetes resolues en microtask
// (asynchrone comme la vraie API). Persistance entre open() successifs pour
// tester l'upgrade v2 → v3.
// ---------------------------------------------------------------------------

function createFakeIndexedDB() {
    const dbs = new Map() // name → { version, stores: Map(name → store) }

    const makeRequest = () => {
        const req = {}
        req._resolve = (result) => {
            req.result = result
            queueMicrotask(() => req.onsuccess?.())
        }
        req._reject = (error) => {
            req.error = error
            queueMicrotask(() => req.onerror?.())
        }
        return req
    }

    const makeStoreHandle = (store) => {
        const wrap = (fn) => {
            const req = makeRequest()
            queueMicrotask(() => {
                try {
                    req.result = fn()
                    req.onsuccess?.()
                } catch (error) {
                    req.error = error
                    req.onerror?.()
                }
            })
            return req
        }
        return {
            put: (record) => wrap(() => {
                store.data.set(record[store.keyPath], record)
                return undefined
            }),
            get: (key) => wrap(() => store.data.get(key)),
            delete: (key) => wrap(() => {
                store.data.delete(key)
                return undefined
            }),
            getAll: () => wrap(() => [...store.data.values()]),
            index: (indexName) => ({
                getAll: (key) => wrap(() => {
                    const field = store.indexes.get(indexName)
                    return [...store.data.values()].filter((rec) => rec?.[field] === key)
                }),
            }),
        }
    }

    const makeDbHandle = (db) => ({
        objectStoreNames: { contains: (name) => db.stores.has(name) },
        createObjectStore: (name, options) => {
            const store = {
                keyPath: options?.keyPath,
                data: new Map(),
                indexes: new Map(),
            }
            db.stores.set(name, store)
            return {
                createIndex: (indexName, keyPath) => {
                    store.indexes.set(indexName, keyPath)
                },
            }
        },
        transaction: (storeName) => ({
            objectStore: (name) => makeStoreHandle(db.stores.get(name)),
        }),
    })

    const open = (name, version) => {
        const req = makeRequest()
        queueMicrotask(() => {
            let db = dbs.get(name)
            if (!db) {
                db = { version: 0, stores: new Map() }
                dbs.set(name, db)
            }
            const needsUpgrade = version > db.version
            if (needsUpgrade) {
                req.result = makeDbHandle(db)
                req.onupgradeneeded?.()
                db.version = version
            }
            req.result = makeDbHandle(db)
            req.onsuccess?.()
        })
        return req
    }

    // Seme une base a une version anterieure (test d'upgrade) :
    // { storeName: [records] } avec index projectSlug implicite.
    open._seed = (name, version, storesWithRecords) => {
        const db = { version, stores: new Map() }
        for (const [storeName, records] of Object.entries(storesWithRecords)) {
            const store = {
                keyPath: 'slug',
                data: new Map(records.map((r) => [r.slug, r])),
                indexes: new Map([['projectSlug', 'projectSlug']]),
            }
            db.stores.set(storeName, store)
        }
        dbs.set(name, db)
    }

    return { open }
}

// Modules recharges a chaque test : dbPromise est memoisee au niveau module.
let localDb
let filesStore
let resultsStore

beforeEach(async () => {
    vi.resetModules()
    globalThis.indexedDB = createFakeIndexedDB()
    localDb = await import('../composables/localDb')
    filesStore = await import('../composables/localFilesStore')
    resultsStore = await import('../composables/localResultsStore')
})

const makeFile = (over = {}) => ({
    slug: over.slug || `part-${Math.random().toString(16).slice(2, 8)}.dxf`,
    projectSlug: 'proj-1',
    name: 'part.dxf',
    addedAt: '2026-08-10T10:00:00.000Z',
    dxfBytes: new ArrayBuffer(16),
    parts: [{
        coordinates: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        holes: [], width: 10, height: 10, handles: ['A1'], color: '#2563EB',
    }],
    sourceUnits: 4,
    entityCount: 3,
    warnings: [],
    ...over,
})

describe('localDb — ouverture partagee', () => {
    it('cree les DEUX stores (results + files) a l\'ouverture', async () => {
        const db = await localDb.openDb()
        expect(db.objectStoreNames.contains('results')).toBe(true)
        expect(db.objectStoreNames.contains('files')).toBe(true)
    })

    it('upgrade v2 → v3 : le store results et ses donnees sont preserves', async () => {
        // Une base v2 existante avec un resultat stocke.
        globalThis.indexedDB.open._seed('nestorcut-local', 2, {
            results: [{ slug: 'job-1', projectSlug: 'proj-1', createdAt: 1 }],
        })
        const results = await resultsStore.listLocalResults('proj-1')
        expect(results).toEqual([{ slug: 'job-1', projectSlug: 'proj-1', createdAt: 1 }])
        // Le nouveau store files est utilisable.
        await filesStore.saveLocalFile(makeFile({ slug: 'f-1.dxf' }))
        expect((await filesStore.getLocalFile('f-1.dxf'))?.slug).toBe('f-1.dxf')
    })

    it('indexedDB absent (SSR) → rejet indexeddb_unavailable', async () => {
        vi.resetModules()
        delete globalThis.indexedDB
        const db = await import('../composables/localDb')
        await expect(db.openDb()).rejects.toThrow('indexeddb_unavailable')
    })
})

describe('localFilesStore', () => {
    it('save/get/list — tri par addedAt croissant', async () => {
        await filesStore.saveLocalFile(makeFile({ slug: 'b.dxf', addedAt: '2026-08-10T10:02:00.000Z' }))
        await filesStore.saveLocalFile(makeFile({ slug: 'a.dxf', addedAt: '2026-08-10T10:01:00.000Z' }))
        await filesStore.saveLocalFile(makeFile({ slug: 'c.dxf', projectSlug: 'proj-2', addedAt: '2026-08-10T10:00:30.000Z' }))
        const list = await filesStore.listLocalFiles('proj-1')
        expect(list.map((f) => f.slug)).toEqual(['a.dxf', 'b.dxf'])
        expect((await filesStore.getLocalFile('b.dxf'))?.name).toBe('part.dxf')
        expect(await filesStore.getLocalFile('absent.dxf')).toBeNull()
    })

    it('saveLocalFile remplace un record existant (meme slug)', async () => {
        await filesStore.saveLocalFile(makeFile({ slug: 'a.dxf', entityCount: 3 }))
        await filesStore.saveLocalFile(makeFile({ slug: 'a.dxf', entityCount: 7 }))
        expect((await filesStore.getLocalFile('a.dxf'))?.entityCount).toBe(7)
        expect(await filesStore.listLocalFiles('proj-1')).toHaveLength(1)
    })

    it('deleteLocalFile ne touche qu\'au slug vise', async () => {
        await filesStore.saveLocalFile(makeFile({ slug: 'a.dxf' }))
        await filesStore.saveLocalFile(makeFile({ slug: 'b.dxf' }))
        await filesStore.deleteLocalFile('a.dxf')
        expect(await filesStore.getLocalFile('a.dxf')).toBeNull()
        expect((await filesStore.listLocalFiles('proj-1')).map((f) => f.slug)).toEqual(['b.dxf'])
    })

    it('purgeProjectFiles vide le projet sans toucher aux autres', async () => {
        await filesStore.saveLocalFile(makeFile({ slug: 'a.dxf' }))
        await filesStore.saveLocalFile(makeFile({ slug: 'b.dxf' }))
        await filesStore.saveLocalFile(makeFile({ slug: 'c.dxf', projectSlug: 'proj-2' }))
        await filesStore.purgeProjectFiles('proj-1')
        expect(await filesStore.listLocalFiles('proj-1')).toEqual([])
        expect((await filesStore.listLocalFiles('proj-2')).map((f) => f.slug)).toEqual(['c.dxf'])
    })

    it('localFilesBytes somme les dxfBytes (garde-fou quota)', async () => {
        await filesStore.saveLocalFile(makeFile({ slug: 'a.dxf', dxfBytes: new ArrayBuffer(100) }))
        await filesStore.saveLocalFile(makeFile({ slug: 'b.dxf', dxfBytes: new ArrayBuffer(250) }))
        await filesStore.saveLocalFile(makeFile({ slug: 'c.dxf', projectSlug: 'proj-2', dxfBytes: new ArrayBuffer(5) }))
        expect(await filesStore.localFilesBytes('proj-1')).toBe(350)
        expect(await filesStore.localFilesBytes('proj-2')).toBe(5)
        expect(await filesStore.localFilesBytes('proj-vide')).toBe(0)
    })

    it('makeLocalFileSlug : identifiant opaque, nom d origine absent', () => {
        const slug = filesStore.makeLocalFileSlug('Héllo Wörld 42!.DXF')
        expect(slug).toMatch(/^f-[0-9a-f]{12}\.dxf$/)
        expect(slug).not.toMatch(/hello|world|42/i)
        expect(filesStore.makeLocalFileSlug('my part.svg')).toMatch(/^f-[0-9a-f]{12}\.svg$/)
        expect(filesStore.makeLocalFileSlug('x.dxf')).not.toBe(filesStore.makeLocalFileSlug('x.dxf'))
    })
})

describe('localResultsStore — regression apres refactor (openDb partage)', () => {
    it('save/get/list/purge inchanges', async () => {
        await resultsStore.saveLocalResult({ slug: 'j1', projectSlug: 'p1', createdAt: 1 })
        await resultsStore.saveLocalResult({ slug: 'j2', projectSlug: 'p1', createdAt: 2 })
        await resultsStore.saveLocalResult({ slug: 'j3', projectSlug: 'p2', createdAt: 3 })
        expect((await resultsStore.getLocalResult('j1'))?.slug).toBe('j1')
        expect((await resultsStore.listLocalResults('p1')).map((r) => r.slug).sort()).toEqual(['j1', 'j2'])
        expect(await resultsStore.listLocalResults()).toHaveLength(3)
        await resultsStore.purgeProject('p1')
        expect(await resultsStore.listLocalResults('p1')).toEqual([])
        expect(await resultsStore.listLocalResults('p2')).toHaveLength(1)
    })

    it('prune : au plus 20 resultats par projet, les plus anciens evinces', async () => {
        for (let i = 1; i <= 25; i++) {
            await resultsStore.saveLocalResult({ slug: `j${i}`, projectSlug: 'p1', createdAt: i })
        }
        const kept = await resultsStore.listLocalResults('p1')
        expect(kept).toHaveLength(20)
        expect(kept.map((r) => r.createdAt).sort((a, b) => a - b)).toEqual(
            Array.from({ length: 20 }, (_, i) => i + 6),
        )
    })
})
