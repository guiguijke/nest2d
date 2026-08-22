import { getCookie, setCookie } from "h3";
import crypto from "node:crypto";
import { TRACKING_COOKIE_NAME } from "~~/server/tracking/const";
import { createOrUpdateUser } from "~~/server/utils/user";
import { setSessionCookie } from "~~/server/utils/user";

/**
 * Completes the Google OAuth Authorization Code + PKCE flow.
 *
 * Receives the authorization `code` returned by Google on the callback,
 * exchanges it (together with the PKCE verifier stored in a cookie) for an
 * access token at Google's token endpoint, then fetches the user profile and
 * creates/updates the local user.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const clientId = config.public.googleClientId;
  const clientSecret = config.googleClientSecret;
  const baseUrl = config.public.baseUrl;

  const body = await readBody(event);
  const code = body?.code;
  const state = typeof body?.state === "string" ? body.state : "";

  if (!code) {
    setResponseStatus(event, 400);
    return { error: "Missing authorization code" };
  }

  const cookieState = getCookie(event, "oauth_state") || "";
  if (!sameOauthSecret(state, cookieState)) {
    setResponseStatus(event, 400);
    return { error: "Invalid OAuth state. Please retry login." };
  }

  const codeVerifier = getCookie(event, "oauth_code_verifier");
  if (!codeVerifier) {
    setResponseStatus(event, 400);
    return { error: "Missing PKCE verifier (cookie expired). Please retry login." };
  }

  // 1. Exchange the authorization code for tokens.
  const tokenParams = new URLSearchParams();
  tokenParams.append("code", code);
  tokenParams.append("client_id", clientId);
  tokenParams.append("code_verifier", codeVerifier);
  tokenParams.append("redirect_uri", `${baseUrl}/auth/google/callback`);
  tokenParams.append("grant_type", "authorization_code");
  // Client secret is optional for PKCE-only (installed/public) apps, but
  // required for "Web application" apps configured with a secret. Send it
  // only if configured.
  if (clientSecret) {
    tokenParams.append("client_secret", clientSecret);
  }

  let tokenResponse;
  try {
    tokenResponse = await $fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });
  } catch (err) {
    setResponseStatus(event, 401);
    return {
      error: "Failed to exchange authorization code",
      detail: err?.data?.error_description || err?.data?.error || err?.message,
    };
  }

  const accessToken = tokenResponse.access_token;
  if (!accessToken) {
    setResponseStatus(event, 401);
    return { error: "No access token in Google response" };
  }

  // 2. Fetch the user profile with the access token.
  const data = await $fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const { sub, picture, email, name } = data;

  if (!sub || !email || !name) {
    setResponseStatus(event, 401);
    return { error: "Invalid profile data from Google", isSub: !!sub, isEmail: !!email, isName: !!name };
  }

  // 3. Create or update the local user (same as the legacy implicit flow).
  const trackingSessionId = getCookie(event, TRACKING_COOKIE_NAME);

  const session = await createOrUpdateUser({
    event,
    sessionId: trackingSessionId,
    providerId: sub,
    email,
    name,
    avatarUrl: picture,
  });

  setSessionCookie(event, session);

  // 4. Clear the single-use PKCE verifier + state cookies.
  setCookie(event, "oauth_code_verifier", "", { maxAge: 0, path: "/" });
  setCookie(event, "oauth_state", "", { maxAge: 0, path: "/" });

  return { ok: true };
});

function sameOauthSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
