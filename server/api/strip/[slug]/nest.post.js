import { defineEventHandler, readBody } from "h3";
import { connectDB } from "~~/server/db/mongo";
import { DOMAINS } from "~~/server/core/domains";
import { enqueueNestingJob } from "~~/server/core/project/service";
import { trackEvent } from "~~/server/tracking/add";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }
  await assertStripFeatureEnabled(userId);

  const db = await connectDB();

  const stripSlug = getRouterParam(event, "slug");

  trackEvent(event, "request_strip_nesting", {
    stripSlug: stripSlug,
  });

  const strip = await db
    .collection("strip_projects")
    .findOne({ slug: stripSlug, ownerId: userId });
  if (!strip) {
    throw createError({
      statusCode: 404,
      statusMessage: "Strip project not found",
    });
  }

  const body = await readBody(event);
  /**
   * @type {{files: {slug: string, count: number}[], params: {height: number}}}
   **/
  const { files, params } = body;

  const filteredFiles = (files || []).filter((file) => file.count > 0);

  if (filteredFiles.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Please select at least one file to nest.",
    });
  }

  const height = Number(params?.height);
  if (!Number.isFinite(height) || height <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Please provide a valid height.",
    });
  }

  const stripFilesDatabase = await db
    .collection("strip_user_dxf_files")
    .find({
      slug: { $in: filteredFiles.map((file) => file.slug) },
      ownerId: userId,
    })
    .project({
      _id: 0,
      slug: 1,
      name: 1,
      purgedAt: 1,
    })
    .toArray();

  // Purge 24 h (D-PRV-10) : un fichier expiré (géométrie purgée) ne peut
  // plus être nesté — 409 explicite plutôt qu'un job raté opaque.
  const expiredFiles = stripFilesDatabase.filter((file) => Boolean(file.purgedAt));
  if (expiredFiles.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `files_expired: ${expiredFiles.map((f) => f.name).join(", ")}`,
    });
  }

  const fileMetadata = stripFilesDatabase.map((file) => {
    const requestFile = filteredFiles.find((f) => f.slug === file.slug);
    return {
      slug: file.slug,
      simpleName: file.name.replace(".dxf", ""),
      count: requestFile?.count || 0,
      // Allowed orientations for this part. Strip nesting only supports keeping
      // the part as-is or flipping it 180°, so anything else is dropped.
      angle: parseStripAngle(requestFile?.rotation),
    };
  });

  // Subscription / free-quota gate + vault gate + job insertion.
  return await enqueueNestingJob(DOMAINS.strip, {
    userId,
    projectSlug: stripSlug,
    fileMetadata,
    params: {
      height: height,
    },
  });
});

/**
 * Parse the per-file rotation sent by the strip UI into a sanitized list of
 * allowed orientations. Only 0° and 180° are supported for strip nesting; any
 * other value is discarded and an empty/invalid input falls back to [0].
 *
 * @param {string | number[] | undefined} rotation
 * @returns {number[]}
 */
function parseStripAngle(rotation) {
  let parsed = rotation;
  if (typeof rotation === "string") {
    try {
      parsed = JSON.parse(rotation);
    } catch {
      parsed = null;
    }
  }
  const allowed = Array.isArray(parsed)
    ? parsed.map(Number).filter((angle) => angle === 0 || angle === 180)
    : [];
  const unique = [...new Set(allowed)];
  return unique.length > 0 ? unique : [0];
}
