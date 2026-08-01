import { defineEventHandler, createError } from "h3";

import { DOMAINS } from "~~/server/core/domains";
import { saveFiles } from "~~/server/core/project/dxf";
import { assertProjectAccess } from "~~/server/core/project/service";
import { assertStripFeatureEnabled } from "~~/server/utils/featureFlags";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  await assertStripFeatureEnabled(userId);
  const stripSlug = getRouterParam(event, "slug");

  await assertProjectAccess(DOMAINS.strip, userId, stripSlug);

  await saveFiles(DOMAINS.strip, event, stripSlug, userId);

  return {
    slug: stripSlug,
  };
});
