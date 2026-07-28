import { connectDB, getAvatarBucket } from "~~/server/db/mongo";

export default defineEventHandler(async (event) => {
  const userId = event.context?.auth?.userId;
  if (!userId) {
    setResponseStatus(401);
    return;
  }

  const db = await connectDB();

  const user = await db
    .collection("users")
    .findOne({ id: userId }, { projection: { avatarFileName: 1, name: 1 } });

  const avatar = user?.avatarFileName;
  if (!avatar) {
    // No stored avatar (e.g. local/email auth users). Generate an SVG avatar
    // with the user's initial so the UI always has something to render.
    const initial = (user?.name || "?").trim().charAt(0).toUpperCase() || "?";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="#3b82f6"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" fill="#ffffff">${escapeXml(initial)}</text></svg>`
    setResponseHeaders(event, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    });
    return svg;
  }

  const avatarBucket = await getAvatarBucket();
  const readStream = avatarBucket.openDownloadStreamByName(avatar);

  setResponseHeaders(event, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=86400", // Cache for 1 day
  });
  return readStream;
});

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
