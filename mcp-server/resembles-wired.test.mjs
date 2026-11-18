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

/*
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE DOOR THE ADVISORY NEVER HAD — added 18 November 2026.
 *
 * Everything above proves the finding reaches a session. It does, and it was RIGHT: over 4-18
 * November `capture_resembles_earlier` fired 24 times and named the correct earlier idea every
 * time — moment 149 matched 148 on a 190-word shared passage, 147 matched 146 on 195 words.
 *
 * And 36 of his messages still became 36 ideas holding about 10 real posts, because being told
 * "this is 190 words of moment 148" was useless: there was no way to add to moment 148. The
 * advisory was wired to a session that had nowhere to go.
 *
 * So this half asserts the ROUTE, which is the other way this defect class presents — a check
 * whose answer no action can use. `continue_post` and `write_post`'s `redo` are that route.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

test("a strong match offers the alternative, on both reply branches", () => {
  // Same lesson as `resembles: alreadySaid` above: a field on one branch works perfectly in
  // whichever mode the author was in, and Josh is in one_step.
  const occurrences = CC_SUBMIT.match(/continue_instead: continueInstead/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    `expected continue_instead on both reply branches of capture(), found ${occurrences.length}`,
  );
});

test("start_post passes the alternative on instead of swallowing it", () => {
  // cc-submit computing it and the tool dropping it is the `opening_words` defect exactly: stored
  // on 1,839 rows, read by nothing, for the entire life of the field.
  assert.match(
    ONESTEP,
    /captured\.continue_instead\s*&&\s*\{\s*continue_instead:\s*captured\.continue_instead\s*\}/,
    "start_post does not carry continue_instead into its reply, so no session will ever see it",
  );
});

test("the threshold is a named constant, not a number buried in a filter", () => {
  assert.match(CC_SUBMIT, /STRONG_MATCH_WORDS\s*=\s*\d+/, "the threshold has no name");
  assert.match(
    CC_SUBMIT,
    /longest_words >= STRONG_MATCH_WORDS/,
    "the named threshold is not the one actually applied",
  );
});

test("continue_post exists, and names what calling start_post instead would cost", () => {
  assert.match(ONESTEP, /name: "continue_post"/, "the tool is not registered");
  // The description is the only thing standing between a session and the old behaviour, because
  // start_post still works and is still the right call for genuinely new material.
  assert.match(
    ONESTEP,
    /NOT start_post/,
    "continue_post does not tell the model when to prefer it over start_post",
  );
  assert.match(
    ONESTEP,
    /6\.3/,
    "continue_post does not say the surplus ideas are permanent, which is why this matters",
  );
  // His exact words are the trigger, so the description must name the shape of them.
  assert.match(ONESTEP, /actually, make it about/i, "it does not name what he actually says");
});

test("continue_post asks for his words untidied, like every other door", () => {
  // Material is checked span by span against this text, so a tidied paste becomes a fabrication
  // two steps later. start_post says this; a second door that did not would be a hole.
  const tool = ONESTEP.slice(ONESTEP.indexOf('name: "continue_post"'));
  const upToNext = tool.slice(0, tool.indexOf("name: \"write_post\"") + 1 || undefined);
  assert.match(upToNext, /verbatim/i, "continue_post does not ask for his words verbatim");
  assert.match(upToNext, /span by span|fabrication/i, "it does not say why tidying is unsafe");
});

test("write_post can re-extract, which is the half that makes continuing usable", () => {
  // submit_extraction has always accepted `redo` and refuses an already-written moment without
  // it. write_post never passed it, so from one_step a moment could be written up exactly once,
  // for ever — and "actually, make it about X" had to come back out as a new idea.
  assert.match(ONESTEP, /redo: z\.boolean\(\)\.optional\(\)/, "write_post has no redo parameter");
  assert.match(
    ONESTEP,
    /\.\.\.\(args\.redo && \{ redo: true \}\)/,
    "write_post declares redo but does not pass it to submit_extraction — a parameter nothing reads",
  );
});

test("cc-submit delegates the append rather than inlining it, so a test can run it", () => {
  /*
   * These three assertions used to slice `appendToMoment` out of cc-submit and read it. The
   * function then moved to `_shared/handlers/material.ts` and they carried on passing against the
   * wrong file for one commit — which is the failure mode of a source assertion, and the reason
   * the behaviour is now covered by EXECUTION in `material.test.ts` instead.
   *
   * cc-submit calls Deno.serve at the top level, exports nothing, and can be imported by no test.
   * A write route that lives in it is a write route nothing can run.
   */
  assert.match(
    CC_SUBMIT,
    /import \{ appendMaterial \} from "\.\.\/_shared\/handlers\/material\.ts"/,
    "the append route is not imported from a file a test can reach",
  );
  assert.match(
    CC_SUBMIT,
    /const appended = await appendMaterial\(db, Number\(body\.moment_id\), text\);/,
    "capture() does not delegate to appendMaterial",
  );

  const MATERIAL = read("../supabase/functions/_shared/handlers/material.ts");

  // The one invariant worth repeating here, because it is the whole point: the route that exists
  // to stop a second idea being created must not create one.
  assert.ok(
    !/from\("moments"\)\s*\.insert\(/.test(MATERIAL),
    "the append route creates a moment, which is the defect it exists to fix",
  );
  // And the branch is taken before capture()'s own moments INSERT, so a caller that means to
  // continue cannot create one by arriving a few lines too late.
  const capture = CC_SUBMIT.slice(CC_SUBMIT.indexOf("async function capture("));
  assert.ok(
    capture.indexOf("appendMaterial") < capture.indexOf('from("moments").insert'),
    "the append branch comes after the INSERT, so continuing an idea still creates one",
  );
});

test("the threshold states what it was measured against, not just its value", () => {
  // A number with no recorded basis is a number the next person nudges. This one sits in a gap in
  // the observed data — 4 matches at 9-15 words, 45 at 31-710, nothing between 16 and 30 — and the
  // comment has to carry that, or the gap is rediscovered or ignored.
  const block = CC_SUBMIT.slice(
    CC_SUBMIT.indexOf("STRONG_MATCH_WORDS") - 1600,
    CC_SUBMIT.indexOf("STRONG_MATCH_WORDS") + 200,
  );
  assert.match(block, /CALIBRATED/, "the threshold does not say it was measured");
  assert.match(block, /between 16 and 30/, "the gap it sits in is not recorded");
  assert.match(block, /re-measured/, "nothing says what to do if the gap closes");
});
