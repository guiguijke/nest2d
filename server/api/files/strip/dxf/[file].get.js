import { connectDB, getStripUserDxfBucket } from "~~/server/db/mongo";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";
import { openDownloadFromBucket, requireFileAccess } from "~~/server/utils/vault";

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

  const db = await connectDB();
  const fileRecord = await db
    .collection("strip_user_dxf_files")
    .findOne({ slug: fileName });

  if (!fileRecord) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  if (fileRecord.ownerId !== userId && event.context.auth.isAdmin !== true) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const stripUserDxfFiles = await getStripUserDxfBucket();
  const files = await stripUserDxfFiles.find({ filename: fileName }).toArray();
  const fileDoc = files[0];
  if (!fileDoc) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  const encrypted = Boolean(fileDoc.metadata?.enc);
  let dek = null;
  if (encrypted) {
    ({ dek } = await requireFileAccess(userId));
  }
  const readStream = openDownloadFromBucket(stripUserDxfFiles, fileName, { fileDoc, ownerId: fileRecord.ownerId, dek });

  setResponseHeaders(event, {
    "Content-Type": "application/octet-stream",
    "Cache-Control": encrypted ? "private, no-store" : "public, max-age=86400",
  });
  return readStream;
});
