import { openOwnedFileStream } from "~~/server/utils/vault";

/**
 * Serves a GridFS file to its owner with the standard download headers.
 * Auth, ownership, vault unlock and transparent decryption are handled by
 * openOwnedFileStream; encrypted files downgrade Cache-Control to
 * private, no-store.
 */
export async function sendOwnedBucketFile(
  event,
  bucket,
  fileName,
  { contentType = "application/octet-stream", attachment = false } = {}
) {
  const { stream, encrypted } = await openOwnedFileStream(event, bucket, fileName);

  const headers = {
    "Content-Type": contentType,
    "Cache-Control": encrypted ? "private, no-store" : "public, max-age=86400",
  };
  if (attachment) {
    headers["Content-Disposition"] = `attachment; filename="${fileName}"`;
  }
  setResponseHeaders(event, headers);
  return stream;
}
