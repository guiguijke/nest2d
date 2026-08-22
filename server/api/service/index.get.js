import { connectDB } from "~~/server/db/mongo";
import { trackEvent } from "~~/server/tracking/add";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId || null;
  const db = await connectDB();

  let isDbConnected = false;

  try {
    await db.command({ ping: 1 });
    isDbConnected = true;
  } catch (e) {
    console.error(e);
  }

  await trackEvent(event, "service_index_get")

  // Anonymous callers only get a liveness flag — commitSha was a version
  // leak (pentest M-5). Authenticated clients still see it (support/debug).
  if (!userId) {
    return { ok: true, isDbConnected };
  }

  const user = await db.collection("users").findOne({ id: userId });

  let commitSha = "";
  try {
    commitSha = useRuntimeConfig().public.gitCommitSha || "";
  } catch (e) {
    console.error(e);
  }

  return {
    userId,
    provider: user?.provider || "unknown",
    isDbConnected,
    commitSha,
  };
});
