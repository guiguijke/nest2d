import { DOMAINS } from "~~/server/core/domains";
import { getProjectFiles } from "~~/server/core/project/service";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;

  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  await assertStripFeatureEnabled(userId);

  const slug = getRouterParam(event, "slug");

  return await getProjectFiles(DOMAINS.strip, userId, slug);
});
