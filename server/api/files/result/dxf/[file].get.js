import { getDxfResultBucket } from "~~/server/db/mongo";
import { sendOwnedBucketFile } from "~~/server/utils/files";
import { trackEvent } from "~~/server/tracking/add"

export default defineEventHandler(async (event) => {
    const fileName = getRouterParam(event, "file");

    const resultDxfBucket = await getDxfResultBucket();

    // Opens (and authorizes) the file first — failed downloads are not tracked.
    const stream = await sendOwnedBucketFile(event, resultDxfBucket, fileName, {
        attachment: true,
    });

    await trackEvent(event, "download_nested_result_dxf_file", {
        fileName: fileName,
    })

    return stream;
});
