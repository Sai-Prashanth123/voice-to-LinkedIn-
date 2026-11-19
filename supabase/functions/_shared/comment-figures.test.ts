/**
 * A figure in a comment that is not his — EXECUTED, against the one that actually got through.
 *
 * WHAT HAPPENED
 *
 * 19 November, 07:00. The creator poll ran on its schedule for the first time and drafted three
 * comment options — the first this system has ever produced. One of them read:
 *
 *   "I've found that even with a waterfall, you're looking at a 15-20% drop in accuracy on mobile
 *    numbers within 60 days. Have you tested this against a direct-dial verification process yet?"
 *
 * and the model's own note on it said "[his_number]". Searched across every raw_inputs row, every
 * material field and the receipts section: ZERO hits for that figure. It exists nowhere Josh has
 * spoken or supplied. `flags` came back empty.
 *
 * A draft cannot do this: the claim ledger refuses an unsourced number outright and nothing is
 * stored. A comment had no equivalent — engage.ts said so in its own header, "they cannot catch an
 * invented number" — and a comment goes out in his name under somebody else's post.
 *
 * These tests hold the fourth check down with that exact comment as the fixture, so the regression
 * is the real one rather than an invented one.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { review } from "./engage.ts";

/** The comment that got through on 19 November, verbatim. */
const THE_ONE_THAT_GOT_THROUGH =
  "This works for the initial build, but the decay on that data is the part that usually kills " +
  "it. I've found that even with a waterfall, you're looking at a 15-20% drop in accuracy on " +
  "mobile numbers within 60 days. Have you tested this against a direct-dial verification " +
  "process yet?";

/** Julia Carter's post it was replying to, shortened. It carries no figures. */
const THEIR_POST =
  "Since LinkedIn blocks any sort of AI scraping and keeps most profiles in login jail, it can be " +
  "kind of tricky to build solid account plans with up to date information.";

const flagsOf = (f: { flag: string }[]) => f.map((x) => x.flag);

Deno.test("the comment that got through on 19 November is flagged now", () => {
  // Josh's material, as far as these figures are concerned: empty. That is what the search found.
  const flags = review(THE_ONE_THAT_GOT_THROUGH, THEIR_POST, [], new Set<string>());
  assert(
    flagsOf(flags).includes("figure_not_his"),
    `the real comment is still not flagged; flags were ${JSON.stringify(flagsOf(flags))}`,
  );
  const detail = flags.find((f) => f.flag === "figure_not_his")!.detail;
  assert(/15|20|60/.test(detail), `the flag does not name the figure to check: ${detail}`);
});

Deno.test("a figure he has actually given is not flagged", () => {
  // The whole point of the check is that his own numbers stay usable.
  const body = "We looked at 2,206 companies and the ratio held. Worth testing on yours?";
  const flags = review(body, THEIR_POST, [], new Set(["2206"]));
  assertEquals(
    flagsOf(flags).includes("figure_not_his"),
    false,
    `his own figure was flagged; flags were ${JSON.stringify(flagsOf(flags))}`,
  );
});

Deno.test("a figure quoted from their own post is not flagged", () => {
  /*
   * Quoting the number someone put in their own post back to them is legitimate and common, and a
   * check that flagged it would fire on half of all comments.
   */
  const theirs = "We tested this across 40 accounts last quarter and the pattern held.";
  const body = "The 40 accounts is the part I would push on. What did the tail look like?";
  const flags = review(body, theirs, [], new Set<string>());
  assertEquals(
    flagsOf(flags).includes("figure_not_his"),
    false,
    `a figure from their own post was flagged; flags were ${JSON.stringify(flagsOf(flags))}`,
  );
});

Deno.test("a comment with no figures at all raises nothing", () => {
  // Option 2 from the same run, which was genuinely clean.
  const body =
    "How are you handling the feedback loop when these selected accounts turn out to be poor " +
    "fits? I have found the error rate in the selection logic bubbles up later in the sequencer.";
  const flags = review(body, THEIR_POST, [], new Set<string>());
  assertEquals(flagsOf(flags), [], `a clean comment was flagged: ${JSON.stringify(flags)}`);
});

Deno.test("a failed read of his material is reported, not treated as a pass", () => {
  /*
   * null means the read failed. The alternative — an empty set — would be indistinguishable from
   * "he has never given a number", and would silently flag every figure in every comment. A check
   * that did not run must say so.
   */
  const flags = review(THE_ONE_THAT_GOT_THROUGH, THEIR_POST, [], null);
  assert(
    flagsOf(flags).includes("figures_not_checked"),
    `a failed read passed quietly; flags were ${JSON.stringify(flagsOf(flags))}`,
  );
  assertEquals(
    flagsOf(flags).includes("figure_not_his"),
    false,
    "it claimed a specific figure was unsourced when it had nothing to compare against",
  );
});

Deno.test("the other three checks still fire alongside it", () => {
  // Adding a fourth must not displace the three that were already load-bearing.
  const body = "Acme saw this too. " + THE_ONE_THAT_GOT_THROUGH;
  const flags = review(body, THEIR_POST, ["Acme"], new Set<string>());
  assert(flagsOf(flags).includes("named_someone"), "the name screen stopped firing");
  assert(flagsOf(flags).includes("figure_not_his"), "the figure screen stopped firing");
});
