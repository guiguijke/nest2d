import { DOMAINS } from "~~/server/core/domains";
import { deleteProjectCascade } from "~~/server/features/project/delete";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;

  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  await assertStripFeatureEnabled(userId);

  const slug = getRouterParam(event, "slug");

  const deleted = await deleteProjectCascade(DOMAINS.strip, userId, slug);

  return { ok: true, deleted };
});
