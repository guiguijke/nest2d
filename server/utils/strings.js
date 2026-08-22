import { randomBytes } from "node:crypto";

/**
 * Cryptographically secure random string.
 *
 * Used for session ids and Stripe checkout internal ids — both are
 * security-sensitive, so Math.random() (a non-cryptographic PRNG) is unsafe.
 * Matches the pattern used by the admin panel (randomBytes + hex).
 */
export function generateRandomString(count) {
  const bytes = randomBytes(Math.ceil(count / 2));
  return bytes.toString("hex").slice(0, count);
}

/**
 * Opaque GridFS / file slug (pentest C-1). 16 hex chars = 64 bits of
 * entropy — guessing a victim's file is no longer a hours-long brute
 * force even without the /api/files rate limit. The original filename
 * is stored separately on the Mongo file record for the owner's UI.
 */
export const FILE_SLUG_RANDOM_LEN = 16
export const PROJECT_SLUG_RANDOM_LEN = 12

export function makeOpaqueFileSlug(ext) {
  const raw = String(ext || "").toLowerCase();
  const kept = raw.startsWith(".") ? raw : raw ? `.${raw}` : ".dxf";
  return `f-${generateRandomString(FILE_SLUG_RANDOM_LEN)}${kept}`;
}

/** Project title from an uploaded basename (cloud path — names already on the server). */
export function titleFromFileName(name) {
  const base = String(name || "")
    .replace(/^.*[/\\]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[\u0000-\u001f<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 80);
}

export function generateEntityName() {
  const adjectives = [
    "brave",
    "clever",
    "bright",
    "swift",
    "mighty",
    "calm",
    "gentle",
    "fierce",
    "happy",
    "bold",
  ];
  const nouns = [
    "turing",
    "curie",
    "einstein",
    "newton",
    "tesla",
    "bohr",
    "feynman",
    "lovelace",
    "hopper",
    "galileo",
  ];

  const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const name = `${getRandomElement(adjectives)}-${getRandomElement(nouns)}`;

  return name;
}
