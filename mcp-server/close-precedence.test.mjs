/**
 * The close his library calls the default, and the check that banned it anyway.
 *
 * On 27 October Josh wrote four drafts of one post in ninety minutes. `banned_phrases` failed three
 * of them for ending on a reader question — including draft 93's "If you've run SDRs at a company
 * past 1,000 people, is that what you saw?", written immediately after he asked, in writing, to
 * "invite input from the readers of the post at the end". He overrode the gate and approved it.
 *
 * Nothing was broken. Two sections of his own library disagree:
 *
 *   closes          — "A genuine question. Specific enough that only his reader could answer it,
 *                      and one he actually wants the answer to. THE DEFAULT CLOSE."
 *   banned_phrases  — "Never end by asking for engagement ("Agree?", "Thoughts?", "What would you
 *                      add?")."
 *
 * The mechanical detector in prefile.mjs already resolved this correctly, and says so in its own
 * comment: the regex matches solicitations, never a question. The LLM judge read the broader
 * sentence and failed the narrower one. So the two surfaces that apply ONE rule disagreed about it,
 * and only one of them could stop a draft.
 *
 * This file holds them to the same rule. The behavioural half tests the detector; the text half
 * pins the rubric the judge is given, because a prompt is the only implementation that judge has.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { prefileVerdict } from "./prefile.mjs";
import { DRAFT_USER, GATE_CHECKS, GATE_SYSTEM } from "../supabase/functions/_shared/prompts.ts";

/** Enough of the live library for the rule to be considered present. */
const RULE = {
  banned_phrases: 'Never end by asking for engagement ("Agree?", "Thoughts?", "What would you add?").',
};

const post = (close) =>
  ["Something that happened at work.", "", "A second line that carries it.", "", close].join("\n");

const rubric = (key) => GATE_CHECKS.find((c) => c.key === key)?.question ?? "";

/* ── The detector: the default close is not engagement bait ──────────────────── */

test("a question only his reader could answer is not flagged", () => {
  // Draft 93's actual close, verbatim. This is the case that failed three times.
  const verdict = prefileVerdict(
    post("If you've run SDRs at a company past 1,000 people, is that what you saw?"),
    { sections: RULE },
  );
  const found = [...verdict.blocking, ...verdict.advisory].filter((f) => f.source === "engagement_ask");
  assert.deepEqual(found, [], `the default close was flagged: ${JSON.stringify(found)}`);
});

test("the generic forms the rule actually names are still refused", () => {
  for (const close of ["Thoughts?", "Agree?", "What would you add?", "Curious what you think?"]) {
    const verdict = prefileVerdict(post(close), { sections: RULE });
    assert.ok(
      verdict.blocking.some((f) => f.source === "engagement_ask"),
      `"${close}" was allowed through — the rule has stopped meaning anything`,
    );
  }
});

/* ── The judge: the rubric must say which section wins ───────────────────────── */

test("the banned_phrases rubric names closes as the authority on endings", () => {
  const text = rubric("banned_phrases");
  assert.match(text, /"closes" IS THE AUTHORITY ON HOW A POST ENDS/);
  assert.match(text, /THE DEFAULT CLOSE/);

  // And it must carry the live case, so the next reader cannot talk themselves back out of it.
  assert.match(text, /is that what you saw\?/);
});

test("the hook rubric separates a withheld finding from a stated conclusion", () => {
  const text = rubric("hook_opens_loop");
  assert.match(text, /A FINDING NAMED BUT WITHHELD IS A LOOP/);
  assert.match(text, /Naming the METHOD while/);
});

test("the judge is told to name a collision instead of failing in silence", () => {
  /*
   * The looping half of the fault. "Never open with 'I'" is unambiguous and Josh dictated an
   * opening that breaks it, so draft 92 failed for obeying him. The check is right to fail it —
   * only Josh changes the library (12.10) — but a verdict that does not say "this is what you
   * asked for" sends the writer back to produce the same draft again.
   */
  const text = GATE_SYSTEM("(library)");
  assert.match(text, /IF THE POST BREAKS A RULE BECAUSE JOSH ASKED FOR IT, STILL FAIL IT/);
  assert.match(text, /quote his instruction/);
  assert.match(text, /WHERE TWO SECTIONS OF THE LIBRARY DISAGREE, THE MORE SPECIFIC ONE WINS/);
});

/* ── A verdict nobody reached is an invention ────────────────────────────────── */

test("a draft that passed is not described to the writer as rejected", () => {
  /*
   * The normal review path: Josh reads a draft that CLEARED the gate and asks for a change.
   *
   * His note is the only entry in the pushback job's `failures`, and it is now filtered out of the
   * rejection list because the brief carries it separately as an instruction. That left the list
   * empty, and the fallback substituted `gate_reason ?? "rejected"` — which is null on a passing
   * draft. So the brief said "Your previous attempt was rejected. It failed on: - rejected" about
   * a draft the gate approved, in place of the words he actually used.
   *
   * A verdict nobody reached is the same class of invention as a quote nobody said, and clause 1
   * does not distinguish between them.
   */
  const passed = DRAFT_USER({
    entry: { their_actual_words: "something that happened" },
    clearedNames: [],
    unclearedNames: [],
    previousAttempt: { body: "The previous draft.", failures: [] },
    hisNotes: ["keep everything under the methods on one line"],
  });
  assert.doesNotMatch(passed, /was rejected/);
  assert.doesNotMatch(passed, /It failed on:/);
  assert.match(passed, /nothing rejected it/);
  // His words still reach the writer, which is the point of the whole block.
  assert.match(passed, /one line/);

  // And a real rejection still reads as one.
  const failed = DRAFT_USER({
    entry: { their_actual_words: "something that happened" },
    clearedNames: [],
    unclearedNames: [],
    previousAttempt: { body: "The previous draft.", failures: ["hook_opens_loop: states it"] },
  });
  assert.match(failed, /was rejected/);
  assert.match(failed, /It failed on:/);
  assert.match(failed, /hook_opens_loop/);
});

test("a draft the gate never finished judging is called neither passed nor rejected", () => {
  /*
   * The opposite invention, and the one the first fix introduced. `finishGate` leaves gate_passed
   * null until every check answers, so a draft part-way through — or one whose verdicts were
   * recorded and never closed out, which is draft 57 on 5 October — sits at null. Reading that as
   * "nothing rejected it" tells the writer a draft was clean when the gate had reached no verdict
   * on it at all.
   */
  const unjudged = DRAFT_USER({
    entry: { their_actual_words: "something that happened" },
    clearedNames: [],
    unclearedNames: [],
    previousAttempt: { body: "The previous draft.", failures: [], verdict: "not_judged" },
    hisNotes: ["the opening is flat"],
  });
  assert.doesNotMatch(unjudged, /was rejected/);
  assert.doesNotMatch(unjudged, /nothing rejected it/);
  assert.match(unjudged, /never fully judged/);
  assert.match(unjudged, /neither passed nor rejected/);
  assert.match(unjudged, /the opening is flat/);
});
