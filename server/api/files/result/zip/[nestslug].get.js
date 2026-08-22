import { connectDB, getDxfResultBucket } from "~~/server/db/mongo";
import { createError } from "h3";
import archiver from "archiver";
import { getRouterParam } from "#imports"; // fallback, adjust if needed
import { trackEvent } from "~~/server/tracking/add"
import { createDecryptStream } from "~~/server/utils/crypto";
import { requireFileAccess } from "~~/server/utils/vault";

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId;
    if (!userId) {
        throw createError({
            statusCode: 401,
            statusMessage: "Unauthorized",
        });
    }
    const nestSlug = getRouterParam(event, "nestslug");
    const db = await connectDB();
    const nestResult = await db.collection('nesting_jobs').findOne({ slug: nestSlug, ownerId: userId })
    if (!nestResult) {
        throw createError({
            statusCode: 404,
            statusMessage: "Nesting result not found",
        });
    }

    await trackEvent(event, "download_nested_result_zip_file", {
        nestSlug: nestSlug,
    })

    const nestDxfBucket = await getDxfResultBucket();

    const dxfFiles = await nestDxfBucket.find({ filename: { $in: nestResult.dxf_files } }).toArray();

    // Results may be encrypted — the vault must be unlocked to read them.
    const hasEncrypted = dxfFiles.some((file) => file.metadata?.enc);
    let dek = null;
    if (hasEncrypted) {
        ({ dek } = await requireFileAccess(userId));
    }

    setResponseHeaders(event, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=nesting-${nestSlug}.zip`,
        "Cache-Control": "private, no-store",
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
        throw createError({
            statusCode: 500,
            statusMessage: "Error creating zip archive",
            data: err.message,
        });
    });

    event.res.on("close", () => archive.destroy());
    archive.pipe(event.res);

    for (const file of dxfFiles) {
        let stream = nestDxfBucket.openDownloadStreamByName(file.filename);
        if (file.metadata?.enc) {
            stream = stream.pipe(createDecryptStream(dek, file.filename, userId));
        }
        archive.append(stream, { name: file.filename });
    }
    await archive.finalize();
    return event.res;
})
