/**
 * What the drafter may add, and the four things it may never be — EXECUTED.
 *
 * WHY THIS EXISTS
 *
 * Josh, 18 November, after thirteen days of use: "The no-invention rule still stops posts before
 * the review sees them... So on 12 November Claude wouldn't write a pros and cons post until I
 * supplied the pros and cons, and when I said 'you can add this' on the next one, it asked me to
 * pick from options instead. Neither got as far as the review. I want Claude to add detail,
 * examples and argument I haven't given, and to fill a gap when I say it can. Mark each addition
 * in the ledger and read them back to me before I approve, so I'm checking them rather than being
 * blocked by them. Keep a hard line on numbers, quotes and client names if you think it's needed."
 *
 * So the ledger now has a kind that carries no span. The whole safety of that rests on the
 * refusals below being real rather than advisory, which is why each one is executed here with a
 * claim that must fail and a sibling that must pass.
 *
 * THE LINE THAT IS NOT HIS LIST. He named numbers, quotes and client names. A fourth is kept: a
 * new first-person claim about what he did, saw or was told. His own hook document teaches rage
 * hooks and says outright "do you actually have to do these things? No, we're being sarcastic" —
 * and a marked fabrication in his voice is one he would have to check against his own memory
 * rather than review. views.ts states the governing line: "nothing he can ask for makes an
 * invented quote acceptable."
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyDraft } from "./claims.ts";
import type { Claim } from "./claims.ts";

const ENTRY = {
  the_moment: "A VP of Sales told me their reply rate had halved since August.",
  their_actual_words: "The reply rate has halved since August.",
  his_words: "I think the problem is that everyone bought the same data provider at the same time.",
};

function added(claim: string, why = "It follows from what he said and he has not stated it."): Claim {
  return { claim, kind: "added", source_field: "added", source_span: "", why };
}

/** A sourced claim, so the draft under test is not made of additions alone. */
const SOURCED: Claim = {
  claim: "Their reply rate halved since August.",
  kind: "detail",
  source_field: "the_moment",
  source_span: "their reply rate had halved since August",
};

function run(body: string, claims: Claim[]) {
  return verifyDraft(body, claims, ENTRY, [], null);
}

/* ── What he asked for ─────────────────────────────────────────────────────── */

Deno.test("an argument he did not supply is accepted, and carried back with its reason", () => {
  // The pros-and-cons case of 12 November. Before this, there was no way to express it at all.
  const body =
    "A VP of Sales told me their reply rate had halved since August.\n\n" +
    "The cost of that is not the lost replies. It is the quarter you spend finding out why.";
  const result = run(body, [
    SOURCED,
    added(
      "The real cost of a falling reply rate is the time spent diagnosing it.",
      "It is the implication of what he described, not a new fact about his week.",
    ),
  ]);

  assertEquals(result.ok, true, `refused: ${result.failures.join(" ")}`);
  assertEquals(result.additions.length, 1);
  assertEquals(
    result.additions[0].claim,
    "The real cost of a falling reply rate is the time spent diagnosing it.",
  );
  assert(result.additions[0].why, "the addition came back with no reason, so there is nothing to read");
});

Deno.test("a post built only on his own material reports no additions, rather than nothing", () => {
  // "nothing was added" and "additions were never checked" are different answers.
  const result = run("Their reply rate halved since August.", [SOURCED]);
  assertEquals(result.ok, true);
  assertEquals(result.additions, [], "a post with no additions should say so with an empty list");
});

/* ── The hard line, his three ──────────────────────────────────────────────── */

Deno.test("an addition may not carry a number", () => {
  const result = run("Reply rates fell by about 40% across the market.", [
    added("Reply rates across the market fell by about 40%."),
  ]);
  assertEquals(result.ok, false);
  assert(
    result.failures.join(" ").includes("may not carry a figure"),
    `wrong refusal: ${result.failures.join(" ")}`,
  );
  assertEquals(result.additions, [], "a refused addition must not be read back as part of the post");
});

Deno.test("an addition may not carry a quotation", () => {
  const result = run('Somebody always says "we just need more volume".', [
    added('Buyers in this position say "we just need more volume".'),
  ]);
  assertEquals(result.ok, false);
  assert(
    result.failures.join(" ").includes("may not carry a quotation"),
    `wrong refusal: ${result.failures.join(" ")}`,
  );
});

Deno.test("an uncleared name is still refused, through the body, however the claim is marked", () => {
  /*
   * The name check does not consult the ledger at all and must not start: it scans the body. So
   * marking a sentence as added cannot launder a client's name into a post. This is the assertion
   * that proves the new kind did not open a route around clause 9.10.
   */
  const result = verifyDraft(
    "Acme saw the same thing happen.",
    [added("Companies in this position see the same thing happen.")],
    ENTRY,
    [{ name: "Acme", cleared: false }],
    null,
  );
  assertEquals(result.ok, false);
  assertEquals(result.unclearedNames, ["Acme"]);
});

/* ── The fourth line, which he did not ask for ─────────────────────────────── */

Deno.test("an addition may not invent something he did, saw or was told", () => {
  for (
    const invented of [
      "I ran the same test across my own pipeline and it held.",
      "We measured this with every client we have.",
      "A founder told me the same thing on a call last week.",
      "My clients see this constantly.",
    ]
  ) {
    const result = run(invented, [added(invented)]);
    assertEquals(result.ok, false, `allowed an invented first-person claim: "${invented}"`);
    assert(
      result.failures.join(" ").includes("something Josh did, saw or was told"),
      `wrong refusal for "${invented}": ${result.failures.join(" ")}`,
    );
  }
});

Deno.test("a general claim in the first person plural is not caught by that", () => {
  /*
   * The guard has to be narrow or it refuses ordinary writing. "We all know" and "we are told" are
   * rhetorical, not autobiographical, and a check that failed them would make the new kind useless.
   */
  for (
    const fine of [
      "We are all working from the same handful of data providers.",
      "Everyone in this market is told that volume is the lever.",
      "A team in this position usually looks at the list before the message.",
    ]
  ) {
    const result = run(fine, [SOURCED, added(fine)]);
    assertEquals(result.ok, true, `refused ordinary prose: "${fine}" — ${result.failures.join(" ")}`);
  }
});

Deno.test("a written-out number in an addition is still a number, and this is the sharp edge", () => {
  /*
   * Found by this file's own first draft, which used "the same three data providers" as an example
   * of ordinary prose and was refused. `extractNumbers` canonicalises word-numerals from "two"
   * upward, so "three data providers" is a quantity claim and has to trace like any other.
   *
   * That is correct and it is strict: an addition cannot say "three reasons" or "two ways" unless
   * the figure is his. A drafter will hit this, so it is pinned here rather than left to be
   * rediscovered as a bug — the fix is to write the point without counting, which is almost always
   * the better line anyway.
   */
  const result = run("There are three ways a list goes stale.", [
    added("A list goes stale in three distinct ways."),
  ]);
  assertEquals(result.ok, false, "a written-out quantity passed inside an addition");
  assert(
    result.failures.join(" ").includes("may not carry a figure"),
    `wrong refusal: ${result.failures.join(" ")}`,
  );
});

Deno.test("the body is not scanned for first person, because every post of his is first person", () => {
  /*
   * 346 of the 2,082 reference posts open with "I". The guard applies to the text of a declared
   * addition and nowhere else; a sourced first-person sentence in the body is the normal case and
   * must pass untouched.
   */
  const result = run(
    "I sat with a VP of Sales who told me their reply rate had halved since August.",
    [SOURCED],
  );
  assertEquals(result.ok, true, `refused a sourced first-person body: ${result.failures.join(" ")}`);
});

/* ── The reason, which is the thing he reads ───────────────────────────────── */

Deno.test("an addition with no reason is refused, because there is nothing to check", () => {
  const result = run("The cost is the diagnosis.", [
    { claim: "The cost is the diagnosis.", kind: "added", source_field: "added", source_span: "" },
  ]);
  assertEquals(result.ok, false);
  assert(
    result.failures.join(" ").includes('needs a "why"'),
    `wrong refusal: ${result.failures.join(" ")}`,
  );
});

Deno.test("a shrug is not a reason", () => {
  const result = run("The cost is the diagnosis.", [added("The cost is the diagnosis.", "obvious")]);
  assertEquals(result.ok, false, "accepted 'obvious' as the reason he is meant to review");
});

/* ── Nothing else loosened ─────────────────────────────────────────────────── */

Deno.test("a sourced claim still needs its span to appear, exactly", () => {
  // The paraphrase refusal is the floor the whole ledger rests on and must be untouched by this.
  const result = run("The reply rate has halved since August.", [{
    claim: "The reply rate halved.",
    kind: "detail",
    source_field: "the_moment",
    source_span: "their reply rate has halved since August",
  }]);
  assertEquals(result.ok, false, "a paraphrased span passed");
  assert(result.failures.join(" ").includes("does not appear"));
});

Deno.test("an unsourced number in the body is refused even with additions present", () => {
  const result = run("Reply rates halved and 2,206 companies show it.", [
    SOURCED,
    added("The pattern is market-wide rather than particular to them."),
  ]);
  assertEquals(result.ok, false);
  assert(result.unsourcedNumbers.includes("2206") || result.unsourcedNumbers.includes("2,206"));
});
