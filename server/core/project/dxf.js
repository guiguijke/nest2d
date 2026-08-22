import { createError, readMultipartFormData } from "h3";

import { connectDB, getBucket } from "~~/server/db/mongo";
import { makeOpaqueFileSlug } from "~~/server/utils/strings";
import { requireFileAccess, uploadToBucket } from "~~/server/utils/vault";
import { trackEvent } from "~~/server/tracking/add";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
} from "../../../shared/constants/upload.constants.js";

// Upload formats accepted by the file-processing pipeline (SVG and DWG are
// converted to canonical-mm DXF at the import boundary, server-side).
const ALLOWED_EXTENSIONS = [".dxf", ".svg", ".dwg"];
const MAX_BODY_BYTES = MAX_UPLOAD_FILE_BYTES * MAX_UPLOAD_FILES + 1024 * 1024;

/**
 * Saves the multipart DXF files of `event` into the domain's bucket and
 * inserts one pending file record per file into the domain's collection.
 * Shared by the bin (workspace projects) and strip domains — the domain
 * config (server/core/domains.js) provides the bucket, collection, slug
 * field, worker tag and tracking event name.
 */
export async function saveFiles(domain, event, projectSlug, userId) {
  const contentLength = Number(getRequestHeader(event, "content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw createError({
      statusCode: 413,
      message: "Upload too large.",
    });
  }

  const fields = await readMultipartFormData(event);
  const dxfFileFields = (fields || []).filter((field) => field.name === "dxf");

  if (dxfFileFields.length === 0) {
    throw createError({
      statusCode: 400,
      message: "No DXF file uploaded. Please upload a DXF file.",
    });
  }
  if (dxfFileFields.length > MAX_UPLOAD_FILES) {
    throw createError({
      statusCode: 400,
      message: `Too many files — at most ${MAX_UPLOAD_FILES} per upload.`,
    });
  }

  // Throws 403 vault_locked when the user has an encrypted vault but no
  // active session. dek is null on the legacy plaintext path.
  const { dek } = await requireFileAccess(userId);

  const dxfUserBucket = await getBucket(domain.dxfBucket);

  const file_records = [];

  for (const dxfFile of dxfFileFields) {
    const fileBuffer = dxfFile.data;
    if (!fileBuffer || fileBuffer.length > MAX_UPLOAD_FILE_BYTES) {
      throw createError({
        statusCode: 413,
        message: "Each file must be 5 MB or smaller.",
      });
    }
    const userFileName = String(dxfFile.filename || "part.dxf")
      .replace(/[\u0000-\u001f<>]/g, "")
      .slice(0, 200);

    // Server-side format check (the client filter is cosmetic): the original
    // extension is preserved in the slug so source downloads keep their type.
    const dotIndex = userFileName.lastIndexOf(".");
    const ext = dotIndex >= 0 ? userFileName.slice(dotIndex).toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw createError({
        statusCode: 400,
        message: `Unsupported file type "${ext || userFileName}" — only DXF, SVG and DWG files are accepted.`,
      });
    }
    // Opaque slug: the original name is NOT part of the GridFS key
    // (pentest C-1 — 24-bit suffix after a guessed name was brute-forceable).
    const file_slug = makeOpaqueFileSlug(ext);

    // Encrypted on the fly when the vault is enabled; awaited so the
    // document is only created once the bytes are durably stored.
    await uploadToBucket(dxfUserBucket, file_slug, fileBuffer, { ownerId: userId, dek });

    const file_record = {
      slug: file_slug,
      name: userFileName,
      processingStatus: "pending",
      [domain.projectSlugField]: projectSlug,
      ownerId: userId,
      uploadAt: new Date(),
      flattening: 0.01,
      worker_tag: domain.workerTag,
    };

    file_records.push(file_record);
  }

  file_records.forEach((file_record) => {
    trackEvent(event, domain.trackCreateFile, {
      fileName: file_record.name,
      fileSlug: file_record.slug,
      [domain.projectSlugField]: projectSlug,
    });
  });

  const db = await connectDB();

  await db.collection(domain.filesCollection).insertMany(file_records);
  return file_records;
}
