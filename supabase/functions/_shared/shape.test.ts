/**
 * The numbers the ninth check is handed.
 *
 * Shape was the one thing in the library that nothing enforced: the rule was written, the drafter
 * was shown it, the judge was not, and every measurement was reported rather than flagged. A post
 * that was specific, traceable, aimed, in-voice and clean of banned phrases passed all eight as one
 * unbroken block, which is what Josh kept receiving and described on 14 October as "just a wall of
 * text".
 *
 * These assert the counting, not the judging. The verdict is a model's and belongs to the rubric;
 * what must never be wrong is the arithmetic it is given — the gate was briefly handed "54 words
 * above the fold, 31 words in total", which is impossible, because a backslash was eaten in a
 * generated caller and `/\s+/` became `/s+/`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { measureShape, renderedLines, shapeAgainst, writerShapeTargets } from "./shape.ts";

const WALL =
  "Every tool I run is on trial. Including the ones I'd defend. Claude Code and Deepline CLI. " +
  "Even those come with a maybe. Whatever gets the job done quickest is what I use.";

const SHAPED = `Every tool I run is on trial.

Claude Code and Deepline CLI. Even those come with a maybe.

What I actually do:

- Try a different tool.
- Keep what works.
- Drop what doesn't.

That is the whole rule.`;

test("the word count is the word count", () => {
  // The impossible pair that shipped: above the fold cannot exceed the total.
  for (const body of [WALL, SHAPED]) {
    const s = measureShape(body);
    assert.ok(s.words > 0);
    assert.ok(
      s.above_fold_words <= s.words,
      `above the fold (${s.above_fold_words}) exceeds the total (${s.words})`,
    );
  }
  assert.equal(measureShape("one two three").words, 3);
  assert.equal(measureShape("").words, 0);
  assert.equal(measureShape(null).words, 0);
});

test("a wall of text is one paragraph with no list", () => {
  const s = measureShape(WALL);
  assert.equal(s.paragraphs, 1);
  assert.equal(s.uses_list, false);
  assert.equal(s.bullet_lines, 0);
});

test("a shaped post is counted as shaped", () => {
  const s = measureShape(SHAPED);
  assert.ok(s.paragraphs >= 4, `${s.paragraphs} paragraphs`);
  assert.equal(s.uses_list, true);
  assert.equal(s.bullet_lines, 3);
  assert.equal(s.colon_lines, 1, "the colon lead-in was not counted");
});

test("one stray dash is a sentence, not a list", () => {
  assert.equal(measureShape("A line.\n- only one bullet").uses_list, false);
});

test("the writers' targets come from measurable posts only", () => {
  // Most of what the console returns is one unbroken line. Averaging those in would report the
  // scraper's behaviour as a habit of the writer, which is why only has_line_breaks rows are read.
  const targets = writerShapeTargets([
    { handle: "a", paragraphs: 4, above_fold_words: 17 },
    { handle: "a", paragraphs: 6, above_fold_words: 21 },
    { handle: "b", paragraphs: 14, above_fold_words: 74 },
    { handle: "c", paragraphs: null, above_fold_words: 30 },
    { handle: "", paragraphs: 99, above_fold_words: 99 },
  ]);

  // a's median of 4 and 6 is 5; b is 14. c has no paragraph count and the blank handle is dropped.
  assert.deepEqual(targets.paragraphs.sort((x, y) => x - y), [5, 14]);
  assert.ok(!targets.paragraphs.includes(99), "a row with no handle reached the targets");
});

test("the measured block names both the post and the range", () => {
  const lines = shapeAgainst(measureShape(WALL), { paragraphs: [4, 14], aboveFold: [17, 74.5] });
  const text = lines.join(" ");

  assert.match(text, /1 paragraph/);
  assert.match(text, /no list/);
  assert.match(text, /4 to 14 paragraphs/);
  assert.match(text, /17 to 74.5 words above the fold/);
});

test("no targets produces an honest blank rather than an invented range", () => {
  const text = shapeAgainst(measureShape(WALL), { paragraphs: [], aboveFold: [] }).join(" ");
  assert.match(text, /not measured/);
});

/* ── The fold, as a phone renders it ───────────────────────────────────────────
 *
 * Josh, 26 October: "If the hook doesn't sit above the 'see more' line on mobile, it doesn't do its
 * job. I'd like the system to actually measure that, in phone lines, not just word count."
 *
 * These assert the two directions the old measurement was wrong in, and that it still means what it
 * always meant — every stored median and the ninth check's targets rest on it.
 */

test("blank lines cost a line, which the old measure could not see", () => {
  // Three one-word paragraphs: three authored lines, five rendered, because the gaps are real.
  const m = measureShape("Late.\n\nAgain.\n\nSorry.");
  assert.equal(m.above_fold_words, 3, "the old measure must keep its meaning exactly");
  assert.ok(m.rendered_lines >= 5, `three one-word paragraphs render as ${m.rendered_lines} lines`);
});

test("a long opening paragraph no longer reports more words than fit on a screen", () => {
  /*
   * The worse direction, and the one nobody noticed. `lines` filters blanks out, so a single long
   * paragraph is ONE entry and slice(0, 3) returns the whole thing. That is how measure_draft could
   * ever flag "90 words above the fold" — ninety words do not fit above any fold on any phone.
   */
  const body = "I sat down on the Tuesday after the quarter closed and worked out that the number " +
    "we had been reporting for eleven weeks was the number nobody in the room had actually agreed " +
    "to, which meant every forecast built on it was wrong in the same direction.";
  const m = measureShape(body);
  assert.ok(m.above_fold_words > 40, "the fixture is not long enough to show the fault");
  assert.ok(
    m.above_fold_rendered_words < m.above_fold_words / 2,
    `${m.above_fold_rendered_words} rendered against ${m.above_fold_words} claimed`,
  );
  assert.equal(m.hook_above_fold, false, "a sentence this long cannot clear the cut");
});

test("the hook clears the fold when it is short enough to", () => {
  const m = measureShape("The AI made the quotes up.\n\nAll four of them.\n\nI only caught one.");
  assert.equal(m.hook_above_fold, true);
});

test("the two above-fold numbers are never the same measurement", () => {
  // If these ever converge, something has started using one where the other belongs.
  const m = measureShape("Late.\n\nAgain.\n\nSorry.\n\nThe call had already started without me.");
  assert.ok(
    m.above_fold_words !== m.above_fold_rendered_words || m.rendered_lines > m.lines,
    "the rendered fold is indistinguishable from the authored one on a case built to separate them",
  );
});

test("an empty or tiny post does not throw and claims no hook", () => {
  for (const body of ["", "   ", "\n\n\n"]) {
    const m = measureShape(body);
    assert.equal(m.rendered_lines, 0);
    assert.equal(m.hook_above_fold, false);
    assert.equal(m.cut_mid_sentence, false);
  }
});

test("a word longer than the line still occupies one", () => {
  const long = "a".repeat(200);
  assert.ok(renderedLines(long).length >= 1);
  assert.equal(renderedLines(long)[0], long);
});

test("the wrap is greedy, not arithmetic", () => {
  // ceil(chars / perLine) undercounts a line of long words, and the opening line is where long
  // words live — which is the line this measurement exists to judge.
  const words = ["alphabetical", "considerations", "notwithstanding", "implementation"];
  const lines = renderedLines(words.join(" "), { charsPerLine: 20 });
  for (const l of lines) assert(l.length <= 20 || !l.includes(" "), `"${l}" exceeds the width`);
});
