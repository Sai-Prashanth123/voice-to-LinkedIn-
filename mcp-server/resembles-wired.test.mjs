/**
 * The capture-time duplicate check is WIRED, end to end, and not merely computed.
 *
 * WHY THIS FILE EXISTS
 *
 * The defect this repository keeps finding is a value nothing reads, or a check with nothing to
 * check, and both report success. It has been found about twenty times. Four live instances were
 * fixed on 2 November 2026 and the commit that documented them shipped four more the same day —
 * all of which typechecked, passed every existing test, and were reported as working.
 *
 * `resembles` is a new input on the capture path, so by that history its most likely failure is not
 * being wrong. It is being computed correctly and reaching nobody:
 *
 *   - returned by cc-submit on only ONE of the two reply branches, so one_step or interviewed gets
 *     it and the other silently does not (this is the shape of the `lineOne()` defect);
 *   - absent from the tool descriptions, so the model that receives it has not been told it is
 *     there and never mentions it (this is the shape of the `opening_words` defect, which reached
 *     no brief, no rubric and no measurement for the entire life of the field);
 *   - reported as "nothing found" when in fact nothing was compared, which is the `checkRetelling`
 *     defect exactly: 122 moments, six embeddings, answering "clear" honestly and uselessly.
 *
 * So this asserts the rendering, not the arithmetic. `resembles.test.ts` covers the arithmetic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const CC_SUBMIT = read("../supabase/functions/cc-submit/index.ts");
const INTERVIEW = read("./tools/interview.mjs");
const ONESTEP = read("./tools/onestep.mjs");

test("the capture reply carries it on BOTH branches, not just the one that was tested", () => {
  // capture() returns twice: once for one_step, once when the interview starts. A field added to
  // one of them works perfectly in whichever mode the author happened to be in.
  const occurrences = CC_SUBMIT.match(/resembles: alreadySaid/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    `expected the field on both reply branches of capture(), found ${occurrences.length}. ` +
      "one_step and interviewed are different code paths and Josh uses one_step.",
  );

  // And the two branches must be the ones in capture(). If the mode strings are gone the reply
  // shape has changed and this test is no longer checking what it thinks it is.
  assert.match(CC_SUBMIT, /mode: "one_step",\s*\n\s*action: "no_question",\s*\n\s*resembles:/);
  assert.match(CC_SUBMIT, /mode: "interviewed",\s*\n\s*resembles:/);
});

test("both capture doors tell the model the field is there", () => {
  // A reply field no tool description mentions is a field the model will not look at. Both doors
  // reach the same capture(): capture_thought for the interviewed path, start_post for one_step.
  for (const [name, source] of [["capture_thought", INTERVIEW], ["start_post", ONESTEP]]) {
    assert.match(source, /`resembles`/, `${name}'s description never mentions the field`);
  }
});

test("the descriptions put the decision with Josh and forbid acting on it alone", () => {
  // The rule allows a second angle on one piece of material and forbids a retelling, and only he
  // can tell those apart. A description that reads as a fault would cost him ideas.
  for (const [name, source] of [["capture_thought", INTERVIEW], ["start_post", ONESTEP]]) {
    assert.match(source, /let HIM decide|let him choose/i, `${name} does not hand him the call`);
    assert.match(source, /second angle/i, `${name} does not say a second angle is allowed`);
    assert.match(source, /park or kill/i, `${name} does not forbid acting on it unilaterally`);
  }
});

test("both descriptions warn that checked: 0 is not good news", () => {
  // This is the whole lesson of the retelling check: an empty basis reported as a clean result.
  for (const [name, source] of [["capture_thought", INTERVIEW], ["start_post", ONESTEP]]) {
    assert.match(
      source,
      /checked: 0|checked: `?0/,
      `${name} does not warn that an empty comparison reads like a clean one`,
    );
  }
});

test("the comparison cannot refuse a capture", () => {
  // It sits on the write path, after the moment is already stored. Everything about it fails open.
  const fn = CC_SUBMIT.slice(
    CC_SUBMIT.indexOf("async function resemblesEarlier"),
    CC_SUBMIT.indexOf("/** 4.1 —"),
  );
  assert.ok(fn.length > 200, "resemblesEarlier is not where this test expects it");

  assert.match(fn, /try\s*\{/, "the read is not wrapped");
  assert.match(fn, /catch\s*\(/, "there is no catch, so a database error would break the capture");
  // The catch must report that nothing ran, not return a bare empty result.
  assert.match(fn, /THE CHECK DID NOT RUN/, "the failure path reads like a clean result");

  // And nothing in capture() may return early or throw on it.
  const capture = CC_SUBMIT.slice(CC_SUBMIT.indexOf("async function capture("));
  const upToReply = capture.slice(0, capture.indexOf("const oneStep"));
  assert.ok(
    !/if\s*\(alreadySaid[^)]*\)\s*return/.test(upToReply),
    "capture() returns early on the comparison, which would refuse a capture over a duplicate",
  );
});

test("a limited read of a growing table is ordered", () => {
  // row-ceiling.test.ts enforces this across the repo and caught this exact read while it was
  // being written: .limit(500) with no .order() returns an arbitrary 500 rows, so past the cap the
  // check would compare against a random subset and still report a confident count.
  const fn = CC_SUBMIT.slice(
    CC_SUBMIT.indexOf("async function resemblesEarlier"),
    CC_SUBMIT.indexOf("/** 4.1 —"),
  );
  assert.match(fn, /\.order\("id",\s*\{\s*ascending:\s*false\s*\}\)/, "the read is unordered");
  // And when the cap is reached it must say the sweep was partial.
  assert.match(fn, /truncated: true/, "a truncated read is not reported as truncated");
});

test("it is logged, so a finding survives the session it was made in", () => {
  // Nothing else will ever mention it again: the reply is read once, out loud, and gone.
  assert.match(CC_SUBMIT, /"capture_resembles_earlier"/);
  // A failed check logs at warn, a finding at info. Collapsing them hides the failures.
  assert.match(CC_SUBMIT, /alreadySaid\.error \? "warn" : "info"/);
});
