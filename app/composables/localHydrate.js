/**
 * J-082 : hydratation des jobs locaux — l'UI (cartes, modal, vue live) lit
 * le job SERVEUR pour la liste/statut, et les artefacts depuis IndexedDB
 * pour les jobs `localOnly` (géométrie jamais servie par le serveur, J-077).
 * Les URLs servies sont des data:/blob: URLs construites depuis le record —
 * aucune requête géométrie sortante.
 */
import { listLocalResults } from './localResultsStore'
import { isLocalComputeEnabled } from './localCompute'

/** Cache par session : slug → record (les artefacts sont lourds, une seule
 * lecture IndexedDB par slug ; les records ne changent qu'au solve). */
let recordsBySlug = null
let loadPromise = null

export async function loadLocalRecords(force = false) {
    if (recordsBySlug && !force) return recordsBySlug
    loadPromise = loadPromise || listLocalResults()
        .then((records) => {
            const map = {}
            for (const r of records || []) {
                if (r?.slug) map[r.slug] = r
            }
            recordsBySlug = map
            return map
        })
        .catch(() => {
            // IndexedDB indisponible : rien à hydrater, jamais de crash UI.
            recordsBySlug = {}
            return {}
        })
        .finally(() => { loadPromise = null })
    return loadPromise
}

/** Force un rechargement au prochain appel (nouveau solve terminé). */
export function invalidateLocalRecords() {
    recordsBySlug = null
}

export function getLocalRecord(slug) {
    return recordsBySlug?.[slug] || null
}

/** SVG texte → data URI (aperçus <img> sans blob à révoquer). */
export function svgToDataUri(svg) {
    return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`
}

/** Handles DXF uniques (hex). ezdxf réassigne à chaque copie ; notre writer
 * historique répétait le handle source — dxf-viewer indexe par handle et
 * peut lever sur un gros job (100+ copies). */
export function uniquifyDxfHandles(dxf) {
    if (typeof dxf !== 'string' || !dxf) return dxf
    const lines = dxf.split(/\r\n|\r|\n/)
    let n = 1
    for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim() === '5') {
            lines[i + 1] = (n++).toString(16).toUpperCase()
        }
    }
    return lines.join('\n')
}

/** Contenu DXF → blob: URL (DxfViewerComponent fetch l'URL). Les URLs sont
 * créées paresseusement et mises en cache — R-8 (audit 2026-08-31 §R-7) :
 * le cache était NON BORNÉ et indexé par le TEXTE DXF complet (clé de
 * plusieurs Mo retenue pour toute la session, blob jamais révoqué). Cap
 * LRU : l'entrée la moins récemment utilisée est révoquée — une URL
 * réutilisée ensuite est recréée proprement (nouvelle entrée, nouveau
 * blob), le seul effet visible est un re-fetch du viewer. */
const BLOB_URL_MAX = 24
const blobUrls = new Map()
export function dxfToBlobUrl(content) {
    const text = uniquifyDxfHandles(typeof content === 'string' ? content : String(content || ''))
    if (blobUrls.has(text)) {
        // Réutilisation = plus récent (ordre LRU par insertion).
        const url = blobUrls.get(text)
        blobUrls.delete(text)
        blobUrls.set(text, url)
        return url
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/dxf' }))
    blobUrls.set(text, url)
    while (blobUrls.size > BLOB_URL_MAX) {
        const [evictText, evictUrl] = blobUrls.entries().next().value
        blobUrls.delete(evictText)
        try {
            URL.revokeObjectURL(evictUrl)
        } catch {
            // déjà révoquée — sans conséquence
        }
    }
    return url
}

/**
 * Fusionne un item de la liste SSE avec son record IndexedDB quand il existe
 * (job `localOnly`). Renvoie l'item inchangé sinon. Forme produite = celle
 * de resultcontroller.js, avec en plus `isLocal` et le record.
 */
export function hydrateLocalItem(item, record = null) {
    if (!item) return item
    const rec = record ?? getLocalRecord(item.slug)
    // Hydratable seulement si le record porte de vraies alternatives — un
    // vieux record v1 (sans artefacts) laisse le job serveur faire foi.
    if (!rec || !Array.isArray(rec.alternatives) || !rec.alternatives.length) return item
    const alternatives = rec.alternatives.map((alt) => ({
        altId: alt.altId ?? 0,
        seed: alt.seed != null ? String(alt.seed) : null,
        density: alt.density ?? null,
        usedSheetShare: alt.usedSheetShare ?? null,
        strategy: alt.strategy ?? null,
        offcut: alt.offcut ?? null,
        layoutCount: alt.layoutCount ?? 0,
        report: alt.report ?? null,
        svgs: (alt.svgs || []).filter((s) => typeof s === 'string').map(svgToDataUri),
        dxfs: (alt.dxfs || []).filter((d) => d?.content).map((d) => dxfToBlobUrl(d.content)),
    }))
    return {
        ...item,
        isLocal: true,
        localRecord: rec,
        // AC6 (L2-ter) : compteur des options écartées (miroir du champ
        // serveur) pour le badge replié du modal.
        discardedCount: Array.isArray(rec.discardedAlternatives)
            ? rec.discardedAlternatives.length
            : 0,
        svgs: alternatives[0]?.svgs || [],
        alternatives,
        isMultiSheet: (alternatives[0]?.layoutCount ?? 0) > 1,
        // Marqueur : les boutons de téléchargement passent par localDownloads
        // (contenus persistés, zéro réseau), jamais par une URL serveur.
        downloadUrl: `local:${item.slug}`,
        zipDownloadUrl: (alternatives[0]?.layoutCount ?? 0) > 1 ? `local:${item.slug}` : null,
    }
}

/** Hydrate une liste entière (SSE initial/update). Le mapper SSE ne porte
 * pas de marqueur local (contrat serveur inchangé) : la source de vérité
 * est le record IndexedDB — un record n'existe qu'après un solve local
 * réussi de CE slug. */
export async function hydrateLocalItems(items) {
    if (!Array.isArray(items) || !items.length) return items
    if (!isLocalComputeEnabled()) return items
    await loadLocalRecords()
    if (!recordsBySlug || !Object.keys(recordsBySlug).length) return items
    return items.map((i) => (i && getLocalRecord(i.slug) ? hydrateLocalItem(i) : i))
}
