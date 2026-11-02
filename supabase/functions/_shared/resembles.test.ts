/**
 * The capture-time duplicate check, and the two ways it can be wrong while reporting success.
 *
 * The cases below are not invented. They are the pairs the 2 November soak surfaced in the real
 * bank, reduced to their shared wording, which makes them a regression test rather than an
 * illustration: if this check stops catching m91/m92 it has stopped doing the one thing it is for.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import { MIN_LONG_PASSAGE_WORDS, MIN_PASSAGES, resembles } from "./resembles.ts";

/*
 * The real pair, reduced to its measured shape. "Champion moved companies" and "Champion moved to
 * new company" were captured separately, are one idea, and in the bank they share TWO short
 * passages with the longest at nine words. The fixtures keep that shape, because a fixture that
 * shares one long span would pass on the other arm of the rule and prove nothing about this one.
 */
const M91 = "noticed a title changed on a profile we were already tracking and it turned out " +
  "later that the champion had moved to a new company entirely without telling anyone";
const M92 = "a title changed on a profile we were already tracking which meant one thing only, " +
  "that the champion had moved to a new company and nobody told us";

Deno.test("it catches the duplicate the soak found", () => {
  const r = resembles(M92, [{ moment_id: 91, title: "Champion moved companies", text: M91 }]);

  assertEquals(r.checked, 1);
  assertEquals(r.found.length, 1);
  assertEquals(r.found[0].moment_id, 91);
  assert(
    r.found[0].longest.includes("title changed on a profile we were already tracking"),
    `the shared span should be reported, got: ${r.found[0].longest}`,
  );
  // The reply must name it, because he is never shown ids.
  assert(r.means.includes("Champion moved companies"), r.means);
});

Deno.test("a genuinely new thought comes back clean, and says what it checked", () => {
  const r = resembles(
    "a prospect replied to say the pricing page was the thing that made them book",
    [{ moment_id: 91, title: "Champion moved companies", text: M91 }],
  );

  assertEquals(r.found.length, 0);
  assertEquals(r.checked, 1);
  // And it must say what it CANNOT do, or it will be read as "this is not a retelling".
  assert(r.means.includes("exact phrasing"), r.means);
});

Deno.test("NOTHING TO COMPARE is not the same answer as nothing found", () => {
  const empty = resembles("anything at all", []);
  assertEquals(empty.checked, 0);
  assertEquals(empty.found.length, 0);

  const clean = resembles("something else entirely about pricing pages", [
    { moment_id: 91, title: "Champion moved companies", text: M91 },
  ]);

  // Both have found nothing. They must not read the same, because one of them is a failure.
  assert(
    empty.means !== clean.means,
    "an empty comparison reports the same as a clean one, which is the defect this repo keeps " +
      "finding: a check with nothing to check reporting success",
  );
  assert(/NOTHING WAS COMPARED/.test(empty.means), empty.means);
});

Deno.test("priors with no text are not counted as compared", () => {
  const r = resembles(M92, [
    { moment_id: 91, title: "Champion moved companies", text: M91 },
    { moment_id: 7, title: "No raw text", text: "" },
    { moment_id: 8, title: "Whitespace only", text: "   \n  " },
  ]);

  // Three handed in, one comparable. Counting the input would overstate the basis.
  assertEquals(r.checked, 1);
  assertEquals(r.found.length, 1);
});

Deno.test("one shared passage is below the threshold", () => {
  const prior = "we went through the booking pages one at a time by hand for longer than i want " +
    "to admit and the whole thing cost nothing at all";
  // Shares exactly one seven-word span and nothing else.
  const fresh = "the list we had covered a third, so one at a time by hand was the only route in";

  const r = resembles(fresh, [{ moment_id: 1, title: "Booking pages", text: prior }]);
  assert(
    r.found.length === 0 || r.found[0].passages >= MIN_PASSAGES,
    `a single shared idiom should not surface: ${JSON.stringify(r.found)}`,
  );
});

Deno.test("passages are merged, not counted as separate runs", () => {
  // A long shared sentence. Unmerged, this reports as many overlapping seven-word runs and the
  // finding reads an order of magnitude worse than it is — the fault self-echo.mjs had on day one.
  const shared = "the vendor publishes an online booking page for every single practice that runs " +
    "the software and each page carries a practice id and a live id";
  const r = resembles(shared, [{ moment_id: 2, title: "Booking pages", text: shared }]);

  assertEquals(r.found.length, 1);
  assert(
    r.found[0].passages <= 3,
    `one shared sentence should merge into one passage, got ${r.found[0].passages}`,
  );
  assert(r.found[0].longest_words > 15, "the merged passage should be the long span");
});

/**
 * THE CASE THE OBVIOUS RULE MISSES, and the reason this check has two arms.
 *
 * Because overlapping hits merge, two captures that duplicate each other almost entirely produce
 * exactly ONE passage. In the real bank m110 and m111 share a single merged passage of 925 words
 * and carry the same title but for its capitalisation; m107 and m108 share 456 words and carry
 * the SAME title. A threshold of "two or more passages" reports all three of those clear.
 *
 * This test existed before the second arm did, and it failed.
 */
Deno.test("a near-total duplicate fires on one passage", () => {
  const long = "we were looking at whether the software shows up in public at all and it turns " +
    "out there are four separate ways to see it, job ads which prove nothing on their own, the " +
    "front end html which is the cheapest to read, dns records which are harder, and login " +
    "portals where some tools hand every customer their own address";

  const r = resembles(long, [{ moment_id: 110, title: "Ways to detect technology", text: long }]);

  assertEquals(r.found.length, 1, "a wholly duplicated capture must be found");
  assertEquals(r.found[0].passages, 1, "it is one merged passage, which is the whole point");
  assert(
    r.found[0].longest_words >= MIN_LONG_PASSAGE_WORDS,
    `the long arm should carry it, got ${r.found[0].longest_words} words`,
  );
});

Deno.test("the worst duplicate is reported first, by how much was shared", () => {
  const long = "we were looking at whether the software shows up in public at all and it turns " +
    "out there are four separate ways to see it, job ads which prove nothing on their own, the " +
    "front end html which is the cheapest to read, dns records which are harder to get at";

  const r = resembles(long, [
    { moment_id: 91, title: "Two short spans", text: M91 + " " + long.slice(0, 60) },
    { moment_id: 110, title: "Near total", text: long },
  ]);

  assert(r.found.length >= 1);
  assertEquals(
    r.found[0].moment_id,
    110,
    "a 40-word single passage is a nearer duplicate than several short ones, and must rank first",
  );
});

Deno.test("the wording hands the decision to him and never condemns the capture", () => {
  const r = resembles(M92, [{ moment_id: 91, title: "Champion moved companies", text: M91 }]);

  // A second angle on one piece of material is explicitly allowed. If this reads as a fault, the
  // check will cost him ideas rather than save him work.
  assert(/HIS CALL/.test(r.means), r.means);
  assert(/second angle/.test(r.means), r.means);
  assert(/not park or kill/.test(r.means), r.means);
  // And it must disclaim being the retelling check, which reads meaning rather than wording.
  assert(/retelling check/.test(r.means), r.means);
});

Deno.test("it is cheap enough to sit on the write path", () => {
  // The bank is ~100 moments and 90 KB. One capture compares against all of them.
  const priors = Array.from({ length: 120 }, (_, i) => ({
    moment_id: i,
    title: `idea ${i}`,
    text: M91 + " " + "filler words that differ ".repeat(40) + i,
  }));

  const started = performance.now();
  const r = resembles(M92, priors);
  const took = performance.now() - started;

  assertEquals(r.checked, 120);
  assert(took < 1500, `took ${took.toFixed(0)}ms against 120 priors, which is too slow for a write`);
});
