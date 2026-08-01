import { getSvgResultBucket } from "~~/server/db/mongo";
import { sendOwnedBucketFile } from "~~/server/utils/files";

export default defineEventHandler(async (event) => {
  const fileName = getRouterParam(event, "file");

  const svgResultBucket = await getSvgResultBucket();
  return await sendOwnedBucketFile(event, svgResultBucket, fileName, {
    contentType: "image/svg+xml",
  });
});
