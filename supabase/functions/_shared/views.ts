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

/**
 * Whether a section holds content, or is still a placeholder addressed to Josh.
 *
 * WHY THIS IS NOT `body.length > 0`
 *
 * It was, and that was wrong in a way nothing surfaced. Seven of the fourteen sections are not
 * blank — they contain prose explaining what Josh should put there and why we did not guess it for
 * him. "FOR JOSH. Not drafted, because guessing at what you write about would put words in your
 * mouth." is 462 characters, so a length test calls it supplied, and the drafter is handed six
 * sections of instructions written to somebody else and told they are the standard.
 *
 * The acceptance harness already knew better — it strips DELIBERATELY EMPTY before deciding whether
 * the voice guide exists — so the system held two different answers to "is this section filled in?"
 * and they disagreed. This is the one both now use.
 *
 * STARTER sections are supplied. Thought Pilot wrote them as a working starting point, Josh is
 * invited to cut what he does not recognise, and a draft written against them is written against
 * something real.
 */
export function isSupplied(body: string | null | undefined): boolean {
  const text = (body ?? "").trim();
  if (!text) return false;

  // No placeholder marker at the head: Josh has written or replaced this section himself.
  const placeheld = /DELIBERATELY EMPTY/.test(text) || /^#[^\n]*\n+\s*FOR JOSH\b/.test(text);
  if (!placeheld) return true;

  // A PLACEHOLDER CAN HAVE REAL CONTENT APPENDED BELOW IT, AND ALMOST DID NOT COUNT.
  //
  // /voiceguide appends each recording to the END of the section, under a `---` divider, leaving
  // the original "FOR JOSH" preamble at the top. The first version of this function tested only
  // the head, so the first real voice recording Josh made was filed correctly, versioned
  // correctly, appended correctly — and then reported as an empty section. The drafter was handed
  // "" and the gate went on recording voice_guide as NOT JUDGED.
  //
  // Everything looked like it worked. Only the one thing that mattered did not.
  //
  // None of the fourteen placeholders contains a `---` divider of its own, so anything below the
  // first one is content somebody added.
  const [, ...appended] = text.split(/(?:^|\n)---(?:\n|$)/);
  return appended.some((chunk) => chunk.trim().length > 0);
}

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
    // A placeholder is recorded as absent, so every caller asking "is this filled in?" gets the
    // same answer, and the prompt shows the gap rather than the note explaining the gap.
    const body = isSupplied(row.body) ? (row.body ?? "").trim() : "";
    sections[row.key] = body;
    parts.push(
      body.length > 0
        ? `## ${row.title}\n\n${body}`
        : `## ${row.title}\n\n(Not yet supplied by Josh. Do not invent one — work without it.)`,
    );
  }

  return { sections, prompt: parts.join("\n\n---\n\n") };
}

/* ── Which checks have a basis to judge against ──────────────────────────── */
//
// Moved here from handlers/gate.ts, which imports the Supabase client and so can only be read by
// Deno. The MCP server assembles the same eight checks for Claude Code and did not apply this
// rule, so the two gate paths disagreed on live data: the edge function recorded voice_guide as
// NOT JUDGED while a run through the skill recorded it as a pass, on the same empty section.
// One rule, both readers.

/**
 * Checks that judge a draft against one library section, and cannot judge anything without it.
 *
 * Stated explicitly rather than matched by name. The two happen to share a spelling today, and a
 * lookup that relied on that would silently stop working the first time a check or a section was
 * renamed — by passing every draft, which is the direction that does not get noticed.
 *
 * Only genuine dependencies belong here. `aimed_at_someone` reads the audience section but also the
 * audience recorded against the moment, and GATE_USER already handles a missing one deliberately,
 * so it can still judge a post on its own terms and is not listed.
 */
export const CHECK_NEEDS_SECTION: Record<string, string> = {
  voice_guide: "voice_guide",
  banned_phrases: "banned_phrases",
};

/**
 * Which of these checks cannot be judged, because the section they read is empty.
 *
 * Pulled out and exported so it can be tested without a database. The behaviour it guards is the
 * kind that fails silently: get it wrong in one direction and a real check is skipped, get it wrong
 * in the other and every draft is blocked on a section Josh was never required to fill in first.
 */
export function unjudgeableChecks<T extends { key: string }>(
  checks: T[],
  sections: Record<string, string>,
): T[] {
  return checks.filter((c) => {
    const section = CHECK_NEEDS_SECTION[c.key];
    return Boolean(section) && !(sections[section] ?? "").trim();
  });
}

export const notJudged = (section: string) =>
  `NOT JUDGED — the "${section}" section of the reference library is empty, so there was nothing ` +
  `to judge this draft against. Recorded as passed so a section Josh has not supplied cannot ` +
  `block a draft, but this is an absence of evidence rather than evidence of quality. It becomes ` +
  `a real check the moment that section is filled in.`;
