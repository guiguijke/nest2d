import { defineEventHandler, createError } from "h3";

import { DOMAINS } from "~~/server/core/domains";
import { saveFiles } from "~~/server/core/project/dxf";
import { assertProjectAccess } from "~~/server/core/project/service";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  const projectSlug = getRouterParam(event, "slug");

  await assertProjectAccess(DOMAINS.bin, userId, projectSlug);

  await saveFiles(DOMAINS.bin, event, projectSlug, userId);

  return {
    slug: projectSlug,
  };
});
