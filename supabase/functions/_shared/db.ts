/**
 * Supabase access for the workers.
 *
 * Workers run as `service_role`. Note what that does NOT grant: DELETE is revoked from service_role
 * on every table in `public` (migration 0006), so 6.3 — "nothing may be deleted by the system" —
 * holds even if a worker tries.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Material, Moment, MomentName } from "./types.ts";

export function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Throw on a Supabase error rather than letting a null result flow onward silently (13.2). */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no rows returned`);
  return res.data;
}

export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return data.value as T;
}

export async function getMoment(db: SupabaseClient, id: number): Promise<Moment> {
  return unwrap(await db.from("moments").select("*").eq("id", id).single(), `moment ${id}`);
}

export async function getMaterial(db: SupabaseClient, momentId: number): Promise<Material | null> {
  const { data } = await db.from("material").select("*").eq("moment_id", momentId).maybeSingle();
  return (data as Material) ?? null;
}

export async function getNames(db: SupabaseClient, momentId: number): Promise<MomentName[]> {
  const { data } = await db.from("moment_names").select("*").eq("moment_id", momentId);
  return (data as MomentName[]) ?? [];
}

/**
 * Re-exported so every worker keeps importing it from here. The list itself moved to entry.ts,
 * which imports nothing, so the MCP server can read the same one - see the note in that file.
 */
export { sourceEntry, SOURCE_FIELDS } from "./entry.ts";

/** 13.2 — failures surface rather than being swallowed. */
export async function logEvent(
  db: SupabaseClient,
  kind: string,
  severity: "info" | "warn" | "error",
  detail: Record<string, unknown> = {},
  source?: string,
): Promise<void> {
  await db.from("system_events").insert({ kind, severity, detail, source: source ?? null });
}

/** Move a moment to parked with a plain-language reason (9.8). Never deletes. */
export async function park(db: SupabaseClient, momentId: number, reason: string): Promise<void> {
  await db.from("moments").update({
    status: "parked",
    parked_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);
}

/**
 * PostgREST returns a one-to-MANY embed as an array and a one-to-ONE embed as a single object.
 * `outcomes.post_id` and `material.moment_id` are primary keys referencing their parent, so those
 * arrive as objects. Indexing them with [0] yields undefined and fails silently — a post's metrics
 * would simply render as blank rather than throwing. Every embed is read through here.
 */
export function embedOne<T>(embedded: T | T[] | null | undefined): T | null {
  if (embedded == null) return null;
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
}
