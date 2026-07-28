import { getValidUserDxfBucket } from "~~/server/db/mongo";
import { openOwnedFileStream } from "~~/server/utils/vault";

export default defineEventHandler(async (event) => {
    const fileName = getRouterParam(event, "file");

    const validUserDxfFiles = await getValidUserDxfBucket();
    const { stream, encrypted } = await openOwnedFileStream(event, validUserDxfFiles, fileName);

    setResponseHeaders(event, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": encrypted ? "private, no-store" : "public, max-age=86400",
    });
    return stream;
});
