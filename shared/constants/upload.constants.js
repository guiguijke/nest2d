/**
 * Upload budget advertised in the dropzone ("max 5 MB each", "up to 20
 * files"). Enforced on the server (H-4) and mirrored in the client so a
 * crafted request cannot skip the UI filter.
 */
export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024
export const MAX_UPLOAD_FILES = 20
