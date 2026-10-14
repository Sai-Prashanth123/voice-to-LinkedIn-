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
import { measureShape, shapeAgainst, writerShapeTargets } from "./shape.ts";

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
