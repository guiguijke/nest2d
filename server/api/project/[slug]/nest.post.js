import { defineEventHandler, readBody } from "h3";
import { connectDB } from "~~/server/db/mongo";
import { generateRandomString } from "~~/server/utils/strings";
import standardSlugify from "standard-slugify";
import logger from "~~/server/utils/logger";
import { trackEvent } from "~~/server/tracking/add";
import { assertCanNest, getComputeProfile } from "~~/server/utils/entitlement";
import { requireFileAccess } from "~~/server/utils/vault";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }
  const db = await connectDB();
  const user = await db.collection("users").findOne({ id: userId });
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const projectSlug = getRouterParam(event, "slug");

  trackEvent(event, "request_nesting", {
    projectSlug: projectSlug,
  });

  // Legacy (flag-off) users keep the pay-as-you-go credit check up front.
  // Feature-flagged users are gated by assertCanNest just before enqueue.
  if (!user.isStripFeatureEnable && user.balance < 1) {
    throw createError({
      statusCode: 402,
      statusMessage: "Not enough credits",
    });
  }
  const project = await db.collection("projects").findOne({ slug: projectSlug, ownerId: userId })
  if (!project) {
    throw createError({
      statusCode: 404,
      statusMessage: "Project not found",
    });
  }
  const body = await readBody(event);
  /**
   * @type {{originFiles: {name: string, count: int}[], params: {height: float, width: float, space: float}}}
   **/
  const { files, params } = body;

  const filteredFiles = files.filter((file) => file.count > 0);

  // Global rotation setting: N rotations spread evenly around the circle.
  // Falls back to the historical 4 rotations (0/90/180/270) if not provided.
  const rotationCount = Math.min(360, Math.max(1, Math.floor(Number(params?.rotationCount) || 4)))
  const globalRotations = rotationCount === 1
    ? [0]
    : Array.from({ length: rotationCount }, (_, i) => Math.round((i * 360) / rotationCount))

  const userDxfFilesDatabase = await db.collection("user_dxf_files").find({
    slug: { $in: filteredFiles.map((file) => file.slug) }
  }).project({
    _id: 0,
    slug: 1,
    name: 1,
  }).toArray()

  const fileMetadata = userDxfFilesDatabase.map((file) => {
    const requestFile = filteredFiles.find((f) => f.slug === file.slug)
    return {
      slug: file.slug,
      simpleName: file.name.replace('.dxf', ''),
      count: requestFile?.count || 0,
      // Per-file override wins; otherwise apply the global rotation setting.
      rotations: requestFile?.rotation ? JSON.parse(requestFile.rotation) : globalRotations
    }
  })

  const nestingSlug = `nested-${fileMetadata.map((file) => {
    const fileNameSlug = standardSlugify(file.simpleName, { keepCase: false })
    return fileNameSlug + '_' + file.count
  }).join('-')}-${generateRandomString(6)}`;

  // Multi-sheet: the client sends params.sheets (list of sheet types with
  // their own dimensions and stock). Legacy clients send a single
  // width/height/sheetCount — normalized to the same shape.
  let sheets = null;
  if (Array.isArray(params.sheets) && params.sheets.length > 0) {
    sheets = params.sheets
      .map((sheet) => ({
        width: Number(sheet.width),
        height: Number(sheet.height),
        count: Math.floor(Number(sheet.count)),
      }))
      .filter(
        (sheet) =>
          Number.isFinite(sheet.width) && sheet.width > 0 &&
          Number.isFinite(sheet.height) && sheet.height > 0 &&
          Number.isFinite(sheet.count) && sheet.count >= 1
      )
      .slice(0, 10);
    if (sheets.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Please provide at least one valid sheet (width, height, count).",
      });
    }
  }

  const dbParams = sheets
    ? {
        sheets,
        space: params.space,
        addOutShape: params.addOutShape,
      }
    : {
        height: params.height,
        width: params.width,
        space: params.space,
        sheetCount: params.sheetCount,
        addOutShape: params.addOutShape,
      }

  // Subscription / free-quota / credits gate for feature-flagged users.
  // Consumes a unit only once the request is fully validated. The charge is
  // stored on the job so the worker can refund it if the nesting fails (and
  // so the worker skips its legacy balance decrement for these jobs).
  let charge = null;
  if (user.isStripFeatureEnable) {
    charge = await assertCanNest(userId);
  }

  // Server-side compute budget by tier (never trust the client for this).
  // Legacy flag-off users are pay-as-you-go → credits profile.
  const compute = await getComputeProfile(
    userId,
    charge || { type: "credits" },
    params.computeLevel
  );
  dbParams.timeBudgetSec = compute.timeBudgetSec;
  dbParams.alternativesCount = compute.nAlternatives;
  dbParams.computeLevel = compute.level;

  // Encrypted vaults must be unlocked before a job can be enqueued — the
  // workers need an active session to read the source files. Also refreshes
  // the sliding TTL so the session outlives the job.
  await requireFileAccess(userId);

  await db.collection("nesting_jobs").insertOne({
    slug: nestingSlug,
    projectSlug: projectSlug,
    files: fileMetadata,
    params: dbParams,
    status: "pending",
    priority: compute.priority,
    createdAt: new Date(),
    ownerId: userId,
    ...(charge && { charge }),
  });

  return {
    slug: nestingSlug,
  };
});
