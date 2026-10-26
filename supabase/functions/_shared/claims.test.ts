import { test } from "node:test";
import assert from "node:assert/strict";
import { hashRun, shinglesOf } from "./shingles.ts";
import {
  extractNumbers,
  extractQuotedStrings,
  normalise,
  verifyDraft,
  type Claim,
} from "./claims.ts";

const BORROWED = "the quickest way to lose a client is to stop telling them what you are doing";

const entry = {
  the_moment:
    "On a call last Tuesday the CFO stopped me halfway through the deck and asked what happens " +
    "when the champion leaves.",
  their_actual_words: "we already tried that and it did not work",
  how_he_felt: "Caught out. I had no answer that was not a platitude.",
  the_lesson: "Every deal has a single point of failure and it is usually a person.",
};

test("normalise folds case, whitespace and smart punctuation", () => {
  assert.equal(normalise("  It’s   “fine” — really  "), 'it\'s "fine" - really');
});

test("extractNumbers canonicalises currency, commas and percent", () => {
  assert.deepEqual(extractNumbers("we lost $1,200 and 15% of pipeline").sort(), ["1200", "15"]);
});

test("extractQuotedStrings ignores apostrophes", () => {
  assert.deepEqual(extractQuotedStrings(`He said "it did not work" about Josh's deck.`), [
    "it did not work",
  ]);
});

test("a claim backed by a real verbatim span passes", () => {
  const claims: Claim[] = [
    {
      claim: "the buyer said it did not work",
      kind: "quote",
      source_field: "their_actual_words",
      source_span: "it did not work",
    },
  ];
  const r = verifyDraft(
    `The CFO stopped me and said "it did not work". I had no answer.`,
    claims,
    entry,
  );
  assert.equal(r.ok, true, r.failures.join(" | "));
});

test("a fabricated quote fails even when the ledger vouches for it", () => {
  const claims: Claim[] = [
    {
      claim: "the buyer said they would churn",
      kind: "quote",
      source_field: "their_actual_words",
      source_span: "we are going to churn",
    },
  ];
  const r = verifyDraft("They told me they would churn.", claims, entry);
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /does not appear in their_actual_words/);
});

test("a number that appears nowhere in the moment is caught with no ledger entry at all", () => {
  const r = verifyDraft("I have seen this in 40 deals this year.", [], entry);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsourcedNumbers, ["40"]);
  assert.match(r.failures[0], /If Josh did not say it, it does not go in/);
});

test("an invented statistic written out in words is caught too", () => {
  const r = verifyDraft("Seven out of ten deals die this way.", [], entry);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsourcedNumbers.sort(), ["10", "7"]);
});

test("written and digit forms of the same number are treated as equal", () => {
  const sourced = { ...entry, the_detail: "It was the third call in ten days." };
  const r = verifyDraft("By day 10 it was obvious.", [], sourced);
  assert.equal(r.ok, true, r.failures.join(" | "));
});

test('"one" is not treated as a numeric claim', () => {
  const r = verifyDraft("No one had an answer. That was the whole problem.", [], entry);
  assert.equal(r.ok, true, r.failures.join(" | "));
});

test("a quote invented in the body is caught even when the ledger is empty", () => {
  const r = verifyDraft(`She looked at me and said "you have no idea".`, [], entry);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsourcedQuotes, ["you have no idea"]);
});

test("a claim citing the right field but an unrelated span fails on its numbers", () => {
  const numbered = { ...entry, the_detail: "It was the third deal that quarter. We lost 40% of it." };
  const claims: Claim[] = [
    {
      claim: "we lost 90% of the deal",
      kind: "number",
      source_field: "the_detail",
      source_span: "We lost 40% of it",
    },
  ];
  const r = verifyDraft("We lost 90% of it.", claims, numbered);
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /but the span does not contain it/);
});

test("an uncleared name in the body is rejected (9.10)", () => {
  const r = verifyDraft("Northwind told me it did not work.", [], entry, [
    { name: "Northwind", cleared: false },
  ]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unclearedNames, ["Northwind"]);
  assert.match(r.failures[0], /without clearance for this post/);
});

test("a cleared name is allowed through", () => {
  const r = verifyDraft("Northwind stopped me halfway through the deck.", [], entry, [
    { name: "Northwind", cleared: true },
  ]);
  assert.equal(r.ok, true, r.failures.join(" | "));
});

test("an empty or trivially short span cannot evidence a claim", () => {
  const claims: Claim[] = [
    { claim: "something happened", kind: "detail", source_field: "the_moment", source_span: "  " },
    { claim: "it was on", kind: "detail", source_field: "the_moment", source_span: "on" },
  ];
  const r = verifyDraft("Something happened.", claims, entry);
  assert.equal(r.ok, false);
  assert.equal(r.verdicts.filter((v) => !v.ok).length, 2);
});

test("a claim pointing at a field the drafter was never given fails", () => {
  const claims: Claim[] = [
    {
      claim: "the deal closed",
      kind: "event",
      source_field: "outcome_notes",
      source_span: "the deal closed",
    },
  ];
  const r = verifyDraft("The deal closed.", claims, entry);
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /does not exist in the entry/);
});

test("smart quotes in the draft still match straight quotes in the source", () => {
  const r = verifyDraft(`He said “it did not work” and left.`, [], entry);
  assert.equal(r.ok, true, r.failures.join(" | "));
});

/**
 * 9.4 is the clause with zero tolerance at acceptance, so its check has to be exactly as strict as
 * the clause and not one notch stricter. A quotation takes the punctuation of the sentence around
 * it; rejecting a verbatim quote over a full stop fails honest drafts and teaches nobody anything.
 * Seen live: a draft quoting "if Dan goes, we start from zero." against a source holding exactly
 * those words without the stop.
 */
test("a verbatim quote is not fabricated because the sentence ended", () => {
  const entry = { their_actual_words: "if Dan goes, we start from zero" };

  for (const ending of [".", ",", "!", "?", ";", ":", ""]) {
    const body = `He said it plainly. "if Dan goes, we start from zero${ending}"`;
    const result = verifyDraft(body, [], entry);
    assert.equal(
      result.ok,
      true,
      `"${ending}" should not turn a sourced quote into a fabricated one: ${result.failures.join(" ")}`,
    );
  }
});

test("a paraphrase is still a fabricated quote, punctuation or not", () => {
  const entry = { their_actual_words: "if Dan goes, we start from zero" };

  const paraphrases = [
    `She said "if Dan leaves, we start from zero."`,
    `She said "if Dan goes we are back to zero."`,
    `She said "if Dan goes, we start again from zero."`,
  ];

  for (const body of paraphrases) {
    assert.equal(verifyDraft(body, [], entry).ok, false, `must reject: ${body}`);
  }
});

test("punctuation INSIDE the quote still has to match", () => {
  // The latitude is for the end of the quotation only. A comma the source never had changes the
  // sentence, and inventing one is inventing what was said.
  const entry = { their_actual_words: "if Dan goes we start from zero" };
  assert.equal(verifyDraft(`He said "if Dan goes, we start from zero."`, [], entry).ok, false);
});

test("a borrowed run is one failure on its own, and says 8.3", () => {
  // create_draft chooses its headline and its advice from this: exactly one failure, and it is the
  // borrowed one, means "you used his words" rather than "your ledger is wrong". Told the second
  // thing, a caller edits a ledger that was already correct and resubmits the same sentence. This
  // pins the condition that distinguishes them.
  const index = new Set([...shinglesOf(BORROWED).map(hashRun)]);
  const result = verifyDraft(`I was in the room. ${BORROWED}. That was it.`, [], entry, [], index);

  assert.equal(result.ok, false);
  assert.equal(result.borrowedPhrases.length, 1);
  assert.equal(result.failures.length, 1, "nothing else should fire on a clean draft");
  assert.match(result.failures[0], /8\.3/);
});

test("a borrowed run and a bad ledger are two failures, not one", () => {
  // The other side of the same condition: when both fire, the ledger headline is the right one and
  // the borrowed line still appears in the list.
  const index = new Set([...shinglesOf(BORROWED).map(hashRun)]);
  const bad: Claim[] = [
    { kind: "quote", claim: "he said it", source_field: "their_actual_words", source_span: "never said this" },
  ];
  const result = verifyDraft(`${BORROWED}.`, bad, entry, [], index);

  assert.equal(result.borrowedPhrases.length, 1);
  assert.ok(result.failures.length > 1, "both kinds reported");
});

test("without an index nothing is reported as borrowed", () => {
  // The default. Every existing caller passes four arguments and must keep behaving as it did.
  const clean = verifyDraft(`${BORROWED}.`, [], entry);
  assert.deepEqual(clean.borrowedPhrases, []);
});

/* ── Where a quote may come from ────────────────────────────────────────────── *
 *
 * Added 26 October, after the second time a fabricated quote reached a draft.
 *
 * The check searched the union of all twelve fields, so a quoted sentence verified if it appeared
 * ANYWHERE in the entry. `his_words` is whatever Josh pasted into raw_inputs, and on 21 October
 * that included a strategy document — so `"$40K a year for ZoomInfo"` verified cleanly and reached
 * a TAM draft. He filed the rule the same day: "Real quotes only. A quote needs a confirmed speaker
 * who actually said it. Never take a quote from a persona or strategy document."
 *
 * A quote is a claim about who SAID something. It may only rest on a field that records speech.
 */

test("a sentence lifted from a strategy document is not a quote", () => {
  // The live shape of the 21 October failure: real text, in the entry, nobody said it.
  const entry = {
    the_moment: "I was working out the TAM for a cold email play.",
    his_words: "Pasted from their strategy deck: buyers spend $40K a year for ZoomInfo and get "
      + "nothing back.",
  };
  const r = verifyDraft(`Their CRO told me: "buyers spend $40K a year for ZoomInfo"`, [], entry);
  assert.equal(r.ok, false, "a quote from a pasted document still verifies");
  assert.ok(r.unsourcedQuotes.length > 0);
  assert.match(r.failures.join(" "), /confirmed speaker|persona or strategy document/);
});

test("a conclusion in quotation marks has no speaker", () => {
  const entry = {
    the_lesson: "nobody owns the number once the consultants leave",
    their_actual_words: "we will pick it up next quarter",
  };
  const r = verifyDraft(`The lesson was "nobody owns the number once the consultants leave".`, [], entry);
  assert.equal(r.ok, false, "a line from the_lesson passed as something someone said");
});

test("what somebody actually said still verifies", () => {
  const entry = {
    the_moment: "A call in March.",
    their_actual_words: "the number was fine before you got here",
  };
  const r = verifyDraft(`She said "the number was fine before you got here" and moved on.`, [], entry);
  assert.equal(r.ok, true, `a real quote was refused: ${r.failures.join(" | ")}`);
});

test("a quote sitting only in his raw paste is refused, and told where to put it", () => {
  /*
   * The deliberate strictness. his_words is whatever he pasted, which on 21 October was a strategy
   * document — so a quote has to reach their_actual_words through the extraction step, where the
   * question "who said this" is actually asked. The message has to name that fix, or this becomes
   * a refusal with nowhere to go.
   */
  const entry = {
    the_moment: "A call in March.",
    his_words: "she told me the number was fine before you got here",
  };
  const r = verifyDraft(`She said "the number was fine before you got here" and moved on.`, [], entry);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(" "), /their_actual_words/);
  assert.match(r.failures.join(" "), /drop the quotation marks/);
});

test("narrowing the quote check did not narrow anything else", () => {
  // Numbers and spans still read the whole entry. Only the speaker question got stricter.
  const entry = { the_detail: "it took 11 weeks and cost 40% of the quarter" };
  const r = verifyDraft("It took 11 weeks and ate 40% of the quarter.", [], entry);
  assert.equal(r.ok, true, `a sourced figure outside the speech fields was refused: ${r.failures.join(" | ")}`);
});
