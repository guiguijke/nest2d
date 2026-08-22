/**
 * Domain registry for the two nesting flavours: "bin" (classic workspace
 * projects) and "strip" (strip packing, feature-flagged per user).
 *
 * Collections and GridFS buckets stay separate per domain — this registry is
 * the single place mapping a domain to its storage and naming, so the shared
 * services in server/core/project/ never hardcode them. Adding a third
 * nesting flavour should only require a new entry here.
 */
export const DOMAINS = {
  bin: {
    id: "bin",
    projectsCollection: "projects",
    filesCollection: "user_dxf_files",
    jobsCollection: "nesting_jobs",
    // Field on file/job docs referencing the owning project slug.
    projectSlugField: "projectSlug",
    dxfBucket: "userDxf",
    workerTag: "normal",
    jobSlugPrefix: "nested-",
    projectLabel: "Project",
    trackCreateFile: "create_project_dxf_file",
    // The bin project list also exposes the raw jobs queue and per-project
    // result counts to the UI; the strip list does not.
    includeJobsInProjectList: true,
    // Reject foreign slugs with 404 (same as missing) so a guessed slug
    // cannot leak the project name / createdAt (pentest M-4).
    rejectForeignProject: true,
  },
  strip: {
    id: "strip",
    projectsCollection: "strip_projects",
    filesCollection: "strip_user_dxf_files",
    jobsCollection: "strip_nesting_job_queue",
    projectSlugField: "stripSlug",
    dxfBucket: "stripUserDxf",
    workerTag: "strip",
    jobSlugPrefix: "strip-nested-",
    projectLabel: "Strip project",
    trackCreateFile: "create_strip_dxf_file",
    includeJobsInProjectList: false,
    rejectForeignProject: true,
  },
};
