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

export async function streamToString(readable) {
  let result = "";
  for await (const chunk of readable) {
    result += chunk;
  }
  return result;
}
