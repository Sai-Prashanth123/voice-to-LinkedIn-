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
import type { Library, LibrarySectionKey } from "./types.ts";

/** What the drafter needs to write. */
const DRAFTING_SECTIONS: LibrarySectionKey[] = [
  "core_rules",
  "pillars",
  "frameworks",
  "hooks",
  "closes",
  "audience",
  "voice_guide",
  // 8.1 — the recorded interview behind the guide. Evidence of how he SOUNDS, never a source of
  // facts: 9.4 has no exception for it, and the claim ledger will not find a source span here.
  "voice_transcript",
  // 8.3 — structure borrowed from other writers, and nothing else about them.
  "reference_posts",
  "banned_phrases",
  "formatting",
];

/**
 * What the gate needs to judge. Deliberately not identical to the drafting view.
 *
 * The gate does not need frameworks, and it must NOT see `reference_posts`: a judge that has read
 * another writer's posts starts measuring against their voice rather than Josh's, which is clause
 * 8a's failure arriving through a side door. It does not see `voice_transcript` either — the voice
 * guide is the rule it judges against, and the transcript is the evidence behind the rule.
 */
const GATING_SECTIONS: LibrarySectionKey[] = [
  "core_rules",
  "hooks",
  "audience",
  "voice_guide",
  "banned_phrases",
  "gate_rules",
];

const INTERVIEW_SECTIONS: LibrarySectionKey[] = ["core_rules", "pillars", "audience", "prompt_set"];

export type LibraryView = "drafting" | "gating" | "interview" | "visual";

const VIEWS: Record<LibraryView, LibrarySectionKey[]> = {
  drafting: DRAFTING_SECTIONS,
  gating: GATING_SECTIONS,
  interview: INTERVIEW_SECTIONS,
  visual: ["core_rules", "visual_brand", "audience"],
};

export async function loadLibrary(db: SupabaseClient, view: LibraryView): Promise<Library> {
  const { data, error } = await db
    .from("library_sections")
    .select("key, title, body, sort_order")
    .order("sort_order");
  if (error) throw new Error(`library load failed: ${error.message}`);

  const wanted = new Set<string>(VIEWS[view]);
  const sections: Record<string, string> = {};
  const parts: string[] = [];

  for (const row of data ?? []) {
    if (!wanted.has(row.key)) continue;
    const body = (row.body ?? "").trim();
    sections[row.key] = body;
    // An empty section is included as an explicit gap rather than silently omitted, so a missing
    // voice guide is visible in the prompt instead of quietly changing how the model behaves.
    parts.push(
      body.length > 0
        ? `## ${row.title}\n\n${body}`
        : `## ${row.title}\n\n(Not yet supplied by Josh. Do not invent one — work without it.)`,
    );
  }

  const { data: ver } = await db
    .from("library_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    version: ver?.version ?? 1,
    sections,
    prompt: parts.join("\n\n---\n\n"),
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
