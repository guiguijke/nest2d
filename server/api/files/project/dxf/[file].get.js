import { getValidUserDxfBucket } from "~~/server/db/mongo";
import { sendOwnedBucketFile } from "~~/server/utils/files";

export default defineEventHandler(async (event) => {
    const fileName = getRouterParam(event, "file");

    const validUserDxfFiles = await getValidUserDxfBucket();
    return await sendOwnedBucketFile(event, validUserDxfFiles, fileName);
});
