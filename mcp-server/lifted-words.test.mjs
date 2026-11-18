/**
 * His own spoken words, lifted into the post — EXECUTED, because nothing had ever looked.
 *
 * WHAT HE SAID
 *
 * Josh, 18 November: "It copies my spoken words too closely - I tend to just give a stream of
 * conciousness for it to make sense of. Keep the claim, rewrite the words. My guess is the ledger
 * wanting exact spans pulls my phrasing into the post."
 *
 * His guess was right, and the cause is structural rather than a habit of one drafter. `his_words`
 * is a claimable field and `claims.ts` checks a span as a verbatim substring of the field it names,
 * so the cheapest way to make any claim verify is to lift the sentence he spoke and cite it as its
 * own evidence. Every mechanical check then passes and the post is a transcript.
 *
 * And nothing compared the two. The seven-word shingle guard points only at the eight reference
 * writers; `selfEcho` compares a draft against earlier DRAFTS. A draft that was most of his spoken
 * material came back as `borrowed_phrases: { checked: N, found: 0 }` — true, about a different
 * question.
 *
 * WHAT THESE TESTS HOLD DOWN
 *
 * That it fires on the failure he described, that it does NOT fire on the two things that are
 * supposed to survive verbatim, and that an empty source says so rather than reading as clean.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { liftedFromHisWords, liftedReport } from "./self-echo.mjs";
import { SHINGLE_WORDS } from "../supabase/functions/_shared/shingles.ts";

/** A stream of consciousness of the kind he actually types. */
const HIS_WORDS =
  "So the thing that keeps coming up is that every single one of these teams has bought the " +
  "same data provider in the same quarter and now they are all emailing the same four thousand " +
  "people, and the reply rate has collapsed for everybody at once. " +
  "She said the quiet part out loud: nobody owns the list.";

test("a passage lifted straight out of his material is found", () => {
  const body =
    "Every single one of these teams has bought the same data provider in the same quarter.\n\n" +
    "That is why nothing is landing.";
  const lifted = liftedFromHisWords(body, HIS_WORDS);

  assert.equal(lifted.checked, true);
  assert.ok(
    lifted.runs.length > 0,
    `nothing found, so the check that exists for his complaint does not fire on his complaint`,
  );
  const report = liftedReport(lifted);
  assert.ok(report, "a finding produced no report");
  assert.match(report.join(" "), /KEEP THE CLAIM, REWRITE THE WORDS/);
});

test("the same claim written in different words is not flagged", () => {
  // This is the behaviour being asked for, so it has to be the behaviour that passes.
  const body =
    "These teams all bought their data from one place in the same few months.\n\n" +
    "Now the same inboxes get everything twice, and replies have stopped.";
  const lifted = liftedFromHisWords(body, HIS_WORDS);

  assert.equal(lifted.checked, true);
  assert.deepEqual(
    lifted.runs,
    [],
    `flagged a genuine rewrite: ${JSON.stringify(lifted.runs)} — the check would then punish the ` +
      `thing it exists to encourage`,
  );
  assert.equal(liftedReport(lifted), null, "a clean draft produced a report");
});

test("a run shorter than the shingle length is not a lift", () => {
  // Three or four shared words is ordinary English, not a transcript.
  const body = "The reply rate has collapsed. Nobody could tell me why.";
  const lifted = liftedFromHisWords(body, HIS_WORDS);
  assert.deepEqual(
    lifted.runs,
    [],
    `a ${SHINGLE_WORDS - 1}-word overlap was treated as lifted phrasing`,
  );
});

test("he typed nothing, and that is reported rather than passing", () => {
  // "nothing to compare against" and "nothing found" are different answers.
  for (const empty of [null, undefined, "", "   "]) {
    const lifted = liftedFromHisWords("Any draft at all.", empty);
    assert.equal(lifted.checked, false, `an empty source reported as checked: ${JSON.stringify(empty)}`);
    assert.deepEqual(lifted.runs, []);
    assert.equal(liftedReport(lifted), null);
  }
});

test("it counts the material it read, so the basis is visible", () => {
  const lifted = liftedFromHisWords("x", HIS_WORDS);
  assert.ok(
    lifted.source_words > 50,
    `source_words was ${lifted.source_words}; the reply states the basis and a wrong basis is ` +
      `worse than none`,
  );
});

test("the report says what is NOT this, because two things must survive verbatim", () => {
  const body = "Every single one of these teams has bought the same data provider in the same quarter.";
  const report = liftedReport(liftedFromHisWords(body, HIS_WORDS));
  const text = report.join(" ");
  // A quote he gave is meant to appear exactly, and a signature term of his is his voice, not a
  // borrowing. A check that read as a blanket refusal would get his own words edited out.
  assert.match(text, /quote/i);
  assert.match(text, /signature term|his own/i);
  assert.match(text, /let him decide|his call/i);
});

test("it advises and never refuses", () => {
  // The reference-writer guard refuses, because those are someone else's words. These are his.
  const src = liftedFromHisWords.toString() + liftedReport.toString();
  assert.ok(
    !/throw\s/.test(src),
    "this check throws somewhere; repeating his own phrasing is a judgement for him, and a " +
      "refusal here would block a quote he deliberately gave",
  );
});
