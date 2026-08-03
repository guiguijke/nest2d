import { connectDB, getBucket } from "../db/mongo";
import { uploadToBucket } from "../utils/vault";
import logger from "../utils/logger";
import {
  DEMO_OWNER_ID,
  DEMO_PROJECT_SLUG,
} from "../../shared/constants/demo.constants";

/**
 * Seeds the shared read-only demo project at boot. Idempotent AND
 * self-healing: the project is upserted and each file is only pushed when
 * missing, so a crash mid-seed or a wiped bucket is repaired on the next
 * start. Files go through the NORMAL import pipeline (pending → the
 * file-processing worker polygonizes them, assigns their random display
 * colors and builds their previews) — the seed never touches geometry.
 *
 * DXF assets ship inside .output via nitro serverAssets (nuxt.config.js),
 * so this also works in the production image.
 */
export default defineNitroPlugin(async () => {
  const db = await connectDB();

  const storage = useStorage("assets:demo-seed");
  const manifestRaw = await storage.getItem("manifest.json");
  if (!manifestRaw) {
    logger.warn("[demo-seed] manifest.json not found in server assets — demo project disabled");
    return;
  }
  const manifest = typeof manifestRaw === "string" ? JSON.parse(manifestRaw) : manifestRaw;

  await db.collection("projects").updateOne(
    { slug: DEMO_PROJECT_SLUG },
    {
      $setOnInsert: {
        slug: DEMO_PROJECT_SLUG,
        // Display name is localized client-side (demo.projectName) — this
        // is the fallback for raw API consumers.
        name: "Demo — Marine sheet metal",
        createdAt: new Date(),
        ownerId: DEMO_OWNER_ID,
        isDemo: true,
      },
    },
    { upsert: true }
  );

  const dxfUserBucket = await getBucket("userDxf");
  let seeded = 0;
  let repaired = 0;

  for (const entry of manifest) {
    // Stable kebab slug: marine_lpl_001.dxf -> demo-marine-lpl-001.dxf
    const slug = `demo-${entry.file.replaceAll("_", "-")}`;

    const existing = await db.collection("user_dxf_files").findOne(
      { slug },
      { projection: { processingStatus: 1 } }
    );
    if (existing) continue;

    const bytes = await storage.getItemRaw(entry.file);
    if (!bytes) {
      logger.warn(`[demo-seed] asset missing for ${entry.file} — skipped`);
      continue;
    }

    // Plaintext upload: the demo owner has no vault (no DEK), and the file
    // must be readable by every user.
    await uploadToBucket(dxfUserBucket, slug, Buffer.from(bytes), { ownerId: DEMO_OWNER_ID });

    await db.collection("user_dxf_files").insertOne({
      slug,
      name: entry.name,
      processingStatus: "pending",
      projectSlug: DEMO_PROJECT_SLUG,
      ownerId: DEMO_OWNER_ID,
      isDemo: true,
      // Initial quantity pre-filled in the UI (adjustable before nesting).
      demoQuantity: entry.quantity,
      uploadAt: new Date(),
      flattening: 0.01,
      worker_tag: "normal",
    });
    seeded += 1;
  }

  // Self-healing: files stuck in pending/processing from an earlier boot
  // (worker down at seed time) are picked up by the normal worker loop —
  // nothing to do here beyond logging the state.
  const pending = await db.collection("user_dxf_files").countDocuments({
    projectSlug: DEMO_PROJECT_SLUG,
    processingStatus: { $in: ["pending", "processing"] },
  });
  if (pending > 0) repaired = pending;

  logger.info(
    `[demo-seed] project "${DEMO_PROJECT_SLUG}": ${seeded} file(s) seeded, ${repaired} awaiting processing`
  );
});
