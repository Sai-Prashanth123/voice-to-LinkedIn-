/**
 * The commenting view reaches the comment prompt, and the absences are the intended ones.
 *
 * `gate-inputs-agree.test.ts` exists because a rubric once instructed a judge to read a field no
 * judge could see. This is the same test for the comment path, and it is needed for the same
 * reason: `renderLibrary` filters by `wanted.has(row.key)`, so a section missing from a VIEWS entry
 * reaches no prompt — silently, with the brief still looking complete.
 *
 * The one that would actually hurt is `gate_rules`. The never-name-a-client rule lives in that
 * section, nothing judges a comment, and a comment is MORE exposed than a post because it sits
 * under someone else's writing in the same niche. If it ever drops out of the view, the thing
 * writing comments has not been told the rule it is most likely to break.
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { COMMENTING_SECTIONS, renderLibrary, VIEWS } from "./views.ts";
import { COMMENT_SYSTEM, COMMENT_USER } from "./prompts.ts";

/** One row per section, with a body that could not appear by accident. */
const library = [
  { key: "core_rules", title: "Core rules", body: "CORE-BODY-MARKER", sort_order: 0 },
  { key: "audience", title: "Who he talks to", body: "AUDIENCE-BODY-MARKER", sort_order: 1 },
  { key: "voice_guide", title: "His voice", body: "VOICE-BODY-MARKER", sort_order: 2 },
  { key: "banned_phrases", title: "Banned phrases", body: "BANNED-BODY-MARKER", sort_order: 3 },
  { key: "gate_rules", title: "Gate rules", body: "GATE-BODY-MARKER", sort_order: 4 },
  // The ones that must NOT reach it.
  { key: "hooks", title: "Hook rules", body: "HOOKS-BODY-MARKER", sort_order: 5 },
  { key: "formatting", title: "Formatting", body: "FORMATTING-BODY-MARKER", sort_order: 6 },
  { key: "pillars", title: "Pillars", body: "PILLARS-BODY-MARKER", sort_order: 7 },
  { key: "frameworks", title: "Frameworks", body: "FRAMEWORKS-BODY-MARKER", sort_order: 8 },
  { key: "reference_posts", title: "Reference posts", body: "REFERENCE-BODY-MARKER", sort_order: 9 },
  { key: "voice_transcript", title: "Transcript", body: "TRANSCRIPT-BODY-MARKER", sort_order: 10 },
];

Deno.test("the commenting view is registered, or nothing can ask for it", () => {
  assertEquals(VIEWS.commenting, COMMENTING_SECTIONS);
});

Deno.test("every section the view names actually reaches the prompt", () => {
  const { prompt } = renderLibrary(library, "commenting");
  const system = COMMENT_SYSTEM(prompt);

  for (const key of COMMENTING_SECTIONS) {
    const row = library.find((r) => r.key === key)!;
    assertStringIncludes(
      system,
      row.body,
      `${key} is in the commenting view but its body never reaches COMMENT_SYSTEM`,
    );
  }
});

Deno.test("gate_rules reaches it, because nothing else tells a comment that rule", () => {
  /*
   * Called out separately from the loop above so the failure message says why it matters rather
   * than just which key went missing.
   */
  assert(
    COMMENTING_SECTIONS.includes("gate_rules" as never),
    "gate_rules left the commenting view. The never-name-a-client rule lives there and no gate " +
      "check reads a comment, so this is the only route by which that rule reaches the writer.",
  );
  const { prompt } = renderLibrary(library, "commenting");
  assertStringIncludes(COMMENT_SYSTEM(prompt), "GATE-BODY-MARKER");
});

Deno.test("the deliberate absences are absent", () => {
  const system = COMMENT_SYSTEM(renderLibrary(library, "commenting").prompt);

  // Each with the reason, so a future reader adding one back has to disagree with the reason.
  const forbidden: Array<[string, string]> = [
    ["HOOKS-BODY-MARKER", "a comment is a reply, not a post — it does not open a loop"],
    ["FORMATTING-BODY-MARKER", "those rules shape a post above the fold; a short reply has no fold"],
    ["PILLARS-BODY-MARKER", "he is answering someone else's subject, not choosing his own"],
    ["FRAMEWORKS-BODY-MARKER", "same reason as pillars"],
    [
      "REFERENCE-BODY-MARKER",
      "a writer who has just read another writer's posts starts measuring against their voice, " +
        "and the comment sits directly under someone else's writing",
    ],
    ["TRANSCRIPT-BODY-MARKER", "kept out for the same reason as the gate's view"],
  ];
  for (const [marker, why] of forbidden) {
    assert(!system.includes(marker), `${marker} reached the comment prompt. It is excluded because ${why}.`);
  }
});

Deno.test("the prompt carries the rules that have no other enforcement", () => {
  /*
   * Three instructions that are the ONLY thing standing where a mechanism would normally be. There
   * is no claim ledger on a comment, no shingle guard covering the person being replied to, and no
   * length check before it reaches him — worker-engage flags the last one but does not block it.
   */
  const system = COMMENT_SYSTEM("");
  assertStringIncludes(system, "Could anyone else have left this comment");
  assertStringIncludes(system, "NEVER INVENT ANYTHING");
  assertStringIncludes(system, "NEVER NAME A CLIENT");
  assertStringIncludes(system, "TAKE THE SHAPE, NEVER THE WORDS");
  // And that returning nothing is allowed, or the model will invent an angle to fill the list.
  assertStringIncludes(system, "Returning nothing is always");
});

Deno.test("the user prompt carries the post, the author and the count asked for", () => {
  const user = COMMENT_USER({
    authorName: "Someone Real",
    authorHandle: "someonereal",
    postText: "POST-BODY-MARKER",
    postedAt: "2026-11-03T07:25:08.217Z",
    wanted: 3,
  });
  assertStringIncludes(user, "POST-BODY-MARKER", "the post itself never reaches the model");
  assertStringIncludes(user, "Someone Real");
  assertStringIncludes(user, "@someonereal");
  assertStringIncludes(user, "2026-11-03");
  assertStringIncludes(user, "up to 3 comment");
  // The time is cut: a comment does not need to know a post went up at 07:25.
  assert(!user.includes("07:25"), "the user prompt carries a timestamp it has no use for");
});

Deno.test("a missing posted_at does not put the word undefined in front of a model", () => {
  const user = COMMENT_USER({
    authorName: "Someone",
    authorHandle: "someone",
    postText: "text",
    postedAt: null,
    wanted: 1,
  });
  assert(!user.includes("undefined"), user.slice(0, 200));
  assert(!user.includes("null"), user.slice(0, 200));
  // Singular, because "1 comments" reads as a bug to anyone who sees it.
  assertStringIncludes(user, "up to 1 comment Josh");
});
