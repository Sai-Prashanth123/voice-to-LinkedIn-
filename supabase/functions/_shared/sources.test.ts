/**
 * Widening where a fact may come from must not relax whether it is checked.
 *
 * On 14 October a claim stopped being confined to the ten fields of one interview. It may now also
 * cite `his_words` — what Josh actually typed, before a model summarised it — and `receipts`, what
 * he has told us about his own career, method and numbers. Both were already his; neither was
 * reachable, so a topic with no scene was refused outright and a receipts file that says in its own
 * text that it may be used as a source was ignored by a server that had never heard of it.
 *
 * That is a change to the SOURCE SET. It is not a change to 9.4, and this file is what holds the
 * two apart. Every assertion here is a way of asking: can something now reach a post that Josh did
 * not say? The answer has to stay no.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIMABLE_FIELDS,
  EXTRA_SOURCES,
  HIS_WORDS_TABLE,
  RECEIPTS_SECTION,
  SOURCE_FIELDS,
  sourceEntry,
} from "./entry.ts";
import { verifyDraft } from "./claims.ts";

const MATERIAL = {
  the_moment: "The client said it was the most complete picture they had had of these verticals.",
};

const TYPED = "I've been building TAMs for the better part of 10 years and most of them fell short.";
const RECEIPTS = "# Receipts\n\nHe has run outbound for vertical SaaS teams since 2017.";

/* ── The set itself ───────────────────────────────────────────────────────── */

test("the ten fields are still the ten, and the extras are named", () => {
  assert.equal(SOURCE_FIELDS.length, 10);
  assert.deepEqual([...EXTRA_SOURCES], ["his_words", "receipts"]);
  assert.equal(CLAIMABLE_FIELDS.length, 12);
  // Order matters: the drafter reads the material first and the wider sources after.
  assert.equal(CLAIMABLE_FIELDS[0], "the_moment");
  assert.equal(CLAIMABLE_FIELDS.at(-1), "receipts");
});

test("a caller that passes no wider source gets exactly what it got before", () => {
  // Twelve call sites did not change. If this ever fails, one of them silently started seeing more.
  assert.deepEqual(sourceEntry(MATERIAL), { the_moment: MATERIAL.the_moment });
  assert.deepEqual(sourceEntry(null), {});
});

test("an empty wider source adds nothing, so an absent file is not a citable blank", () => {
  assert.deepEqual(sourceEntry(MATERIAL, { his_words: "", receipts: null }), {
    the_moment: MATERIAL.the_moment,
  });
  // And a moment with no material at all but something typed is now draftable, which is the point.
  assert.deepEqual(sourceEntry(null, { his_words: TYPED }), { his_words: TYPED });
});

/* ── The thing that must not change ───────────────────────────────────────── */

test("a claim on his own words is still checked word for word", () => {
  const entry = sourceEntry(MATERIAL, { his_words: TYPED, receipts: RECEIPTS });

  const exact = verifyDraft(
    "Ten years of TAMs, and most of them fell short.",
    [{
      claim: "He has been building TAMs for the better part of 10 years",
      kind: "event",
      source_field: "his_words",
      source_span: "building TAMs for the better part of 10 years",
    }],
    entry,
  );
  assert.equal(exact.ok, true, exact.failures.join(" "));
});

test("a paraphrase of his own words is refused, exactly as it is on the ten fields", () => {
  const entry = sourceEntry(MATERIAL, { his_words: TYPED });

  const paraphrased = verifyDraft(
    "A decade of TAMs.",
    [{
      claim: "He has been building TAMs for a decade",
      kind: "event",
      source_field: "his_words",
      // True, and not what he wrote. The whole mechanism is that this fails anyway.
      source_span: "building TAMs for a decade",
    }],
    entry,
  );
  assert.equal(paraphrased.ok, false);
  assert.match(paraphrased.failures.join(" "), /Unsupported claim/);
});

test("a claim cannot cite a source the caller was not given", () => {
  // receipts absent from the entry: naming it must not pass just because the field name is legal.
  const entry = sourceEntry(MATERIAL, { his_words: TYPED });

  const r = verifyDraft(
    "He has run outbound since 2017.",
    [{
      claim: "He has run outbound for vertical SaaS teams since 2017",
      kind: "event",
      source_field: "receipts",
      source_span: "He has run outbound for vertical SaaS teams since 2017.",
    }],
    entry,
  );
  assert.equal(r.ok, false, "a claim rested on a source that was never loaded");
});

test("a span cannot drift between sources", () => {
  // The reason source_field exists at all: a true sentence from the wrong source still fails.
  const entry = sourceEntry(MATERIAL, { his_words: TYPED, receipts: RECEIPTS });

  const r = verifyDraft(
    "Ten years of TAMs.",
    [{
      claim: "He has been building TAMs for the better part of 10 years",
      kind: "event",
      source_field: "receipts",
      source_span: "building TAMs for the better part of 10 years",
    }],
    entry,
  );
  assert.equal(r.ok, false, "a span verified against a source it does not belong to");
});

test("numbers in the body are still checked against the whole source set", () => {
  const entry = sourceEntry(MATERIAL, { his_words: TYPED });

  // "10" is in what he typed, so it passes now where it would have failed before.
  const ok = verifyDraft("Ten years, or 10 if you prefer.", [], entry);
  assert.equal(ok.unsourcedNumbers.includes("10"), false);

  // A number in neither place is still refused.
  const bad = verifyDraft("We cut it by 47%.", [], entry);
  assert.equal(bad.ok, false);
  assert.ok(bad.unsourcedNumbers.includes("47"));
});

/* ── The two loaders ──────────────────────────────────────────────────────── */

test("both runtimes load the wider source from the same rows", async () => {
  // Deno reaches Postgres one way and the MCP server another, so the loaders are two functions.
  // What they must never disagree on is WHICH rows — that is the isSupplied bug, again.
  const deno = await Deno.readTextFile(new URL("./handlers/draft.ts", import.meta.url));
  const node = await Deno.readTextFile(new URL("../../../mcp-server/sources.mjs", import.meta.url));

  for (const [name, src] of [["draft.ts", deno], ["sources.mjs", node]]) {
    assert.match(src, /HIS_WORDS_TABLE/, `${name} does not use the shared table name`);
    assert.match(src, /RECEIPTS_SECTION/, `${name} does not use the shared section key`);
    assert.doesNotMatch(
      src,
      /["']raw_inputs["']/,
      `${name} has its own copy of the table name`,
    );
    assert.doesNotMatch(
      src,
      /\.eq\(\s*["']key["']\s*,\s*["']receipts["']/,
      `${name} has its own copy of the section key`,
    );
    // A placeholder is not a source. Both must read it through isSupplied, or a claim could rest on
    // the FOR JOSH note telling him to fill the section in.
    assert.match(src, /isSupplied/, `${name} does not filter the placeholder out of receipts`);
  }
});

test("the keys are spelled once", () => {
  assert.equal(RECEIPTS_SECTION, "receipts");
  assert.equal(HIS_WORDS_TABLE, "raw_inputs");
});

test("the function that verifies a draft is the one that gets the wider source", async () => {
  /*
   * The first attempt at this change patched handleDraft and not applyDraft, because
   * String.replace takes the first match and the two build their entry with identical lines.
   * Everything type-checked, every unit test passed, and the fault only appeared against the live
   * project: a draft stored with claims_verified false and a deterministic claims_trace failure
   * reading "source field his_words is empty or does not exist in the entry".
   *
   * applyDraft is where a claim is actually checked, so it is the one that must never be left
   * behind. Asserted by source because the alternative is a database.
   */
  const src = await Deno.readTextFile(new URL("./handlers/draft.ts", import.meta.url));

  assert.doesNotMatch(
    src,
    /sourceEntry\(material\)/,
    "draft.ts still builds an entry from the ten fields alone somewhere",
  );
  // Both call sites widen: handleDraft writes from it, applyDraft verifies against it.
  assert.equal(
    (src.match(/sourceEntry\(material, extra\)/g) ?? []).length,
    2,
    "draft.ts should widen the source in both handleDraft and applyDraft",
  );
});
