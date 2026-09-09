import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_STRENGTH, worthSurfacing } from "./triage.ts";

const at = (strength: number, tag = "") => ({
  summary: `candidate ${tag || strength}`,
  why_interesting: "because",
  strength,
  opening_question: "what happened?",
  names: [],
});

test("anything under the bar is discarded, however much is claimed for it", () => {
  // The bar is applied AFTER the model's own judgement, because a model asked for its best
  // candidates will always find some. A caller cannot argue its way past it.
  const kept = worthSurfacing([at(1), at(2), at(3)], 10);
  assert.equal(kept.length, 0);
});

test("the bar is four, and four passes", () => {
  assert.equal(MIN_STRENGTH, 4);
  assert.equal(worthSurfacing([at(4)], 10).length, 1);
  assert.equal(worthSurfacing([at(3)], 10).length, 0);
});

test("when the cap bites it takes the weakest, not the last", () => {
  // Ordering is the whole reason this is sorted rather than sliced as it arrives. Josh gets the
  // strongest two, not whichever two the model happened to list first.
  const kept = worthSurfacing([at(4, "a"), at(5, "b"), at(4, "c"), at(5, "d")], 2);
  assert.deepEqual(kept.map((c) => c.strength), [5, 5]);
});

test("no room means nothing surfaces, whatever was offered", () => {
  // 4.4.3 — the cap is on what Josh SEES. A run with no room must add nothing rather than
  // "just one more".
  assert.equal(worthSurfacing([at(5), at(5), at(5)], 0).length, 0);
  assert.equal(worthSurfacing([at(5)], -3).length, 0, "a negative room is still no room");
});

test("an empty list is fine and is the expected result", () => {
  // "Empty is the expected result most of the time. Do not pad it." A run that produced nothing
  // is a correct run, and nothing here should treat it as an error.
  assert.equal(worthSurfacing([], 3).length, 0);
  assert.equal(worthSurfacing(undefined as never, 3).length, 0);
});

test("a strength sent as a string is still judged as a number", () => {
  // JSON over the wire, and a model that writes "5" instead of 5 should not sneak past the bar
  // in either direction.
  assert.equal(worthSurfacing([{ ...at(5), strength: "5" as never }], 3).length, 1);
  assert.equal(worthSurfacing([{ ...at(2), strength: "2" as never }], 3).length, 0);
});
