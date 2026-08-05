/**
 * Client-side vault key management. The DEK is generated in the browser,
 * never stored server-side, and optionally kept in IndexedDB ("remember this
 * browser") — it is only sent to the server on explicit unlock/enable calls.
 */

const IDB_NAME = 'nest2d-vault'
const IDB_STORE = 'keys'
const IDB_KEY = 'dek'

export function generateVaultKey() {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    return key
}

export function keyToBase64(keyBytes) {
    let binary = ''
    for (const byte of keyBytes) binary += String.fromCharCode(byte)
    return btoa(binary)
}

export function base64ToKey(base64) {
    const binary = atob(base64)
    const key = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) key[i] = binary.charCodeAt(i)
    return key
}

export function buildKeyFile(keyBytes, keyId) {
    return {
        name: `nestorcut-vault-${keyId}.key.json`,
        content: JSON.stringify(
            {
                type: 'nestorcut-vault-key',
                version: 1,
                keyId,
                key: keyToBase64(keyBytes),
                createdAt: new Date().toISOString(),
            },
            null,
            2
        ),
    }
}

export function downloadKeyFile(keyFile) {
    const blob = new Blob([keyFile.content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = keyFile.name
    link.click()
    URL.revokeObjectURL(url)
}

/**
 * Parses and validates a .key.json file. Returns the 32-byte key.
 * Throws on any format problem.
 */
export async function parseKeyFile(file) {
    const text = await file.text()
    let parsed
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error('This file is not a valid NestorCut key file.')
    }
    const validTypes = ['nestorcut-vault-key', 'aplasma-vault-key', 'nest2d-vault-key'] // aplasma/nest2d = legacy brands
    if (!validTypes.includes(parsed?.type) || !parsed?.key) {
        throw new Error('This file is not a valid NestorCut key file.')
    }
    const key = base64ToKey(parsed.key)
    if (key.length !== 32) {
        throw new Error('This key file is corrupted (invalid key length).')
    }
    return key
}

// ---------- IndexedDB ("remember this browser") ----------

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, 1)
        request.onupgradeneeded = () => {
            request.result.createObjectStore(IDB_STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export async function rememberKeyInBrowser(keyBase64) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).put(keyBase64, IDB_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}

export async function getRememberedKey() {
    try {
        const db = await openDb()
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly')
            const request = tx.objectStore(IDB_STORE).get(IDB_KEY)
            request.onsuccess = () => resolve(request.result || null)
            request.onerror = () => reject(request.error)
        })
    } catch {
        return null
    }
}

export async function forgetRememberedKey() {
    try {
        const db = await openDb()
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite')
            tx.objectStore(IDB_STORE).delete(IDB_KEY)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch {
        // Nothing to forget.
    }
}
