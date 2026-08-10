import { defineEventHandler, createError } from "h3";

import { DOMAINS } from "~~/server/core/domains";
import { createLocalProject, createProjectWithFiles } from "~~/server/core/project/service";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  // J-090 : création d'un projet « 100 % privé » (JSON, SANS fichiers —
  // l'import se fait côté navigateur ensuite). Flag-gated : tant que
  // l'import client n'est pas vérifié en prod, la voie reste fermée.
  const contentType = getHeader(event, "content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await readBody(event);
    if (body?.local === true) {
      const config = useRuntimeConfig(event);
      const enabled =
        (config.public.localComputeEnabled === true || config.public.localComputeEnabled === "true") &&
        (config.public.localImportEnabled === true || config.public.localImportEnabled === "true");
      if (!enabled) {
        throw createError({ statusCode: 404, message: "Not found" });
      }
      return await createLocalProject(DOMAINS.bin, userId);
    }
  }

  return await createProjectWithFiles(DOMAINS.bin, event, userId);
});
