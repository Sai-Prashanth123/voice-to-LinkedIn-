/**
 * Both gate paths must hand a check the same inputs.
 *
 * `views.ts` says this test should exist, and says why:
 *
 *   "get_gate_brief had no equivalent — so the server path narrowed the inputs and the Claude path,
 *    which is the one that actually runs, handed every check everything. The same shape as the two
 *    copies of isSupplied, and the same cost. One definition, both readers, and a test that fails
 *    if either forgets."
 *
 * On 2 November it happened again and nothing failed. `his_words_chars` was added to the
 * claims_trace RUBRIC — "the brief carries his_words_chars… Read it before you judge" — and then:
 *
 *   - the Claude path put it at the top level of the JSON, not in the check's own prompt, so it
 *     vanished under bodies: "per_check" and was never part of what the judge read;
 *   - the Deno path had no mention of it at all;
 *   - every existing test passed.
 *
 * The worst-failing check in the system spent half a day being told to read a number that existed
 * in neither prompt. So these assert the wiring rather than the wording: every input `gateInputsFor`
 * grants must actually reach the rendered text, and every input it withholds must stay out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_CHECKS, GATE_USER } from "./prompts.ts";
import {
  CHECK_SEES_FIRST_LINE,
  CHECK_SEES_HIS_WORDS_CHARS,
  CHECK_SEES_SHAPE,
  gateInputsFor,
} from "./views.ts";

/** Everything a caller could pass, each value distinctive enough to find in the output. */
const ALL = {
  body: "A post.",
  entry: { his_words: "x".repeat(1234) },
  audience: "SDR leaders",
  clearedNames: ["Ben"],
  shape: ["SHAPE-MARKER: 9 paragraphs"],
  hisNotes: ["NOTES-MARKER: open with the number"],
  firstLine: ["FIRSTLINE-MARKER: 12 words"],
  hisWordsChars: 1234,
};

/** Render a check exactly as a caller that honours gateInputsFor would. */
function render(key: string) {
  const check = GATE_CHECKS.find((c) => c.key === key);
  if (!check) throw new Error(`no check named ${key}`);
  const sees = gateInputsFor(key);
  return GATE_USER({
    check,
    body: ALL.body,
    entry: sees.source ? ALL.entry : undefined,
    audience: sees.audience ? ALL.audience : undefined,
    clearedNames: sees.clearedNames ? ALL.clearedNames : undefined,
    shape: sees.shape ? ALL.shape : undefined,
    hisNotes: sees.hisNotes ? ALL.hisNotes : undefined,
    firstLine: sees.firstLine ? ALL.firstLine : undefined,
    hisWordsChars: sees.hisWordsChars ? ALL.hisWordsChars : undefined,
  });
}

test("every input a check is granted actually reaches its prompt", () => {
  // The defect this is built for: a field granted, passed, and rendered nowhere. Each marker below
  // is in exactly one input, so finding it proves the render happened rather than the pass.
  for (const check of GATE_CHECKS) {
    const sees = gateInputsFor(check.key);
    const text = render(check.key);

    if (sees.shape) {
      assert.ok(text.includes("SHAPE-MARKER"), `${check.key} is granted shape and cannot see it`);
    }
    if (sees.hisNotes) {
      assert.ok(text.includes("NOTES-MARKER"), `${check.key} is granted hisNotes and cannot see it`);
    }
    if (sees.firstLine) {
      assert.ok(
        text.includes("FIRSTLINE-MARKER"),
        `${check.key} is granted firstLine and cannot see it`,
      );
    }
    if (sees.hisWordsChars) {
      assert.ok(
        text.includes("1234"),
        `${check.key} is granted hisWordsChars and cannot see it — this is the 2 November defect`,
      );
    }
    if (sees.audience) {
      assert.ok(text.includes("SDR leaders"), `${check.key} is granted audience and cannot see it`);
    }
    if (sees.clearedNames) {
      assert.ok(text.includes("Ben"), `${check.key} is granted clearedNames and cannot see it`);
    }
  }
});

test("an input a check is NOT granted never appears in its prompt", () => {
  for (const check of GATE_CHECKS) {
    const sees = gateInputsFor(check.key);
    const text = render(check.key);
    if (!sees.shape) {
      assert.ok(!text.includes("SHAPE-MARKER"), `${check.key} can see shape and must not`);
    }
    if (!sees.hisNotes) {
      assert.ok(!text.includes("NOTES-MARKER"), `${check.key} can see hisNotes and must not`);
    }
    if (!sees.firstLine) {
      assert.ok(!text.includes("FIRSTLINE-MARKER"), `${check.key} can see firstLine and must not`);
    }
  }
});

test("the first line goes to the hook check and the shape numbers do not", () => {
  /*
   * The mirror-image mistakes, both of which were live on 2 November.
   *
   * views.ts withholds shape from hook_opens_loop because "a judge given numbers will use them" and
   * a hook judge shown a paragraph count starts failing posts for their shape. The first-line
   * measurement was put into shapeAgainst, whose output reaches only `shape` — so the hook judge
   * never saw the measurement built for it, and the shape judge was handed a hook argument.
   */
  assert.ok(CHECK_SEES_FIRST_LINE.has("hook_opens_loop"), "the hook check reads the first line");
  assert.equal(CHECK_SEES_FIRST_LINE.size, 1, "and it is the only one");
  assert.ok(!CHECK_SEES_SHAPE.has("hook_opens_loop"), "the hook check is still denied shape");
  assert.ok(!CHECK_SEES_FIRST_LINE.has("shape"), "the shape check is denied the first line");

  const hook = render("hook_opens_loop");
  assert.ok(hook.includes("FIRSTLINE-MARKER"));
  assert.ok(!hook.includes("SHAPE-MARKER"));

  const shape = render("shape");
  assert.ok(shape.includes("SHAPE-MARKER"));
  assert.ok(!shape.includes("FIRSTLINE-MARKER"));
});

test("how much he supplied reaches claims_trace and nothing else", () => {
  assert.deepEqual([...CHECK_SEES_HIS_WORDS_CHARS], ["claims_trace"]);

  const claims = render("claims_trace");
  assert.ok(claims.includes("1234"), "the count is in the prompt the judge reads");
  assert.match(claims, /NO threshold/i, "and it is told not to invent a line");

  // A thin brief makes an invented quote no more acceptable, so no other check can use this.
  for (const key of ["anyone_else", "identifiable", "banned_phrases", "shape"]) {
    assert.ok(!render(key).includes("1234"), `${key} must not be handed the count`);
  }
});

test("the rubric that names an input is only shipped with the input wired", () => {
  /*
   * The specific trap: a rubric sentence telling the judge to read a field, with nothing supplying
   * it. If someone names a new field in a rubric, this fails until gateInputsFor grants it and
   * GATE_USER renders it.
   */
  const claims = GATE_CHECKS.find((c) => c.key === "claims_trace")!;
  if (claims.question.includes("his_words_chars")) {
    assert.ok(
      CHECK_SEES_HIS_WORDS_CHARS.has("claims_trace"),
      "claims_trace names his_words_chars in its rubric but is not granted it",
    );
    assert.ok(
      render("claims_trace").includes("1234"),
      "claims_trace names his_words_chars in its rubric and the value is not rendered",
    );
  }
});
