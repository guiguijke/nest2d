import { defineEventHandler, createError } from "h3";

import { DOMAINS } from "~~/server/core/domains";
import { createProjectWithFiles } from "~~/server/core/project/service";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  return await createProjectWithFiles(DOMAINS.bin, event, userId);
});
