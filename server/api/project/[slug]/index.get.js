import { DOMAINS } from "~~/server/core/domains";
import { getProjectFiles } from "~~/server/core/project/service";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;

  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  const slug = getRouterParam(event, "slug");

  return await getProjectFiles(DOMAINS.bin, userId, slug);
});
