import { DOMAINS } from "~~/server/core/domains";
import { listProjects } from "~~/server/core/project/service";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId || "anonymous";

  return await listProjects(DOMAINS.bin, userId);
});
