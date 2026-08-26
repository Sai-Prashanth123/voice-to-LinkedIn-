import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEdit, hookOf, meetsAcceptanceBar, similarity } from "./diff.ts";

const draft = `I watched a CFO stop a deal in its tracks last Tuesday.

He put his hand up halfway through the deck and asked what happens when the champion leaves.
I did not have an answer that was not a platitude.

Every deal has a single point of failure. It is usually a person.`;

test("hookOf takes the opening line, not the opening paragraph", () => {
  assert.equal(hookOf(draft), "I watched a CFO stop a deal in its tracks last Tuesday.");
});

test("identical text is untouched", () => {
  const r = classifyEdit(draft, draft);
  assert.equal(r.editRatio, 0);
  assert.equal(r.editClass, "light");
  assert.deepEqual(r.reasons, []);
});

test("word and line level edits classify as light (17a)", () => {
  // A cut sentence and a tightened close: story, angle, hook and structure all survive.
  const published = `I watched a CFO stop a deal in its tracks last Tuesday.

He put his hand up halfway through the deck and asked what happens when the champion leaves.
I had no answer that wasn't a platitude.

Every deal has a single point of failure. Usually it is a person.`;
  const r = classifyEdit(draft, published);
  assert.equal(r.editClass, "light", r.reasons.join("; "));
});

test("a replaced hook is a rewrite even if the body survives", () => {
  const published = `Your champion is going to leave. Then what?

He put his hand up halfway through the deck and asked what happens when the champion leaves.
I did not have an answer that was not a platitude.

Every deal has a single point of failure. It is usually a person.`;
  const r = classifyEdit(draft, published);
  assert.equal(r.editClass, "rewrite");
  assert.match(r.reasons.join(" "), /hook replaced/);
});

test("a restructured body is a rewrite even if the words are reused", () => {
  const published =
    `I watched a CFO stop a deal in its tracks last Tuesday. He put his hand up halfway ` +
    `through the deck and asked what happens when the champion leaves. I did not have an answer ` +
    `that was not a platitude. Every deal has a single point of failure. It is usually a person.`;
  const r = classifyEdit(draft, published);
  assert.equal(r.editClass, "rewrite");
  assert.match(r.reasons.join(" "), /restructured/);
});

test("a different story entirely is a rewrite", () => {
  const published = `Most founders price on cost. That is why they lose.

I have watched it happen across a decade of deals and it never gets less painful to sit through.`;
  const r = classifyEdit(draft, published);
  assert.equal(r.editClass, "rewrite");
  assert.ok(r.editRatio > 0.5, `expected a high edit ratio, got ${r.editRatio}`);
});

test("similarity is symmetric and bounded", () => {
  assert.equal(similarity("", ""), 1);
  assert.equal(similarity("a b c", ""), 0);
  assert.equal(similarity("a b c", "a b c"), 1);
  assert.equal(
    similarity("the cat sat", "the dog sat"),
    similarity("the dog sat", "the cat sat"),
  );
});

test("the 17a bar needs five of the last six, and a full window", () => {
  const L = "light" as const;
  const R = "rewrite" as const;

  assert.deepEqual(meetsAcceptanceBar([L, L, L, L, L, L]), { passing: true, light: 6, of: 6 });
  assert.deepEqual(meetsAcceptanceBar([L, L, L, L, L, R]), { passing: true, light: 5, of: 6 });
  assert.deepEqual(meetsAcceptanceBar([L, L, L, L, R, R]), { passing: false, light: 4, of: 6 });

  // Fewer than six drafts cannot pass the bar yet, however good they are.
  assert.equal(meetsAcceptanceBar([L, L, L]).passing, false);

  // Only the most recent six count.
  assert.equal(meetsAcceptanceBar([L, L, L, L, L, L, R, R, R]).passing, true);
});

/**
 * THE TWO COPIES MUST AGREE.
 *
 * `app/lib/diff.ts` is a copy of this module, because the app is Next and this tree is Deno. The
 * precedent for that (`app/lib/pillars.ts`) is held together by a comment asking whoever edits one
 * to remember the other, which is not a guarantee — it is a hope.
 *
 * These thresholds ARE the 17a acceptance measurement. Two surfaces classifying the same edit
 * differently would corrupt the number the engagement is judged on, silently, and the only symptom
 * would be an acceptance figure that depends on where Josh happened to tap Approve. So the copies
 * are pinned mechanically instead.
 */
import { classifyEdit as appClassifyEdit } from "../../../app/lib/diff.ts";

test("the app's copy of the diff classifier agrees with this one", () => {
  const cases: [string, string][] = [
    ["Same text.", "Same text."],
    ["I sat in a room with a CFO.\n\nHe said the number was wrong.", "I sat in a room with a CFO.\n\nHe said the figure was wrong."],
    ["Three things I learned.\n\nOne. Two. Three.", "A CFO told me the number was wrong.\n\nHere is what happened next.\n\nAnd what it cost.\n\nAnd what I do now."],
    ["", "Something new entirely."],
    ["A hook that stays.\n\nBody one.\n\nBody two.", "A hook that stays.\n\nBody one."],
  ];

  for (const [draft, published] of cases) {
    const mine = classifyEdit(draft, published);
    const theirs = appClassifyEdit(draft, published);
    assert.deepEqual(
      theirs,
      mine,
      `the two copies disagree on:\n---\n${draft}\n---\n${published}\n---`,
    );
  }
});
