/**
 * The borrowed-phrase check, which is allowed to refuse a draft — so it is tested like one.
 *
 * Two failure modes, and they are not symmetrical. Missing a borrowing lets a post go out carrying
 * somebody else's words, which is the thing clause 8.3 exists to stop. Flagging Josh's own sentence
 * refuses work he did correctly, and a check that does that often enough gets switched off, after
 * which it catches nothing at all. The second is the one that kills the check, so most of what is
 * below is about not crying wolf.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { borrowedRuns, hashRun, indexToSet, normaliseRun, shinglesOf } from "./shingles.ts";

/** Build a small index the way the real builder does, so the test exercises the real path. */
function indexOf(...texts: string[]): Set<string> {
  const hashes = new Set<string>();
  for (const t of texts) for (const run of shinglesOf(t)) hashes.add(hashRun(run));
  return new Set(hashes);
}

const BORROWED = "the quickest way to lose a client is to stop telling them what you are doing";

Deno.test("a run lifted word for word is caught", () => {
  const index = indexOf(BORROWED);
  const draft = `I learned something on Tuesday. ${BORROWED}. That was the whole lesson.`;
  const hits = borrowedRuns(draft, index);
  assertEquals(hits.length, 1);
  assert(hits[0].includes("quickest way to lose a client"));
});

Deno.test("every run it reports comes out of the draft it was given", () => {
  // It must never surface a run the caller had not already submitted. When the check fires the run
  // is the reference writer's too, but the caller is holding it either way — it is in the draft.
  const index = indexOf(BORROWED);
  const draft = `Before. ${BORROWED}. After.`;
  for (const hit of borrowedRuns(draft, index)) {
    assert(normaliseRun(draft).includes(hit), "every reported run must be a substring of the draft");
  }
});

Deno.test("one lifted sentence is reported once, not as nine overlapping windows", () => {
  // Reporting the same borrowing nine times would make a refusal unreadable and look like nine
  // separate offences.
  const index = indexOf(BORROWED);
  assertEquals(borrowedRuns(`x. ${BORROWED}. y`, index).length, 1);
});

Deno.test("six words in common are not a borrowing, and the seventh is", () => {
  // The threshold has to be a real one and it has to be exact. If any shared half-sentence tripped
  // it, every post on a subject two people have both written about would fail; if it needed more
  // than seven, a lifted clause would walk through. Both halves are asserted because this test was
  // first written with a six-word example that was actually seven, and passed the wrong way round.
  const index = indexOf("we spent the whole of last week rewriting the onboarding emails");
  assertEquals(
    borrowedRuns("We spent the whole of last month on something else entirely.", index),
    [],
    "six shared words, then it diverges",
  );
  assert(
    borrowedRuns("We spent the whole of last week on something else entirely.", index).length > 0,
    "seven shared words is a borrowing",
  );
});

Deno.test("ordinary sentences of his own are not flagged", () => {
  const index = indexOf(
    "the quickest way to lose a client is to stop telling them what you are doing",
    "most founders think they have a pricing problem when what they have is a positioning problem",
  );
  const his = [
    "We shipped it on Tuesday and the client said it was fine, so we moved on.",
    "He told me the number was wrong three weeks after I had already sent the invoice.",
    "I spent a morning on a spreadsheet that nobody was ever going to read.",
  ];
  for (const draft of his) assertEquals(borrowedRuns(draft, index), [], draft);
});

Deno.test("punctuation and smart quotes do not let a borrowing through", () => {
  // Normalisation has to agree with claims.ts, or the same sentence is two different sentences
  // depending on which module looked at it.
  const index = indexOf(BORROWED);
  const dressed = "The quickest way — to lose a client — is to stop telling them what you’re doing";
  assert(borrowedRuns(dressed.replace("you’re", "you are"), index).length > 0);
});

Deno.test("no index means no opinion, not an accusation", () => {
  // A missing index must not refuse a draft. "We could not check" and "this borrows" are different
  // answers and only one of them is true.
  assertEquals(borrowedRuns(BORROWED, null), []);
  assertEquals(borrowedRuns(BORROWED, new Set<string>()), []);
});

Deno.test("a draft shorter than the window is not a borrowing", () => {
  assertEquals(borrowedRuns("Too short.", indexOf(BORROWED)), []);
});

Deno.test("the packed index round-trips to exactly the hashes that went in", () => {
  // The file stores one long string with no separators. An off-by-one in the width would silently
  // produce an index full of nonsense that matches nothing, and nothing else would notice.
  const hashes = [...indexOf(BORROWED)].sort();
  const unpacked = indexToSet({
    built_at: "", algorithm: "", posts: 1, writers: [], words: 7,
    distinct: hashes.length, packed: hashes.join(""),
  });
  assertEquals(unpacked.size, hashes.length);
  for (const h of hashes) assert(unpacked.has(h), `${h} survived the round trip`);
});

Deno.test("every hash is the same fixed width, or the packing is meaningless", () => {
  const widths = new Set<number>();
  for (const w of ["a", "the quick brown fox jumps over it", "9 11 2026 x y z", "élan café naïve"]) {
    for (const run of shinglesOf(w + " one two three four five six seven")) {
      widths.add(hashRun(run).length);
    }
  }
  assertEquals([...widths], [11]);
});
