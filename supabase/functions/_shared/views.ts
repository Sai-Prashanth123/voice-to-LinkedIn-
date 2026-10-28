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
  //
  // `reference_writer_reads` is DELIBERATELY NOT HERE, and it is the one absence in this file worth
  // explaining. A deep structural reading of Matt Barker was spliced into `reference_posts` on
  // 20 October: 8,287 of that section's 10,924 characters, one writer's shape, shipped on every
  // brief this list produces — whichever handle had been passed, and whether one had been passed at
  // all. A control run with no handle read it as its shape target. That is Josh's complaint that
  // "the default framework gets used anyway" as a mechanism rather than a symptom, and it made the
  // cadence 8.3 names as likeliest to leak into the default.
  //
  // It moved to its own key (migration 0057), and the protection is that this is an ALLOWLIST: a key
  // in no view reaches no prompt, so nothing has to be maintained for it to stay out. A named
  // writer's shape reaches a drafter through `writerShapeBlock`, which asks for the handle, with his
  // exclusions in the same object. Adding the key here would undo all of that in one line.
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
  /*
   * Added 14 Oct 2026 with the ninth check, and it is a change to the split above rather than an
   * oversight being patched.
   *
   * The drafter has been shown the formatting rules since the beginning and the judge has not, so
   * shape was advice a draft could ignore with no consequence — which is precisely what Josh
   * reported: "it's quite text-heavy... rather than just a wall of text". The ninth check judges
   * against this section, so withholding it would have left a check that can never be judged, and
   * it was: the first live brief after the check shipped recorded shape as NOT JUDGED because the
   * section read as empty in this view.
   *
   * The principle the split protects is untouched. reference_posts and voice_transcript stay out,
   * because a judge that has read another writer's posts starts measuring against their voice.
   * Formatting carries nobody's words.
   */
  "formatting",
] as const;

export const INTERVIEW_SECTIONS = ["core_rules", "pillars", "audience", "prompt_set"] as const;

/**
 * `gate_rules` added 26 October — the one-line fix scripts/load-visual-brand.mjs has described since
 * it was written and nobody made.
 *
 * Its note: "today a rebuilt diagram could carry a client's name straight out of the source image
 * and every check in the system would pass." Three things compose into that. The never-name-a-client
 * rule lives in `gate_rules`, which was not in this view. handlers/visual.ts does no name screening
 * of its own. And the nine gate checks judge the draft BODY — `visuals` is a separate table and no
 * check reads `svg_body`.
 *
 * So this is the only place that rule can reach the thing that rebuilds a diagram. It does not make
 * the visual path gated — nothing judges an SVG — but it stops the generator working without ever
 * having been told the rule it is most likely to break, which is strictly better than the
 * hand-copied `naming_rule` paragraph in visual.mjs being the only mention.
 */
export const VISUAL_SECTIONS = [
  "core_rules",
  "visual_brand",
  "audience",
  "gate_rules",
] as const;

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
  // Added 14 Oct 2026 with the ninth check. An empty formatting section records NOT JUDGED rather
  // than failing every post against a rule nobody has written — the same treatment the other two
  // get, for the same reason.
  shape: "formatting",
};

/* ── What each check may be shown besides the post ───────────────────────── */
/**
 * THE COMPLAINT THIS EXISTS TO ANSWER
 *
 * "I think the gate is also failing drafts for things that aren't in them." He was right, and
 * gate-source.test.ts has carried his words and the evidence since 5 October: on draft 56
 * `identifiable` failed on "17 campuses" and `names_cleared` failed on "Ben", and neither phrase
 * was in the post. Both were in his private notes, which the judge had been handed.
 *
 * The response then was to add "JUDGE THE POST" to the rubrics. The notes still arrived; only an
 * instruction stood between them and the next wrong rejection. And a wrong rejection is expensive
 * in a way few things here are: gate_runs has no UPDATE by design, so it is permanent, and it
 * burns one of the moment's three attempts (9.8).
 *
 * THE RULE
 *
 * A check is shown the post, and nothing else unless its rubric cannot be answered without it.
 * Three of the eight compare the post against something outside itself, and they are named here.
 * The other five — hook_opens_loop, voice_guide, banned_phrases, aimed_at_someone, and anything
 * added later — judge the text in front of them.
 *
 * WHY IT IS IN THIS FILE
 *
 * It was declared inside handlers/gate.ts, where only the edge function could reach it, and
 * get_gate_brief had no equivalent — so the server path narrowed the inputs and the Claude path,
 * which is the one that actually runs (gate_runs_in_claude defaults true), handed every check
 * everything. The same shape as the two copies of isSupplied, and the same cost. One definition,
 * both readers, and a test that fails if either forgets.
 */
export const CHECK_SEES_SOURCE = new Set([
  // 9.4 — the ledger's own check. The material is the comparison set; it cannot run without it.
  "claims_trace",
  // "Could anyone else have written this?" is answered by what he was actually in the room for.
  "anyone_else",
  // Shown who is being protected — explicitly not as grounds to fail. See the rubric's guard.
  "identifiable",
]);

/** Only the check that asks who the post is for. */
export const CHECK_SEES_AUDIENCE = new Set(["aimed_at_someone"]);

/** Only the check that compares the post against what Josh has cleared. */
export const CHECK_SEES_CLEARED_NAMES = new Set(["names_cleared"]);

/**
 * Only the check that judges how the post sits on a phone.
 *
 * Measurements, not an opinion: this post's paragraph and above-fold counts beside the same numbers
 * for the eight writers Josh chose. Handed to one check because a judge given numbers will use
 * them — hook_opens_loop shown a paragraph count would start failing posts for their shape, under
 * a rubric that says to read only the first line.
 */
export const CHECK_SEES_SHAPE = new Set(["shape"]);

/**
 * Which checks are shown what Josh asked for on this post.
 *
 * Only the checks a REQUEST OF HIS can actually trip. He dictates things like "open with I
 * analysed 21,278 US sales teams" and "invite input from the readers at the end"; those collide
 * with the banned-phrases list and the hook rule, and nowhere else. A collision is impossible for
 * names_cleared, identifiable or claims_trace — nothing he can ask for makes an invented quote
 * acceptable — so handing them his notes would be input they cannot use.
 *
 * Deliberately narrow, because the last time inputs were handed out generously five of the checks
 * ended up reading his private notes and failing drafts for things that were not in them. That is
 * the mistake this whole filter exists to prevent, and it applies to this field too.
 */
export const CHECK_SEES_HIS_NOTES = new Set([
  "banned_phrases",
  "hook_opens_loop",
  "voice_guide",
  "shape",
]);

/** What one check may be shown. Both gate paths ask this, and neither decides for itself. */
export function gateInputsFor(key: string): {
  source: boolean;
  audience: boolean;
  clearedNames: boolean;
  shape: boolean;
  hisNotes: boolean;
} {
  return {
    source: CHECK_SEES_SOURCE.has(key),
    audience: CHECK_SEES_AUDIENCE.has(key),
    clearedNames: CHECK_SEES_CLEARED_NAMES.has(key),
    shape: CHECK_SEES_SHAPE.has(key),
    hisNotes: CHECK_SEES_HIS_NOTES.has(key),
  };
}

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
