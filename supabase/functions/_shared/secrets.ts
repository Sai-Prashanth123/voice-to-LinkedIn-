/**
 * Credentials, held in Supabase Vault rather than in edge-function environment variables.
 *
 * WHY VAULT AND NOT A TABLE
 *
 * A normal table in `public` is reachable through PostgREST and — more dangerously — would be swept
 * into the full export that clause 6.2 requires ("must export in full to a plain, portable format on
 * demand"). That export exists to be moved around and handed over. Putting API keys in a table means
 * every copy of the idea bank carries live credentials.
 *
 * Vault is encrypted at rest, lives in a schema PostgREST does not expose, and the export in
 * `app/app/export/route.ts` enumerates `public` tables only. Keys stay put.
 *
 * WHY VAULT AND NOT ENV VARS
 *
 * Both work. Vault wins here on handover: clause 14.1 puts every account in Josh's name and 14.3
 * requires the system to keep running without us. Keys in Vault are visible to him in his own
 * database, survive redeploys, and can be rotated with one SQL statement — no dashboard archaeology,
 * no redeploy, and nothing that only we know how to change.
 *
 * WHAT VAULT DOES NOT PROTECT AGAINST
 *
 * Anyone holding the service_role key, or `postgres` in the SQL editor, can decrypt these. Vault
 * protects against a leaked export, a misconfigured RLS policy, and a stolen database backup. It is
 * not a defence against someone who already has admin access to the project.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Populated once per function invocation. Edge Functions are short-lived, so this stays fresh. */
let cache: Record<string, string> | null = null;

export const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "LLM_PROVIDER",
  "DEEPGRAM_API_KEY",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET",
  "TRANSCRIPT_WEBHOOK_SECRET",
  "SLACK_USER_TOKEN",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "HUGGINGFACE_API_KEY",
  "GEMINI_API_KEY",
  // 11.4 — where The desk is reachable. Read by rewriteLink so the "Rewrite it" button in the
  // weekly pass hands Josh a working link rather than the words "open The desk".
  "APP_URL",
] as const;

/**
 * Read every credential in one round trip. Call this once at the top of a worker, before anything
 * that needs a credential.
 *
 * Goes through `public.read_secrets()` rather than querying `vault.decrypted_secrets` directly:
 * Supabase exposes only the `public` schema over PostgREST, so the direct read always fails. It
 * failed silently for the first live message this system ever received — every secret came back
 * null, the bot could not recognise its own owner's chat id, and a real message was dropped while
 * the webhook returned 200. Hence the noise below.
 */
export async function loadSecrets(db: SupabaseClient): Promise<void> {
  if (cache) return;
  cache = {};

  let rpcError: string | null = null;
  try {
    const { data, error } = await db.rpc("read_secrets");
    if (error) rpcError = error.message;
    for (const row of (data ?? []) as { name: string; value: string }[]) {
      if (row.name && row.value) cache[row.name] = row.value;
    }
  } catch (err) {
    rpcError = err instanceof Error ? err.message : String(err);
  }

  // A worker with no credentials at all cannot do anything useful, and the ways it then fails are
  // quiet ones — a dropped message, an unauthorised-looking request, an empty queue. 13.2 is
  // explicit that failures surface rather than being swallowed, so this is recorded loudly.
  const loaded = Object.keys(cache).length;
  const envFallback = SECRET_NAMES.some((n) => Deno.env.get(n));
  if (loaded === 0 && !envFallback) {
    try {
      await db.from("system_events").insert({
        kind: "secrets_unavailable",
        severity: "error",
        detail: {
          error: rpcError ?? "read_secrets returned nothing",
          hint: "Check public.read_secrets() exists and is granted to service_role (migration 0014).",
        },
      });
    } catch { /* if even this fails, the logs are the only remaining signal */ }
  }
}

/**
 * Vault first, then the environment. Returns null when neither has it, so callers can degrade
 * rather than crash: a missing OPENAI_API_KEY should cost us dedup, not the whole run.
 */
export function secret(name: string): string | null {
  return cache?.[name] ?? Deno.env.get(name) ?? null;
}

/** For credentials without which the work is meaningless. */
export function requireSecret(name: string): string {
  const value = secret(name);
  if (!value) {
    throw new Error(
      `${name} is not set. Add it with: select vault.create_secret('<value>', '${name}');`,
    );
  }
  return value;
}

/** Which credentials are present, for the ops report. Never returns a value. */
export function secretStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of SECRET_NAMES) out[name] = secret(name) !== null;
  return out;
}
