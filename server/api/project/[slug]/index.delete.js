import { DOMAINS } from "~~/server/core/domains";
import { deleteProjectCascade } from "~~/server/features/project/delete";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;

  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  const slug = getRouterParam(event, "slug");

  const deleted = await deleteProjectCascade(DOMAINS.bin, userId, slug);

  return { ok: true, deleted };
});
