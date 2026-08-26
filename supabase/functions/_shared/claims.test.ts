import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractNumbers,
  extractQuotedStrings,
  normalise,
  verifyDraft,
  type Claim,
} from "./claims.ts";

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
