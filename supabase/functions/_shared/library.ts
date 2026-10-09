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
/**
 * Add to a library section without replacing it — 8.8's "in under a minute", and 8.1's transcript.
 *
 * One implementation for what were two: the `/rule` command appended a bullet, and the voice-guide
 * capture appended a dated block. Both were inside the Telegram webhook and both are needed from
 * Claude Code now, so they live here and differ only in `shape`.
 *
 * `.eq("immutable", false)` is kept and is not decoration. The sections holding the two rules the
 * learning loop may never touch are marked immutable, a database trigger refuses them, and this
 * filter means an append aimed at one changes nothing rather than erroring in a way a caller might
 * swallow. The return value says whether anything moved, so a refusal is reportable.
 *
 * Appending rather than rewriting is the whole point. 8.6 says a library edit reaches the very next
 * draft, and a tool that could replace a section wholesale would let one careless call erase the
 * voice guide. There is deliberately no setter here.
 */
export async function appendToSection(
  db: SupabaseClient,
  key: string,
  text: string,
  shape: "rule" | "block",
  label?: string,
): Promise<{ ok: boolean; words: number; why?: string }> {
  const body = (text ?? "").trim();
  if (!body) return { ok: false, words: 0, why: "There was nothing to add." };

  const { data: section } = await db
    .from("library_sections")
    .select("body, immutable, title")
    .eq("key", key)
    .maybeSingle();

  if (!section) return { ok: false, words: 0, why: `There is no library section called "${key}".` };
  if (section.immutable) {
    return {
      ok: false,
      words: 0,
      why: `"${section.title ?? key}" holds a rule that is not open to adjustment, whatever the ` +
        `evidence says. That is deliberate (12.1), and the database refuses it too.`,
    };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const existing = String(section.body ?? "").trimEnd();

  const addition = shape === "rule"
    // One bullet, as the command produced. The leading dash is stripped if he typed one.
    ? `\n\n- ${body.replace(/^[-*]\s*/, "")}  _(added ${stamp})_\n`
    // A dated block, as the voice-guide append produced: the heading is what makes a long transcript
    // readable later, and what lets 8.1 be filled over several sittings.
    : `\n\n---\n\n## ${label ? `${label} — ` : ""}Added ${stamp}\n\n${body}\n`;

  const { data, error } = await db
    .from("library_sections")
    .update({ body: `${existing}${addition}` })
    .eq("key", key)
    .eq("immutable", false)
    .select("key");

  if (error) return { ok: false, words: 0, why: error.message };
  if ((data ?? []).length === 0) {
    return { ok: false, words: 0, why: `"${key}" refused the change.` };
  }

  return { ok: true, words: body.split(/\s+/).filter(Boolean).length };
}

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
