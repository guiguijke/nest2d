import { createError, readMultipartFormData } from "h3";

import { connectDB, getUserDxfBucket } from "~~/server/db/mongo";
import { generateRandomString } from "~~/server/utils/strings";
import { requireFileAccess, uploadToBucket } from "~~/server/utils/vault";
import { trackEvent } from "~~/server/tracking/add";

import standardSlugify from "standard-slugify";

export async function saveFilesToProject(event, projectSlug, userId) {
  const fields = await readMultipartFormData(event);
  const dxfFileFields = fields.filter((field) => field.name === "dxf");

  if (dxfFileFields.length === 0) {
    throw createError({
      statusCode: 400,
      message: "No DXF file uploaded. Please upload a DXF file.",
    });
  }

  // Throws 403 vault_locked when the user has an encrypted vault but no
  // active session. dek is null on the legacy plaintext path.
  const { dek } = await requireFileAccess(userId);

  const dxfUserBucket = await getUserDxfBucket();

  const dxfs = [];
  const file_records = [];

  for (const dxfFile of dxfFileFields) {
    const fileBuffer = dxfFile.data;
    const userFileName = dxfFile.filename;
    const file_slug = standardSlugify(userFileName, {
      keepCase: false,
    }) + `-${generateRandomString(6)}.dxf`;

    // Encrypted on the fly when the vault is enabled; awaited so the
    // document is only created once the bytes are durably stored.
    await uploadToBucket(dxfUserBucket, file_slug, fileBuffer, { ownerId: userId, dek });

    const dxfRecord = {
      slug: file_slug,
      name: userFileName,
    };
    dxfs.push(dxfRecord);

    const file_record = {
      slug: file_slug,
      name: userFileName,
      processingStatus: "pending",
      projectSlug: projectSlug,
      ownerId: userId,
      uploadAt: new Date(),
      flattening: 0.01,
      worker_tag: "normal",
    };

    file_records.push(file_record);
  }

  file_records.forEach((file_record) => {
    trackEvent(event, "create_project_dxf_file", {
      fileName: file_record.name,
      fileSlug: file_record.slug,
      projectSlug: projectSlug,
    })
  });

  const db = await connectDB();

  await db.collection("user_dxf_files").insertMany(file_records);
}
