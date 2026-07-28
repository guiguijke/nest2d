import { getSvgResultBucket } from "~~/server/db/mongo";
import { openOwnedFileStream } from "~~/server/utils/vault";

export default defineEventHandler(async (event) => {
  const fileName = getRouterParam(event, "file");

  const svgResultBucket = await getSvgResultBucket();
  const { stream, encrypted } = await openOwnedFileStream(event, svgResultBucket, fileName);

  setResponseHeaders(event, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": encrypted ? "private, no-store" : "public, max-age=86400",
  });
  return stream;
});
