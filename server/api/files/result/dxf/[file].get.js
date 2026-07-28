import { getDxfResultBucket } from "~~/server/db/mongo";
import { openOwnedFileStream } from "~~/server/utils/vault";
import { trackEvent } from "~~/server/tracking/add"

export default defineEventHandler(async (event) => {
    const fileName = getRouterParam(event, "file");

    const resultDxfBucket = await getDxfResultBucket();
    const { stream, encrypted } = await openOwnedFileStream(event, resultDxfBucket, fileName);

    await trackEvent(event, "download_nested_result_dxf_file", {
        fileName: fileName,
    })

    setResponseHeaders(event, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": encrypted ? "private, no-store" : "public, max-age=86400",
    });
    return stream;
});
