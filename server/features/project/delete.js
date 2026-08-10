// Imports RELATIFS (pas d'alias ~~/) : même discipline que
// server/features/purge/sweep.js — le code métier chargé hors du pipeline
// Nitro (tests, plugins au boot) ne résout pas les alias.
import { createError } from 'h3'
import { connectDB, getBucket } from '../../db/mongo'
import logger from '../../utils/logger'

/**
 * Suppression d'un projet et de toutes ses données (cascade), déclenchée
 * par le propriétaire. Immédiate et irréversible.
 *
 * Garde-fous :
 * - 404 si le projet n'existe pas OU appartient à un autre utilisateur —
 *   l'existence d'un projet étranger n'est jamais révélée ;
 * - 403 si le projet est un démo (isDemo) — vitrine en lecture seule,
 *   jamais supprimable ;
 * - 409 `jobs_in_progress` si un job du projet est pending / processing /
 *   awaiting_local — supprimer sous un calcul en cours laisserait des
 *   écritures orphelines (worker ou navigateur).
 *
 * Cascade (chaque volume compté et journalisé) :
 * 1. blobs résultats de tous les jobs (dxf_files + svg_files, canonical et
 *    alternatives) dans les buckets résultats du domaine ;
 * 2. blobs sources (nom = slug du fichier) dans le bucket d'upload du
 *    domaine ET dans validDxf (copie canonique mm) ;
 * 3. previews (svgFileSlug) dans userDxfFilesSvg ;
 * 4. docs fichiers, 5. docs jobs, 6. doc projet (EN DERNIER — un retry
 *    après échec partiel doit pouvoir rejouer la cascade).
 *
 * Les blobs vault (metadata.enc) sont supprimés comme les autres : le
 * crypto-shredding n'a pas besoin de la DEK. Un blob manquant ou un delete
 * GridFS en échec n'interrompt PAS la cascade (warn + on continue, miroir
 * du sweeper purge — le filet de sécurité 24 h attrape les reliquats), donc
 * la route est idempotente : un rappel sur un projet déjà supprimé = 404.
 *
 * Projet `local: true` (J-090) : aucun fichier côté serveur — les étapes
 * blobs/fichiers trouvent simplement des collections vides ; les résultats
 * locaux vivent dans IndexedDB et sont purgés par le frontend.
 *
 * @param {object} domain entrée DOMAINS (server/core/domains.js)
 * @param {string} userId propriétaire (déjà authentifié par la route)
 * @param {string} slug slug du projet
 * @returns {Promise<{files: number, jobs: number, blobs: number}>}
 */

const ACTIVE_JOB_STATUSES = ['pending', 'processing', 'awaiting_local']

// Buckets résultats (hors registry domains.js) : le bucket DXF est par
// domaine, le bucket SVG est partagé — miroir de features/purge/sweep.js.
const RESULT_DXF_BUCKET = { bin: 'nestDxf', strip: 'stripNestDxf' }
const RESULT_SVG_BUCKET = 'nestSvg'
// Copie canonique mm et previews : partagées par les deux domaines.
const VALID_DXF_BUCKET = 'validDxf'
const PREVIEW_BUCKET = 'userDxfFilesSvg'

/** Tous les noms de blobs résultats d'un job (canonical + alternatives). */
function jobBlobNames(job) {
    const alts = Array.isArray(job.alternatives) ? job.alternatives : []
    return {
        dxfs: [...(job.dxf_files || []), ...alts.flatMap((a) => a?.dxf_files || [])],
        svgs: [...(job.svg_files || []), ...alts.flatMap((a) => a?.svg_files || [])],
    }
}

/**
 * Supprime PAR NOM chaque version d'un blob (les blobs GridFS n'ont pas de
 * projectSlug — metadata.ownerId seulement — donc find({filename}) puis
 * delete(_id) pour chaque version). Un échec (blob déjà parti, erreur
 * GridFS) est journalisé et n'interrompt pas la cascade.
 */
async function deleteBlobsByName(bucketName, names, counters) {
    if (!names.size) return
    const bucket = await getBucket(bucketName)
    for (const filename of names) {
        let docs
        try {
            docs = await bucket.find({ filename }).toArray()
        } catch (err) {
            logger.warn(`project delete: list ${bucketName}/${filename} failed: ${err?.message || err}`)
            continue
        }
        for (const doc of docs) {
            try {
                await bucket.delete(doc._id)
                counters.blobs++
            } catch (err) {
                logger.warn(`project delete: blob ${bucketName}/${filename} skip: ${err?.message || err}`)
            }
        }
    }
}

export async function deleteProjectCascade(domain, userId, slug) {
    const resultDxfBucket = RESULT_DXF_BUCKET[domain.id]
    if (!resultDxfBucket) {
        throw new Error(`deleteProjectCascade: unknown domain '${domain.id}'`)
    }

    const db = await connectDB()

    // 404 pour inexistant ET pour projet étranger — jamais révéler
    // l'existence. La démo partagée (ownerId technique) tombe donc en 404
    // pour tout utilisateur ; un doc isDemo possédé tombe en 403 ci-dessous.
    const project = await db.collection(domain.projectsCollection).findOne({ slug })
    if (!project || project.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: `${domain.projectLabel} not found` })
    }
    if (project.isDemo) {
        throw createError({ statusCode: 403, statusMessage: 'Demo project cannot be deleted' })
    }

    // Un calcul en cours (worker ou navigateur) écrirait dans un projet
    // disparu — refus explicite plutôt que des écritures orphelines.
    const activeJob = await db.collection(domain.jobsCollection).findOne({
        [domain.projectSlugField]: slug,
        status: { $in: ACTIVE_JOB_STATUSES },
    })
    if (activeJob) {
        throw createError({ statusCode: 409, statusMessage: 'jobs_in_progress' })
    }

    const counters = { files: 0, jobs: 0, blobs: 0 }

    // 1. Blobs résultats de tous les jobs du projet.
    const jobs = await db
        .collection(domain.jobsCollection)
        .find({ [domain.projectSlugField]: slug })
        .toArray()
    const resultDxfNames = new Set()
    const resultSvgNames = new Set()
    for (const job of jobs) {
        const { dxfs, svgs } = jobBlobNames(job)
        for (const n of dxfs) resultDxfNames.add(n)
        for (const n of svgs) resultSvgNames.add(n)
    }
    await deleteBlobsByName(resultDxfBucket, resultDxfNames, counters)
    await deleteBlobsByName(RESULT_SVG_BUCKET, resultSvgNames, counters)

    // 2 + 3. Sources (upload + copie canonique mm) et previews.
    const files = await db
        .collection(domain.filesCollection)
        .find({ [domain.projectSlugField]: slug })
        .toArray()
    for (const file of files) {
        await deleteBlobsByName(domain.dxfBucket, new Set([file.slug]), counters)
        await deleteBlobsByName(VALID_DXF_BUCKET, new Set([file.slug]), counters)
        if (file.svgFileSlug) {
            await deleteBlobsByName(PREVIEW_BUCKET, new Set([file.svgFileSlug]), counters)
        }
    }

    // 4-6. Documents : fichiers, jobs, puis le projet EN DERNIER (tout
    // l'amont le référence ; un retry rejoue une cascade déjà vide).
    const filesResult = await db
        .collection(domain.filesCollection)
        .deleteMany({ [domain.projectSlugField]: slug, ownerId: userId })
    const jobsResult = await db
        .collection(domain.jobsCollection)
        .deleteMany({ [domain.projectSlugField]: slug, ownerId: userId })
    await db.collection(domain.projectsCollection).deleteOne({ slug, ownerId: userId })
    counters.files = filesResult.deletedCount
    counters.jobs = jobsResult.deletedCount

    logger.info(`Project deleted: ${domain.id}/${slug} (user ${userId})`, { ...counters })
    return counters
}
