/**
 * The reference library (clause 8).
 *
 * 8.6 — a change must apply to the very next draft. So this is read at call time and never cached
 *       across invocations. Edge Functions are per-invocation anyway; do not add a module-level cache.
 * 8.7 — read at drafting AND at gating. Both paths come through here, so the gate is judging against
 *       the same rules the drafter was given, and Josh can change both by editing one document.
 * 8.4 — every draft records the library version that wrote it, returned here as `version`.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Library } from "./types.ts";
import { type LibraryViewName, renderLibrary } from "./views.ts";

/**
 * The section lists and the rendering moved to views.ts, which imports nothing, so the MCP server
 * reads exactly the same ones. They were duplicated there briefly and the copy handed the gate
 * every section - including the two it must never see. See the note in that file.
 */
export type LibraryView = LibraryViewName;

export async function loadLibrary(db: SupabaseClient, view: LibraryView): Promise<Library> {
  const { data, error } = await db
    .from("library_sections")
    .select("key, title, body, sort_order")
    .order("sort_order");
  if (error) throw new Error(`library load failed: ${error.message}`);

  const { sections, prompt } = renderLibrary(data ?? [], view);

  const { data: ver } = await db
    .from("library_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    version: ver?.version ?? 1,
    sections,
    prompt,
  };
}

/**
 * The pillar names Josh has actually defined (clause 8).
 *
 * Without this, `ExtractionSchema.pillar` is an unconstrained string and the model invents a
 * plausible-sounding category. Invented pillars are worse than none: `scoreCandidates()` balances
 * across pillars (7.1), so made-up categories quietly corrupt which moment gets written next.
 *
 * Deliberately conservative — it reads markdown headings and list items and ignores prose, so the
 * placeholder text sitting in the section today yields nothing rather than a phantom pillar.
 */
export function parsePillars(body: string): string[] {
  const out: string[] = [];

  for (const raw of (body ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // "## Positioning" or "- Positioning — what it covers"
    const heading = line.match(/^#{2,}\s+(.{2,60})$/);
    const bullet = line.match(/^[-*]\s+(.{2,60})$/);
    const candidate = heading?.[1] ?? bullet?.[1];
    if (!candidate) continue;

    // Take the name, not the explanation that usually follows it.
    const name = candidate.split(/[—–:|]/)[0].replace(/[*_`]/g, "").trim();
    if (name.length < 2 || name.length > 40) continue;

    // The section ships with instructions for Josh. Those are not pillars.
    if (/^(for josh|not drafted|what goes here|starter|three to five|content pillars)/i.test(name)) {
      continue;
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Resolve the exact section bodies a given library version pinned. Used by the regression harness
 * to re-draft an old moment under an old library, and by 12.12 rollback.
 */
export async function loadLibraryAtVersion(
  db: SupabaseClient,
  version: number,
): Promise<Record<string, string>> {
  const { data: snap } = await db
    .from("library_versions")
    .select("sections")
    .eq("version", version)
    .maybeSingle();
  if (!snap) throw new Error(`library version ${version} not found`);

  const pinned = snap.sections as Record<string, number>;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(pinned)) {
    const { data } = await db
      .from("library_section_versions")
      .select("body")
      .eq("key", key)
      .eq("version", v)
      .maybeSingle();
    out[key] = data?.body ?? "";
  }
  return out;
}
