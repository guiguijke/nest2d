import { connectDB, getBucket } from '~~/server/db/mongo'
import { DEMO_OWNER_ID } from '~~/shared/constants/demo.constants'
import logger from '~~/server/utils/logger'

/**
 * D-PRV-10 / J-091 — purge 24 h du Mode Serveur (spec : specs/81-purge-24h.md).
 *
 * Stricte pour les non-vault : sources uploadées, copies canoniques,
 * previews, blobs résultats et géométries parsées disparaissent 24 h après
 * leur création (+ 1 h de grâce interne — le délai affiché reste 24 h).
 * Persistent : docs job/fichier (métadonnées) et scalaires du rapport —
 * l'historique = les rapports, pas les fichiers.
 *
 * Exemptions :
 * - vault (blobs metadata.enc / docs encPolygonParts — chiffrés au repos,
 *   clé détenue par l'utilisateur) ;
 * - démo (ownerId technique — vitrine partagée, D-PRV3) ;
 * - Mode Local : résultats déjà 100 % navigateur, rien à purger côté blobs.
 *
 * Mécanisme = sweeper (pas de TTL seul : GridFS impose le delete par bucket
 * — files+chunks — un TTL sur .files laisserait les .chunks orphelins).
 */
export const PURGE_AFTER_MS = 24 * 60 * 60 * 1000
const GRACE_MS = 60 * 60 * 1000

// Buckets balayés par ancienneté (sources, copies canoniques mm, previews).
const SOURCE_BUCKETS = ['userDxf', 'stripUserDxf', 'validDxf', 'userDxfFilesSvg', 'userSvg']

// Buckets résultats : balayage piloté par les jobs (pose purgedAt → UI
// « expiré »), puis le filet de sécurité par ancienneté attrape les
// orphelins (jobs ratés après une écriture partielle).
const RESULT_BUCKET_FOR_JOBS = {
    nesting_jobs: 'nestDxf',
    strip_nesting_job_queue: 'stripNestDxf',
}
const SVG_RESULT_BUCKET = 'nestSvg'

const FILE_COLLECTIONS = ['user_dxf_files', 'strip_user_dxf_files']
const JOB_COLLECTIONS = Object.keys(RESULT_BUCKET_FOR_JOBS)

function isPurgeableBlob(fileDoc, cutoff) {
    const md = fileDoc.metadata || {}
    return fileDoc.uploadDate < cutoff && !md.enc && md.ownerId !== DEMO_OWNER_ID
}

/** Tous les noms de blobs résultats d'un job (canonical + alternatives). */
function jobBlobNames(job) {
    const alts = Array.isArray(job.alternatives) ? job.alternatives : []
    return {
        dxfs: [
            ...(job.dxf_files || []),
            ...alts.flatMap((a) => a?.dxf_files || []),
        ],
        svgs: [
            ...(job.svg_files || []),
            ...alts.flatMap((a) => a?.svg_files || []),
        ],
    }
}

/**
 * Passe 1 — résultats pilotés par les jobs done > cutoff : supprime les
 * blobs listés par le job et pose `purgedAt` (l'UI affiche « expiré »).
 * Un job dont un blob est chiffré (vault) est intégralement exempté.
 */
async function sweepJobResults(db, jobsName, cutoff, now, deleteBlob) {
    const jobs = await db
        .collection(jobsName)
        .find({
            status: 'done',
            updatedAt: { $lt: cutoff },
            purgedAt: { $exists: false },
            ownerId: { $ne: DEMO_OWNER_ID },
        })
        .toArray()

    const dxfBucket = RESULT_BUCKET_FOR_JOBS[jobsName]
    let purged = 0
    for (const job of jobs) {
        const { dxfs, svgs } = jobBlobNames(job)
        const candidates = []
        for (const [bucket, names] of [[dxfBucket, dxfs], [SVG_RESULT_BUCKET, svgs]]) {
            if (!names.length) continue
            const docs = await db
                .collection(`${bucket}.files`)
                .find({ filename: { $in: names } })
                .toArray()
            for (const d of docs) candidates.push({ bucket, doc: d })
        }
        // Vault : le moindre blob chiffré exempte tout le job (la promesse
        // 24 h ne s'applique pas aux contenus chiffrés au repos).
        if (candidates.some((c) => c.doc.metadata?.enc)) continue

        for (const c of candidates) {
            try {
                await deleteBlob(c.bucket, c.doc._id)
            } catch (err) {
                logger.warn(`purge: blob ${c.bucket}/${c.doc.filename} skip: ${err?.message}`)
            }
        }
        await db.collection(jobsName).updateOne(
            { _id: job._id },
            { $set: { purgedAt: now } }
        )
        purged++
    }
    return purged
}

/** Passe 2 — filet de sécurité buckets : tout blob vieux, non chiffré, non
 * démo (orphelins inclus, toutes sources/copies/previews/résultats). */
async function sweepBuckets(db, cutoff, deleteBlob) {
    const names = [...SOURCE_BUCKETS, ...new Set(Object.values(RESULT_BUCKET_FOR_JOBS)), SVG_RESULT_BUCKET]
    let deleted = 0
    for (const name of names) {
        const old = await db
            .collection(`${name}.files`)
            .find({ uploadDate: { $lt: cutoff } })
            .toArray()
        for (const f of old) {
            if (!isPurgeableBlob(f, cutoff)) continue
            try {
                await deleteBlob(name, f._id)
                deleted++
            } catch (err) {
                logger.warn(`purge: blob ${name}/${f.filename} skip: ${err?.message}`)
            }
        }
    }
    return deleted
}

/** Passe 3 — géométrie parsée des docs fichiers (le doc et ses métadonnées
 * restent ; `purgedAt` pilote l'affichage « expiré » de la liste projet). */
async function sweepFileGeometry(db, collName, cutoff, now) {
    const docs = await db
        .collection(collName)
        .find({
            uploadAt: { $lt: cutoff },
            ownerId: { $ne: DEMO_OWNER_ID },
            encPolygonParts: { $exists: false },
            polygonParts: { $exists: true },
        })
        .toArray()
    let cleaned = 0
    for (const d of docs) {
        await db.collection(collName).updateOne(
            { _id: d._id },
            { $unset: { polygonParts: '' }, $set: { purgedAt: now } }
        )
        cleaned++
    }
    return cleaned
}

/** Passe 4 — artefacts éphémères de jobs (tous users, vault incluse :
 * localPayload contient l'instance en clair, liveLayout une géométrie —
 * transports/snapshots sans valeur après le job ; piège #18 étendu aux
 * jobs orphelins qui n'ont jamais reçu le $unset final). */
async function sweepJobArtifacts(db, jobsName, cutoff) {
    const stale = await db
        .collection(jobsName)
        .find({
            updatedAt: { $lt: cutoff },
            $or: [
                { localPayload: { $exists: true } },
                { liveLayout: { $exists: true } },
                { itemMap: { $exists: true } },
            ],
        })
        .toArray()
    let cleaned = 0
    for (const j of stale) {
        await db.collection(jobsName).updateOne(
            { _id: j._id },
            { $unset: { localPayload: '', liveLayout: '', itemMap: '', progress: '', compute: '' } }
        )
        cleaned++
    }
    return cleaned
}

/**
 * Un run de purge. Injectable pour les tests (fakeDb + deleteBlob factice).
 * @param {{now?: Date, db?: any, deleteBlob?: (bucket: string, id: any) => Promise<void>}} opts
 */
export async function runPurgeOnce({ now = new Date(), db = null, deleteBlob = null } = {}) {
    db = db || (await connectDB())
    deleteBlob = deleteBlob || (async (bucket, id) => (await getBucket(bucket)).delete(id))
    const cutoff = new Date(now.getTime() - PURGE_AFTER_MS - GRACE_MS)

    const report = { jobs: 0, blobs: 0, fileDocs: 0, artifacts: 0 }
    for (const jobsName of JOB_COLLECTIONS) {
        report.jobs += await sweepJobResults(db, jobsName, cutoff, now, deleteBlob)
    }
    report.blobs += await sweepBuckets(db, cutoff, deleteBlob)
    for (const collName of FILE_COLLECTIONS) {
        report.fileDocs += await sweepFileGeometry(db, collName, cutoff, now)
    }
    for (const jobsName of JOB_COLLECTIONS) {
        report.artifacts += await sweepJobArtifacts(db, jobsName, cutoff)
    }
    logger.info(`purge: ${JSON.stringify(report)}`)
    return report
}
