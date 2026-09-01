/**
 * Which library sections each purpose is allowed to see, and how they are rendered into a prompt.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IMPORTS NOTHING
 *
 * These lists were in library.ts, which imports the Supabase client and so can only be read by
 * Deno. When the MCP server began assembling the same prompts for Claude Code, it built its own
 * version — and handed the gate every section, including the two the gate must never see. That is
 * clause 8a's failure arriving through a side door, and it took reading library.ts to notice,
 * because the output looked entirely reasonable.
 *
 * So the lists live here, importing nothing, and both readers use them. Node 22+ strips the types
 * and reads this verbatim; library.ts imports it and keeps its own signature.
 *
 * THE DISTINCTION THAT MATTERS MOST
 *
 * The gate's view is deliberately not the drafter's. A judge that has read another writer's posts
 * starts measuring against their voice rather than Josh's, so `reference_posts` is withheld from
 * it. `voice_transcript` is withheld too: the voice guide is the rule the gate judges against, and
 * the transcript is only the evidence behind that rule.
 */

export type LibraryViewName = "drafting" | "gating" | "interview" | "visual";

/** What the drafter needs to write. */
export const DRAFTING_SECTIONS = [
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
] as const;

/** What the gate needs to judge. Deliberately not identical to the drafting view — see above. */
export const GATING_SECTIONS = [
  "core_rules",
  "hooks",
  "audience",
  "voice_guide",
  "banned_phrases",
  "gate_rules",
] as const;

export const INTERVIEW_SECTIONS = ["core_rules", "pillars", "audience", "prompt_set"] as const;

export const VISUAL_SECTIONS = ["core_rules", "visual_brand", "audience"] as const;

export const VIEWS: Record<LibraryViewName, readonly string[]> = {
  drafting: DRAFTING_SECTIONS,
  gating: GATING_SECTIONS,
  interview: INTERVIEW_SECTIONS,
  visual: VISUAL_SECTIONS,
};

export interface SectionRow {
  key: string;
  title: string;
  body: string | null;
  sort_order?: number;
}

/**
 * Render the sections a view is allowed to see.
 *
 * An empty section is included as an explicit gap rather than silently omitted, so a missing voice
 * guide is visible in the prompt instead of quietly changing how the model behaves.
 */
export function renderLibrary(rows: SectionRow[], view: LibraryViewName): {
  sections: Record<string, string>;
  prompt: string;
} {
  const wanted = new Set(VIEWS[view]);
  const sections: Record<string, string> = {};
  const parts: string[] = [];

  for (const row of rows) {
    if (!wanted.has(row.key)) continue;
    const body = (row.body ?? "").trim();
    sections[row.key] = body;
    parts.push(
      body.length > 0
        ? `## ${row.title}\n\n${body}`
        : `## ${row.title}\n\n(Not yet supplied by Josh. Do not invent one — work without it.)`,
    );
  }

  return { sections, prompt: parts.join("\n\n---\n\n") };
}
