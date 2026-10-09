/**
 * Connecting LinkedIn (clause 11, 12.1).
 *
 * THE GAP THIS FILLS
 *
 * `_shared/linkedin.ts` could already publish a post, refresh an expiring token and degrade
 * gracefully when analytics is unavailable. `linkedin_auth` has held a single empty row since
 * migration 0011, and `worker-ops` has been watching an expiry date that never existed.
 *
 * Nothing could put the first token in. A grep for "linkedin.com/oauth" across the repository
 * returned nothing at all. Every part of the LinkedIn integration was built except the door.
 *
 * WHY THIS IS AN EDGE FUNCTION AND NOT A ROUTE IN THE DESK
 *
 * The obvious place is `app/`, next to the magic-link callback. It cannot go there. The desk talks
 * to Postgres as the signed-in user through the anon key — deliberately, so that every guarantee in
 * migration 0006 applies to everything it does — and migration 0011 revokes all access to
 * `linkedin_auth` from `anon` and `authenticated` with no policy granting any of it back. The desk
 * cannot write this row, and giving it the service role to do so would trade a real security
 * property for one page.
 *
 * So the exchange happens here, where service_role is already the identity, and the desk never
 * touches the token. That is also what migration 0011's own comment says should be true.
 *
 * TWO ROUTES
 *
 *   GET /linkedin-oauth/start     -> authorises the caller, redirects to LinkedIn
 *   GET /linkedin-oauth/callback  -> LinkedIn returns here with a code; exchange it and store it
 *
 * Deploy with --no-verify-jwt. LinkedIn's redirect cannot carry a Supabase JWT, so the platform's
 * own gate has to be off and the authorisation has to be done in the code below. That makes the
 * `start` check the only thing standing between a stranger and connecting THEIR LinkedIn account to
 * Josh's system, so it fails closed in every direction.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadSecrets, secret } from "../_shared/secrets.ts";

const AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO = "https://api.linkedin.com/v2/userinfo";

/**
 * `openid` and `profile` are needed only to learn the member URN, which becomes the `author` on
 * every post. `w_member_social` is the one that matters and is self-serve.
 *
 * `r_member_postAnalytics` is NOT requested by default. It sits behind Community Management API
 * review, and asking for a scope the app has not been granted makes LinkedIn reject the whole
 * authorisation rather than granting the subset — so requesting it optimistically would break the
 * thing that works in order to attempt the thing that does not. Pass ?analytics=1 once the review
 * has actually come back.
 */
const BASE_SCOPES = ["openid", "profile", "w_member_social"];
const ANALYTICS_SCOPE = "r_member_postAnalytics";

const STATE_TTL_MS = 10 * 60 * 1000;

/* ── State signing ────────────────────────────────────────────────────────── */
//
// The state carries its own expiry and is signed, so nothing has to be stored between the two
// requests and there is no table to clean up.
//
// It is signed with LINKEDIN_CLIENT_SECRET rather than a new secret of its own. That is a
// deliberate call: adding a name to SECRET_NAMES means editing _shared/secrets.ts, which every one
// of the ten Edge Functions bundles its own copy of, so a one-line addition costs ten redeploys.
// The client secret is already required for this exact flow to work at all, is already high
// entropy, and is scoped to this one integration. If the flow ever needs a key of its own, that is
// the moment to add one.

async function signer(): Promise<CryptoKey> {
  const key = secret("LINKEDIN_CLIENT_SECRET");
  if (!key) throw new Error("LINKEDIN_CLIENT_SECRET is not in the vault");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function makeState(): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    exp: Date.now() + STATE_TTL_MS,
    n: b64url(crypto.getRandomValues(new Uint8Array(16))),
  })));
  const mac = await crypto.subtle.sign("HMAC", await signer(), new TextEncoder().encode(payload));
  return `${payload}.${b64url(mac)}`;
}

async function checkState(state: string | null): Promise<string | null> {
  if (!state || !state.includes(".")) return "no state was returned";
  const [payload, mac] = state.split(".");

  // Recomputed and compared as bytes rather than by rebuilding the string, so a forged payload
  // cannot be smuggled past by a different but equivalent encoding.
  const expected = b64url(
    await crypto.subtle.sign("HMAC", await signer(), new TextEncoder().encode(payload)),
  );
  if (expected.length !== mac.length) return "the state signature does not match";
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  if (diff !== 0) return "the state signature does not match";

  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof exp !== "number" || Date.now() > exp) return "the connect link has expired";
  } catch {
    return "the state could not be read";
  }
  return null;
}

/* ── Who is allowed to start this ─────────────────────────────────────────── */

/**
 * Authorise the caller of /start.
 *
 * Fails closed at every step. The consequence of getting this wrong is not a leak — it is that a
 * stranger connects THEIR LinkedIn account, and Josh's approved posts then publish to it.
 *
 * ALLOWED_EMAIL is read from the environment rather than the vault because it is a configuration
 * value, not a credential, and it is the same variable the desk already uses.
 *
 * NOTE ON "*": the desk currently accepts any email so that Josh could be handed a test link
 * without an account being provisioned first. A wildcard is not acceptable HERE, and is rejected,
 * because signing in to read a draft and connecting a publishing identity are not the same risk.
 */
async function callerIsAllowed(req: Request): Promise<string | null> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return "sign in to The desk first — this link needs your session";

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return "the function is misconfigured: no SUPABASE_ANON_KEY";

  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await asUser.auth.getUser();
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return "that session is not valid";

  const allowed = (Deno.env.get("LINKEDIN_CONNECT_EMAIL") ?? Deno.env.get("ALLOWED_EMAIL") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  if (allowed.length === 0) {
    return "no LINKEDIN_CONNECT_EMAIL is set, so nobody is permitted to connect LinkedIn yet";
  }
  if (allowed.includes("*")) {
    return "LINKEDIN_CONNECT_EMAIL must name an address — a wildcard cannot connect a publishing " +
      "identity. Set LINKEDIN_CONNECT_EMAIL to Josh's address.";
  }
  if (!allowed.includes(email)) return "that account is not permitted to connect LinkedIn";
  return null;
}

/* ── Routes ───────────────────────────────────────────────────────────────── */

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const redirectUri = (req: Request) => new URL("./callback", new URL(req.url)).toString();

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
      `<title>${title}</title>` +
      `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#1a1a1a}` +
      `h1{font-size:1.3rem}code{background:#f2f2f0;padding:.1em .35em;border-radius:3px}</style>` +
      `<h1>${title}</h1>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function start(req: Request): Promise<Response> {
  const denied = await callerIsAllowed(req);
  if (denied) return page("Not permitted", `<p>${denied}</p>`, 403);

  const url = new URL(req.url);

  // Refuse to overwrite a working connection by accident. Reconnecting is legitimate — the token
  // lasts 60 days — but it should be deliberate, because the failure mode is publishing to the
  // wrong identity and nothing downstream would question it.
  const { data: existing } = await db.from("linkedin_auth")
    .select("member_urn, access_token, access_expires_at").eq("id", true).single();
  const live = Boolean(existing?.access_token) && Boolean(existing?.member_urn) &&
    (!existing!.access_expires_at || new Date(existing!.access_expires_at) > new Date());
  if (live && url.searchParams.get("force") !== "1") {
    return page(
      "Already connected",
      `<p>LinkedIn is already connected as <code>${existing!.member_urn}</code>.</p>` +
        `<p>To replace it, add <code>?force=1</code>.</p>`,
      409,
    );
  }

  const clientId = secret("LINKEDIN_CLIENT_ID");
  if (!clientId) return page("Not configured", "<p>LINKEDIN_CLIENT_ID is not in the vault.</p>", 500);

  const scopes = [...BASE_SCOPES];
  if (url.searchParams.get("analytics") === "1") scopes.push(ANALYTICS_SCOPE);

  const authorize = new URL(AUTHORIZE);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri(req));
  authorize.searchParams.set("scope", scopes.join(" "));
  authorize.searchParams.set("state", await makeState());

  return Response.redirect(authorize.toString(), 302);
}

async function callback(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // LinkedIn reports a refusal in the query string with a 200, so this has to be read before
  // anything else or it looks like a malformed request.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const why = url.searchParams.get("error_description") ?? oauthError;
    await db.from("linkedin_auth").update({ last_error: `authorisation refused: ${why}` })
      .eq("id", true);
    return page("Not connected", `<p>LinkedIn refused the authorisation: ${why}</p>`, 400);
  }

  const bad = await checkState(url.searchParams.get("state"));
  if (bad) return page("Not connected", `<p>${bad}. Start again from The desk.</p>`, 400);

  const code = url.searchParams.get("code");
  if (!code) return page("Not connected", "<p>LinkedIn returned no code.</p>", 400);

  const clientId = secret("LINKEDIN_CLIENT_ID");
  const clientSecret = secret("LINKEDIN_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return page("Not configured", "<p>The LinkedIn credentials are not in the vault.</p>", 500);
  }

  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(req),
    }),
  });
  const token = await res.json().catch(() => null);
  if (!res.ok || !token?.access_token) {
    const why = `token exchange failed: ${res.status} ${JSON.stringify(token)?.slice(0, 300)}`;
    await db.from("linkedin_auth").update({ last_error: why }).eq("id", true);
    return page("Not connected", `<p>${why}</p>`, 502);
  }

  // The member URN is the `author` on every post, so a connection without it is useless. Fetched
  // here rather than at publish time: this is the one moment the flow is allowed to fail loudly.
  const who = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = await who.json().catch(() => null);
  if (!who.ok || !profile?.sub) {
    const why = `could not read the member id: ${who.status} ${JSON.stringify(profile)?.slice(0, 200)}`;
    await db.from("linkedin_auth").update({ last_error: why }).eq("id", true);
    return page("Not connected", `<p>${why}</p>`, 502);
  }

  const granted: string = token.scope ?? "";
  const now = Date.now();

  const { error } = await db.from("linkedin_auth").update({
    member_urn: `urn:li:person:${profile.sub}`,
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? null,
    access_expires_at: token.expires_in ? new Date(now + token.expires_in * 1000).toISOString() : null,
    refresh_expires_at: token.refresh_token_expires_in
      ? new Date(now + token.refresh_token_expires_in * 1000).toISOString()
      : null,
    scopes: granted,
    // Read from what was actually GRANTED, never from what was asked for. The two differ whenever
    // Community Management review has not come back, and believing the request would make
    // worker-metrics call an endpoint it has no right to on every published post.
    has_post_analytics: granted.includes(ANALYTICS_SCOPE),
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
  }).eq("id", true);

  if (error) return page("Not connected", `<p>Could not store the token: ${error.message}</p>`, 500);

  // A refresh token is a program-dependent privilege, not a guarantee. Without one the connection
  // simply expires in 60 days and has to be redone — which worker-ops already warns about. Saying
  // so here is the difference between a known chore and a silent stop two months after handover.
  const renewal = token.refresh_token
    ? `<p>A refresh token was issued, so this should renew itself.</p>`
    : `<p><strong>No refresh token was issued.</strong> This connection expires in about 60 days ` +
      `and will need reconnecting. You will be warned before it lapses.</p>`;

  const analytics = granted.includes(ANALYTICS_SCOPE)
    ? `<p>Post analytics is granted, so engagement numbers will be collected.</p>`
    : `<p>Post analytics was not granted, which is expected until Community Management review ` +
      `comes back. Publishing works; the numbers will simply be recorded as unavailable.</p>`;

  // The desk is retired, so there is nowhere to send him back TO. This page is the end of the
  // journey now, and it says what to do next rather than offering a link to nothing.
  return page(
    "LinkedIn connected",
    `<p>Connected as <code>urn:li:person:${profile.sub}</code>.</p>${renewal}${analytics}` +
      `<p>Nothing else to do here. Back in Claude Code, ask for the next piece of work.</p>`,
  );
}

Deno.serve(async (req) => {
  await loadSecrets(db);
  const path = new URL(req.url).pathname.replace(/\/+$/, "");

  if (path.endsWith("/start")) return await start(req);
  if (path.endsWith("/callback")) return await callback(req);

  return page(
    "LinkedIn",
    `<p>Two routes: <code>/start</code> to connect, <code>/callback</code> for LinkedIn's redirect.</p>`,
    404,
  );
});
