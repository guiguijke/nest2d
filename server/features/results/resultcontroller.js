import { connectDB } from "~~/server/db/mongo";

/**
 * @param {string} userId 
 * @param {string} projectSlug 
 * @returns {Promise<{items: {slug: string, status: string, createdAt: Date, svgs: string[]}[]}>}
 */
export async function getResults(userId, projectSlug) {
    const db = await connectDB();
    const queueList = await db
        .collection("nesting_jobs")
        .find({ ownerId: userId, ...(projectSlug && { projectSlug }) })
        .sort({ createdAt: -1 })
        .toArray();

    const respnoseItems = queueList.map((queueItem) => {
        let status = queueItem.status
        if (queueItem.error || queueItem.status == 'error' || queueItem.status == 'cancelled') {
            status = 'failed'
        }
        let isMultiSheet = queueItem.layoutCount > 1
        let downloadUrl = ''
        let zipDownloadUrl = ''
        if (queueItem.status == 'done') {
            // Local-compute (Phase 2) and legacy jobs may be 'done' without
            // exported files — the light local result shape has no
            // dxf_files/svg_files by design. Guard before indexing: a missing
            // array used to 500 the whole results stream.
            const hasFiles = Array.isArray(queueItem.dxf_files) && queueItem.dxf_files.length > 0
            zipDownloadUrl = hasFiles ? `/api/files/result/zip/${queueItem.slug}` : null
            downloadUrl = !hasFiles ? null : isMultiSheet ? zipDownloadUrl : `/api/files/result/dxf/${queueItem.dxf_files[0]}`
        } else {
            downloadUrl = null
            zipDownloadUrl = null
        }
        return {
            slug: queueItem.slug,
            // Additive: page live/running pickers filter by this so a stale
            // SSE list from project A cannot drive project B's atelier.
            projectSlug: queueItem.projectSlug ?? null,
            status: status,
            // AA2 (vérif L1 2026-09-05) : l'annulation est mapée « failed »
            // ci-dessus — ce drapeau permet à la page projet de réarmer le
            // bouton Nest (resetLastParams) quand le job de SON projet
            // passe annulé, même depuis un autre appareil.
            wasCancelled: queueItem.status === 'cancelled',
            isMultiSheet: isMultiSheet,
            createdAt: queueItem.createdAt,
            // Purge 24 h (D-PRV-10) : posé quand les blobs résultats ont été
            // supprimés — l'UI masque les téléchargements (le rapport reste).
            purgedAt: queueItem.purgedAt ?? null,
            placed: queueItem.placed || 0,
            requested: queueItem.requested || 0,
            // Specific failure reason written by the worker (e.g. which part
            // does not fit the sheet); null for legacy jobs.
            information: queueItem.information ?? null,
            // Plan 2026-09-05 §1.2b/§1.2c + Z3 (vérif 2026-09-05) : verdict
            // structuré {reason: 'capacity'|'strip'|'partial', leviers} —
            // alimente le bandeau du modal (unfit) et les leviers d'une
            // solution partielle. Null sur les jobs antérieurs.
            unfit: queueItem.unfit ?? null,
            downloadUrl: downloadUrl,
            zipDownloadUrl: zipDownloadUrl,
            isInProgress: queueItem.status === 'processing' || queueItem.status === 'pending' || queueItem.status === 'awaiting_local',
            // Live progress written by the worker ({stage, label, done, total}),
            // null once the job finishes (field is unset on completion).
            progress: queueItem.progress ?? null,
            // Live layout snapshot streamed by the engine (visualizer):
            // {stage, worker, feasible, sheets, isSpp, items, ...}, unset on completion.
            liveLayout: queueItem.liveLayout ?? null,
            // Engine item id -> {slug, part} map for the visualizer.
            itemMap: queueItem.itemMap ?? null,
            // Effective compute profile while the job runs ({vcores, workers,
            // directions}), written by the worker, unset on completion.
            compute: queueItem.compute ?? null,
            svgs: (queueItem.svg_files || []).map((file) => "/api/files/result/svg/" + file),
            dxfs: (queueItem.dxf_files || []).map((file) => "/api/files/result/dxf/" + file),
            // Alternative layouts (best first); empty for jobs run before
            // the feature existed — dxfs/svgs above stay the canonical ones.
            alternatives: (queueItem.alternatives || []).map((alt) => ({
                altId: alt.alt_id,
                seed: alt.seed != null ? alt.seed.toString() : null,
                density: alt.density,
                // Share of sheet actually consumed (used bbox / sheet area,
                // lower = better): rewards compaction, which the solver
                // density cannot see. Null on legacy jobs.
                usedSheetShare: alt.usedSheetShare ?? null,
                // Layout philosophy of this option (compact / max offcut /
                // balanced) — each alternative is genuinely different.
                strategy: alt.strategy ?? null,
                // Largest clean rectangular offcut ({width, height, area}).
                offcut: alt.offcut ?? null,
                layoutCount: alt.layoutCount,
                // Nesting report (measured verification + engine stats).
                report: alt.report ?? null,
                svgs: (alt.svg_files || []).map((file) => "/api/files/result/svg/" + file),
                dxfs: (alt.dxf_files || []).map((file) => "/api/files/result/dxf/" + file),
            })),
        }
    })

    return {
        items: respnoseItems.filter((item) => item),
    };
}