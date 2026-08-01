import { getUserDxfFilesSvgBucket } from "~~/server/db/mongo";
import { sendOwnedBucketFile } from "~~/server/utils/files";

export default defineEventHandler(async (event) => {
  const fileName = getRouterParam(event, "file");

  const userDxfSvgFiles = await getUserDxfFilesSvgBucket();
  return await sendOwnedBucketFile(event, userDxfSvgFiles, fileName, {
    contentType: "image/svg+xml",
  });
});
