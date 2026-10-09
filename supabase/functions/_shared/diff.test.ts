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
 * THERE IS ONE COPY NOW, AND THE THRESHOLDS STILL HAVE TO HOLD.
 *
 * `app/lib/diff.ts` was a hand copy of this module, because the desk was Next and this tree is Deno.
 * This test pinned the two together mechanically, since the thresholds below ARE the 17a acceptance
 * measurement: two surfaces classifying the same edit differently would corrupt the number the
 * engagement is judged on, and the only symptom would be a figure that depended on where Josh
 * happened to tap Approve.
 *
 * The desk was deleted on 2026-10-09, so the copy is gone and there is nothing left to disagree with.
 * The cases it compared are kept and asserted against this module directly — the point was never the
 * comparison, it was that these specific edits land on the right side of the line.
 */
test("the classifier that decides the acceptance number holds its thresholds", () => {
  const cases: [string, string, "light" | "rewrite"][] = [
    // Untouched is the strongest evidence a draft was right, and it cannot read as a rewrite.
    ["Same text.", "Same text.", "light"],
    // One word swapped.
    [
      "I sat in a room with a CFO.\n\nHe said the number was wrong.",
      "I sat in a room with a CFO.\n\nHe said the figure was wrong.",
      "light",
    ],
    // A different post entirely.
    [
      "Three things I learned.\n\nOne. Two. Three.",
      "A CFO told me the number was wrong.\n\nHere is what happened next.\n\nAnd what it cost.\n\nAnd what I do now.",
      "rewrite",
    ],
    ["", "Something new entirely.", "rewrite"],
    /*
     * The boundary case, and it measures `light` — recorded here because I expected `rewrite` when
     * writing this and the classifier was right. A third of the body is cut and the hook survives
     * untouched, which is what Josh trimming a post for length looks like; a rewrite is him throwing
     * out what it was about. The thresholds live in `classifyEdit` and ARE the 17a number, so this
     * asserts what they do rather than what I assumed, and moving them is a decision about the
     * acceptance figure, not a test fix.
     */
    [
      "A hook that stays.\n\nBody one.\n\nBody two.",
      "A hook that stays.\n\nBody one.",
      "light",
    ],
  ];

  for (const [draft, published, expected] of cases) {
    assert.equal(
      classifyEdit(draft, published).editClass,
      expected,
      `wrong side of the line:
---
${draft}
---
${published}
---`,
    );
  }
});
