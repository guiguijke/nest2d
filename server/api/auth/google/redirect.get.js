import { defineEventHandler, setCookie, getCookie } from "h3";

/**
 * Builds the Google OAuth 2.0 authorization URL using the modern
 * Authorization Code flow with PKCE.
 *
 * PKCE (Proof Key for Code Exchange) replaces the deprecated Implicit flow
 * (response_type=token) that Google no longer accepts for new OAuth apps.
 *
 * Flow:
 *   1. Here we generate a random `code_verifier` and derive its SHA-256
 *      `code_challenge`. The verifier is stored in a short-lived cookie.
 *   2. The user is redirected to Google with the code_challenge.
 *   3. Google redirects back to /auth/google/callback with an authorization
 *      `code` (NOT a token).
 *   4. The callback exchanges the code + the verifier (from the cookie) for
 *      an access token at Google's token endpoint.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const clientId = config.public.googleClientId;
  const baseUrl = config.public.baseUrl;

  if (!clientId) {
    throw createError({
      statusCode: 503,
      statusMessage: "Google OAuth is not configured (NUXT_PUBLIC_GOOGLE_CLIENT_ID is empty)",
    });
  }

  // 1. Generate PKCE pair.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);

  // 2. Persist the verifier in a short-lived, HttpOnly cookie so the callback
  //    can complete the exchange. 10 minutes is plenty for a user to sign in.
  setCookie(event, "oauth_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  // CSRF / OACB: random `state` bound to the same cookie lifetime as PKCE
  // (pentest M-6). PKCE + SameSite=Lax already cover the main risk; state
  // is belt-and-braces.
  const oauthState = generateCodeVerifier();
  setCookie(event, "oauth_state", oauthState, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  // 3. Build the authorization URL.
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.append("client_id", clientId);
  url.searchParams.append("redirect_uri", `${baseUrl}/auth/google/callback`);
  url.searchParams.append("response_type", "code");
  url.searchParams.append("scope", "email profile");
  url.searchParams.append("code_challenge", codeChallenge);
  url.searchParams.append("code_challenge_method", "S256");
  url.searchParams.append("state", oauthState);
  url.searchParams.append("access_type", "online");
  url.searchParams.append("prompt", "select_account");

  return { url: url.toString() };
});

/** Cryptographically-random URL-safe string (43-128 chars). */
function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** S256 code challenge = base64url(sha256(verifier)). */
async function computeCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  const str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// btoa is not global in Node < 20. Provide a fallback for server runtime.
if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (str) => Buffer.from(str, "binary").toString("base64");
}
