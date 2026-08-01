import { DOMAINS } from "~~/server/core/domains";
import { listProjects } from "~~/server/core/project/service";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  await assertStripFeatureEnabled(userId);

  return await listProjects(DOMAINS.strip, userId);
});
