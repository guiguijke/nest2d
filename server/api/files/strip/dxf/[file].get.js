import { getStripUserDxfBucket } from "~~/server/db/mongo";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";
import { sendOwnedBucketFile } from "~~/server/utils/files";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }
  await assertStripFeatureEnabled(userId);

  const fileName = getRouterParam(event, "file");

  const stripUserDxfFiles = await getStripUserDxfBucket();
  return await sendOwnedBucketFile(event, stripUserDxfFiles, fileName);
});
