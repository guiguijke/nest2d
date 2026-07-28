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
        if (queueItem.error || queueItem.status == 'error') {
            status = 'failed'
        }
        let isMultiSheet = queueItem.layoutCount > 1
        let downloadUrl = ''
        let zipDownloadUrl = ''
        if (queueItem.status == 'done') {
            zipDownloadUrl = `/api/files/result/zip/${queueItem.slug}`
            downloadUrl = isMultiSheet ? zipDownloadUrl : `/api/files/result/dxf/${queueItem.dxf_files[0]}`
        } else {
            downloadUrl = null
            zipDownloadUrl = null
        }
        return {
            slug: queueItem.slug,
            status: status,
            isMultiSheet: isMultiSheet,
            createdAt: queueItem.createdAt,
            placed: queueItem.placed || 0,
            requested: queueItem.requested || 0,
            downloadUrl: downloadUrl,
            zipDownloadUrl: zipDownloadUrl,
            isInProgress: queueItem.status === 'processing' || queueItem.status === 'pending',
            // Live progress written by the worker ({stage, label, done, total}),
            // null once the job finishes (field is unset on completion).
            progress: queueItem.progress ?? null,
            svgs: (queueItem.svg_files || []).map((file) => "/api/files/result/svg/" + file),
            dxfs: (queueItem.dxf_files || []).map((file) => "/api/files/result/dxf/" + file),
            // Alternative layouts (best first); empty for jobs run before
            // the feature existed — dxfs/svgs above stay the canonical ones.
            alternatives: (queueItem.alternatives || []).map((alt) => ({
                altId: alt.alt_id,
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
                svgs: (alt.svg_files || []).map((file) => "/api/files/result/svg/" + file),
                dxfs: (alt.dxf_files || []).map((file) => "/api/files/result/dxf/" + file),
            })),
        }
    })

    return {
        items: respnoseItems.filter((item) => item),
    };
}