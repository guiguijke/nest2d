import standardSlugify from "standard-slugify";

import { connectDB } from "~~/server/db/mongo";
import { saveFiles } from "~~/server/core/project/dxf";
import {
  generateRandomString,
  generateEntityName,
  titleFromFileName,
  PROJECT_SLUG_RANDOM_LEN,
} from "~~/server/utils/strings";
import { assertCanNest } from "~~/server/utils/entitlement";
import { requireFileAccess, resolvePolygonParts } from "~~/server/utils/vault";
import { resolvePartColor } from "~~/server/utils/colors";
import {
  DEMO_OWNER_ID,
  DEMO_PROJECT_SLUG,
} from "../../../shared/constants/demo.constants";

/**
 * Shared services for the bin (workspace projects) and strip domains. Every
 * function takes the domain config (server/core/domains.js) as first
 * argument; routes in server/api/project/** and server/api/strip/** are thin
 * shells around them (auth + strip feature flag + domain-specific param
 * validation stay in the routes).
 */

/**
 * Creates a project with a generated name/slug and saves the uploaded DXF
 * files (POST /api/project or /api/strip).
 */
export async function createProjectWithFiles(domain, event, userId) {
  const db = await connectDB();
  const projectName = generateEntityName();
  const projectSlug = `${standardSlugify(projectName, {
    keepCase: false,
  })}-${generateRandomString(PROJECT_SLUG_RANDOM_LEN)}`;

  await db.collection(domain.projectsCollection).insertOne({
    slug: projectSlug,
    name: projectName,
    createdAt: new Date(),
    ownerId: userId,
  });

  const records = await saveFiles(domain, event, projectSlug, userId);
  const fromFile = titleFromFileName(records?.[0]?.name);
  if (fromFile && fromFile !== projectName) {
    await db.collection(domain.projectsCollection).updateOne(
      { slug: projectSlug },
      { $set: { name: fromFile } },
    );
  }

  return {
    slug: projectSlug,
  };
}

/**
 * J-090 — projet « 100 % privé » : le doc serveur ne porte QUE des
 * métadonnées (nom, dates, quota). Les fichiers sont parsés dans le
 * navigateur et vivent dans IndexedDB ; la géométrie ne transite jamais.
 * Aucun fichier à la création (l'import arrive ensuite, côté client).
 */
export async function createLocalProject(domain, userId) {
  const db = await connectDB();
  const projectName = generateEntityName();
  const projectSlug = `${standardSlugify(projectName, {
    keepCase: false,
  })}-${generateRandomString(PROJECT_SLUG_RANDOM_LEN)}`;

  await db.collection(domain.projectsCollection).insertOne({
    slug: projectSlug,
    name: projectName,
    createdAt: new Date(),
    ownerId: userId,
    local: true,
  });

  return {
    slug: projectSlug,
  };
}

/**
 * Lists the user's projects, newest first. Bin projects also expose the raw
 * jobs queue and per-project result counts (domain.includeJobsInProjectList).
 * The shared read-only demo project is pinned first for everyone (bin
 * domain only) — it never appears in the user's own list since its ownerId
 * is the technical demo account.
 */
export async function listProjects(domain, userId) {
  const db = await connectDB();
  const projects = await db
    .collection(domain.projectsCollection)
    .find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .project({ slug: 1, name: 1, createdAt: 1, local: 1 })
    .toArray();

  const demoProject = domain.includeJobsInProjectList
    ? await db
        .collection(domain.projectsCollection)
        .findOne(
          { slug: DEMO_PROJECT_SLUG, isDemo: true },
          { projection: { slug: 1, name: 1, createdAt: 1 } }
        )
    : null;

  if (!domain.includeJobsInProjectList) {
    return {
      projects: projects.map((project) => ({
        slug: project.slug,
        name: project.name,
        createdAt: project.createdAt,
        results: 0,
      })),
    };
  }

  const queueList = await db
    .collection(domain.jobsCollection)
    .find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .project({ [domain.projectSlugField]: 1 })
    .toArray();

  const toUi = (project, extra = {}) => ({
    slug: project.slug,
    name: project.name,
    createdAt: project.createdAt,
    // J-090 : projet 100 % privé (fichiers jamais uploadés) — badge UI.
    ...(project.local ? { local: true } : {}),
    results: queueList.filter(
      (queueItem) => queueItem[domain.projectSlugField] === project.slug
    ).length,
    ...extra,
  });

  return {
    queueList: queueList,
    projects: [
      ...(demoProject ? [toUi(demoProject, { isDemo: true })] : []),
      ...projects.map((project) => toUi(project)),
    ],
  };
}

/**
 * Fetches a project and rejects access when it does not belong to the user
 * (used by the addfiles routes before touching files).
 */
export async function assertProjectAccess(domain, userId, slug) {
  const db = await connectDB();
  const project = await db
    .collection(domain.projectsCollection)
    .findOne({ slug: slug });

  if (!project) {
    throw createError({
      statusCode: 404,
      message: `${domain.projectLabel} not found`,
    });
  }

  if (project.ownerId !== userId) {
    throw createError({ statusCode: 403, message: "Forbidden" });
  }

  return project;
}

/**
 * Project detail with its files mapped for the UI (GET /api/project/[slug]
 * or /api/strip/[slug]). The shared demo project is readable by everyone:
 * the 403 check is skipped and its files are listed by the technical demo
 * owner instead of the caller.
 */
export async function getProjectFiles(domain, userId, slug) {
  const db = await connectDB();
  const project = await db.collection(domain.projectsCollection).findOne(
    { slug: slug },
    {
      projection: {
        name: 1,
        slug: 1,
        ownerId: 1,
        isDemo: 1,
        local: 1,
      },
    }
  );

  if (!project) {
    throw createError({
      statusCode: 404,
      message: `${domain.projectLabel} not found`,
    });
  }

  const isDemo = Boolean(project.isDemo);
  if (!isDemo && domain.rejectForeignProject && project.ownerId !== userId) {
    throw createError({
      statusCode: 404,
      message: `${domain.projectLabel} not found`,
    });
  }

  const projectFiles = project.local
    ? [] // J-090 : les fichiers d'un projet local vivent dans IndexedDB —
         // le serveur n'a aucune géométrie à servir.
    : await db
        .collection(domain.filesCollection)
        .find({
          [domain.projectSlugField]: slug,
          ownerId: isDemo ? DEMO_OWNER_ID : userId,
        })
        .sort({ uploadAt: 1 })
        .toArray();

  const files = await Promise.all(
    projectFiles.map((file) => FILE_MAPPERS[domain.id](userId, file))
  );

  return {
    name: project.name,
    slug: project.slug,
    isDemo,
    // J-090 : projet 100 % privé — la page hydrate ses fichiers depuis
    // IndexedDB, jamais depuis le serveur.
    local: Boolean(project.local),
    files,
  };
}

const mapProcessingStatus = (processingStatus) => {
  if (processingStatus === "completed") {
    return "done";
  } else if (processingStatus === "processing" || processingStatus === "pending") {
    return "in-progress";
  }
  return processingStatus;
};

const mapBinFileToUi = async (userId, file) => {
  const completed = file.processingStatus === "completed";

  // Decrypts the enc blob when the vault is enabled (403 vault_locked if no
  // active session), passes legacy plaintext through untouched.
  const parts = await resolvePolygonParts(userId, file);

  return {
    slug: file.slug,
    name: file.name,
    svgUrl: completed ? `/api/files/project/svg/${file.svgFileSlug}` : null,
    dxfUrl: completed ? `/api/files/project/dxf/${file.slug}` : null,
    processingStatus: mapProcessingStatus(file.processingStatus),
    // Demo project only: suggested initial quantity (undefined elsewhere).
    demoQuantity: file.demoQuantity,
    parts: parts.map((part, index) => ({
      width: Math.round(part.width * 10) / 10,
      height: Math.round(part.height * 10) / 10,
      // Display color persisted at import; deterministic fallback for
      // legacy files so the list matches the live view and result SVG.
      color: resolvePartColor(part, file.slug, index),
    })),
    // Purge 24 h (D-PRV-10) : géométrie/blobs purgés → l'UI affiche
    // « expiré » et masque compteur/preview. Champs additifs.
    expired: Boolean(file.purgedAt),
    uploadAt: file.uploadAt ?? null,
  };
};

const mapStripFileToUi = async (userId, file) => {
  return {
    slug: file.slug,
    name: file.name,
    dxfUrl: `/api/files/strip/dxf/${file.slug}`,
    minHeight: await minRequiredHeight(userId, file),
    processingStatus: mapProcessingStatus(file.processingStatus),
    // Purge 24 h (D-PRV-10) — voir mapBinFileToUi.
    expired: Boolean(file.purgedAt),
    uploadAt: file.uploadAt ?? null,
  };
};

// Minimum strip height required to nest a file is the tallest of its polygon
// parts, since every part must fit within the strip height.
// Decrypts the enc blob when the vault is enabled, passes legacy plaintext
// through untouched.
const minRequiredHeight = async (userId, file) => {
  const parts = await resolvePolygonParts(userId, file);
  const heights = parts
    .map((part) => part.height)
    .filter((height) => typeof height === "number");

  if (heights.length === 0) {
    return null;
  }

  return Math.max(...heights);
};

const FILE_MAPPERS = {
  bin: mapBinFileToUi,
  strip: mapStripFileToUi,
};

/**
 * Jobs of a domain for a user (optionally scoped to a project), newest
 * first. Backs the results endpoints of both domains.
 */
export async function listJobs(domain, userId, projectSlug) {
  const db = await connectDB();
  return db
    .collection(domain.jobsCollection)
    .find({
      ownerId: userId,
      ...(projectSlug && { [domain.projectSlugField]: projectSlug }),
    })
    .sort({ createdAt: -1 })
    .toArray();
}

export function buildJobSlug(domain, fileMetadata) {
  return `${domain.jobSlugPrefix}${fileMetadata
    .map((file) => {
      const token = file.simpleName
        ? standardSlugify(file.simpleName, { keepCase: false })
        : String(file.slug || "f").replace(/\.[^.]+$/, "");
      return token + "_" + file.count;
    })
    .join("-")}-${generateRandomString(6)}`;
}

/**
 * Subscription / free-quota gate + vault gate + job insertion, shared by the
 * nest routes of both domains. The route validates the domain-specific
 * params and builds fileMetadata beforehand; `extraFields` carries
 * domain-only job fields (e.g. { priority } for bin). A route that already
 * gated the user itself (bin needs the charge to pick the compute tier)
 * passes it via `charge` so the quota is not consumed twice.
 */
export async function enqueueNestingJob(
  domain,
  { userId, projectSlug, fileMetadata, params, extraFields = {}, charge = null, skipVaultGate = false, initialStatus = "pending", localConfig = null }
) {
  const db = await connectDB();

  // Consumes a unit only once the request is fully validated. The charge is
  // stored on the job so the worker can refund it if the nesting fails.
  const finalCharge = charge ?? (await assertCanNest(userId));

  // Encrypted vaults must be unlocked before a job can be enqueued — the
  // workers need an active session to read the source files. Also refreshes
  // the sliding TTL so the session outlives the job. Demo jobs skip this:
  // the demo files are plaintext and shared, the user's vault is irrelevant.
  if (!skipVaultGate) {
    await requireFileAccess(userId);
  }

  const jobSlug = buildJobSlug(domain, fileMetadata);

  await db.collection(domain.jobsCollection).insertOne({
    slug: jobSlug,
    [domain.projectSlugField]: projectSlug,
    files: fileMetadata,
    params: params,
    status: initialStatus,
    // J-090 : profil compute imposé serveur pour un job 100 % navigateur
    // (null pour les jobs classiques — champ absent de la projection).
    ...(localConfig ? { localConfig } : {}),
    ...extraFields,
    createdAt: new Date(),
    ownerId: userId,
    charge: finalCharge,
  });

  return {
    slug: jobSlug,
  };
}
