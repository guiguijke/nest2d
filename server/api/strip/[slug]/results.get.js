import { connectDB } from "~~/server/db/mongo";
import { DOMAINS } from "~~/server/core/domains";
import { listJobs } from "~~/server/core/project/service";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  await assertStripFeatureEnabled(userId);

  const slug = getRouterParam(event, "slug");

  const db = await connectDB();

  const strip = await db
    .collection("strip_projects")
    .findOne({ slug: slug, ownerId: userId }, { projection: { slug: 1 } });
  if (!strip) {
    throw createError({ statusCode: 404, message: "Strip project not found" });
  }

  const jobs = await listJobs(DOMAINS.strip, userId, slug);

  return {
    items: jobs.map((job) => mapJobToUi(job)),
  };
});

const mapJobToUi = (job) => {
  const files = job.files || [];
  const dxfFile = (job.dxf_files || [])[0] || null;
  return {
    slug: job.slug,
    status: job.status,
    height: job.params?.height ?? null,
    width: job.width ?? null,
    fileCount: files.reduce((acc, file) => acc + (file.count || 0), 0),
    dxfUrl: dxfFile ? `/api/files/strip/nest/dxf/${dxfFile}` : null,
    createdAt: job.createdAt,
    // Purge 24 h (D-PRV-10) : blobs résultats supprimés → UI « expiré ».
    purgedAt: job.purgedAt ?? null,
  };
};
