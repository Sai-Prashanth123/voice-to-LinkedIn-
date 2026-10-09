/**
 * The deployed system, as it actually is right now.
 *
 * WHY THIS TIER EXISTS AT ALL
 *
 * A clean database built from the migrations proves the code. It cannot prove the deployment, and
 * the deployment is where a whole class of failure lives. Found while planning this harness: eight
 * of the ten Edge Functions were running shared code three days old, because every function bundles
 * its own copy of `_shared/` and nothing checks that a change to a shared file reached all ten.
 * `telegram-webhook` had the fix; `worker-select` did not. No unit test in the repo could say so.
 *
 * Everything here is READ-ONLY against Josh's project. Clause 6.3 means a fixture written here
 * could never be removed, so these cases look and do not touch.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

function credentials() {
  let file = "";
  try {
    file = readFileSync(join(ROOT, "eval", ".env"), "utf8");
  } catch { /* environment only */ }

  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();

  const url = field("SUPABASE_URL");
  const key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;

  return {
    url: url.replace(/\/+$/, ""),
    key,
    // Optional. Only the webhook case needs it, and it is read from the operator's own env rather
    // than from the database — system_health() deliberately names secrets without returning them,
    // and a harness that worked around that would defeat the reason it was written that way.
    botToken: field("TELEGRAM_BOT_TOKEN") ?? null,
    /*
     * Through field() like every other credential here, which it was not until 9 October.
     *
     * functions() read process.env.SUPABASE_ACCESS_TOKEN directly, so a token sitting in eval/.env
     * next to the other three was never seen — and the three cases that depend on it reported "no
     * SUPABASE_ACCESS_TOKEN, so the deployed function list cannot be read" while the token was on
     * line 5 of that file and answered the API with a 200 when curled by hand. Three deployment
     * checks had been blocked on a credential that was present the whole time.
     */
    accessToken: field("SUPABASE_ACCESS_TOKEN") ?? null,
  };
}

export async function openLive() {
  const creds = credentials();
  if (!creds) return null;

  const headers = {
    apikey: creds.key,
    Authorization: "Bearer " + creds.key,
    "Content-Type": "application/json",
  };

  /** PostgREST read. Throws with the body, because PostgREST puts the useful half in `hint`. */
  async function rest(path) {
    const res = await fetch(creds.url + "/rest/v1/" + path, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(path + " -> " + res.status + " " + text.slice(0, 200));
    return text ? JSON.parse(text) : [];
  }

  /**
   * The deployment snapshot: cron jobs, policy and constraint counts, which secrets exist, and any
   * destructive grant.
   *
   * One fixed function taking no arguments (migration 0029) rather than a run-this-SQL endpoint.
   * The shortcut would have been a function that executes a query string, which is a remote console
   * with the service role behind it — not something to leave in a client's project whatever the
   * intent.
   *
   * Returns null when the function is not deployed, so a case skips with a reason rather than
   * guessing.
   */
  async function health() {
    const res = await fetch(creds.url + "/rest/v1/rpc/system_health", {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new Error("system_health -> " + res.status + " " + text.slice(0, 200));
    return text ? JSON.parse(text) : null;
  }

  /** Telegram's own view of the webhook — the only place a delivery failure is visible. */
  async function telegram(method) {
    if (!creds.botToken) return null;
    const res = await fetch("https://api.telegram.org/bot" + creds.botToken + "/" + method, {
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => null);
    return body && body.ok ? body.result : null;
  }

  /**
   * Which Edge Functions are deployed and when.
   *
   * Needs a Supabase personal access token, which is a credential rather than a project setting —
   * so without one the freshness case skips and says so, instead of quietly reporting health it
   * has not checked.
   */
  async function functions() {
    const pat = creds.accessToken;

    // null means one thing only: nobody supplied a token. Every other failure throws, because the
    // callers turn null into "no SUPABASE_ACCESS_TOKEN" and that sentence has to be true when it is
    // printed. A rejected token and an absent one are the two failures the runbook warns look
    // identical, and reporting the second when it is the first sends the reader to the wrong file.
    if (!pat) return null;

    const ref = (creds.url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
    if (!ref) {
      throw new Error(`SUPABASE_URL is not a project URL, so there is no ref to query: ${creds.url}`);
    }

    const res = await fetch("https://api.supabase.com/v1/projects/" + ref + "/functions", {
      headers: { Authorization: "Bearer " + pat },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(
        `the Supabase API refused the access token: HTTP ${res.status}. ` +
          `The token is present, so this is a rejected or expired credential rather than a missing ` +
          `one. ${body}`,
      );
    }
    return await res.json();
  }

  return { url: creds.url, rest, health, telegram, functions, hasBotToken: Boolean(creds.botToken) };
}
