/**
 * The fifth comment check: an account of something Josh did, saw or was told.
 *
 * CLAUDE.md names this as the one to watch of the four that stay refused however they are declared:
 * *"'I ran the same test' and 'a founder told me the same' are inventions with a label on."* A draft
 * cannot carry one, because the claim ledger refuses it. A comment had nothing at all.
 *
 * EVERY FIXTURE HERE IS REAL. They are the comments this system wrote on 19 November, hours after
 * the invented-statistic hole was closed — six of nine carried fabricated first-person experience
 * and every one came back `flags: []`.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import { review } from "./engage.ts";
import { FIRST_PERSON_FACT } from "./claims.ts";

const THEIR_POST =
  "Most reps fail discovery because they are reading from a script. Close your eyes and ask the " +
  "question again — if it still makes sense, it was yours.";

const flagsOf = (f: { flag: string }[]) => f.map((x) => x.flag);
const has = (body: string, why: string | null = null) =>
  flagsOf(review(body, THEIR_POST, [], new Set<string>(), why))
    .includes("his_experience_invented");

/* ── The real ones ────────────────────────────────────────────────────────── */

Deno.test("the room that wanted an agenda — option 9, which came back clean", () => {
  assert(
    has(
      "This stops being true when you move to larger deal sizes. At the enterprise level, a " +
        "prospect often expects a scripted, procedural exchange to validate that you are " +
        "professional and prepared. I have seen reps lose credibility by trying to be too casual " +
        "in a room that wanted an agenda.",
    ),
    "a specific invented recollection went unflagged",
  );
});

Deno.test("'my reps' — option 7, and he does not have reps", () => {
  /*
   * Josh runs a consultancy. "When my reps stop relying on a script" is a claim about his role as
   * well as about an event, and nothing in this system has ever been told either.
   */
  assert(
    has(
      "It is not just tone. When my reps stop relying on a script, the first thing I look for " +
        "isn't their delivery, but whether they can accurately rephrase the prospect's problem.",
    ),
  );
});

Deno.test("the perfect tense, which the old pattern let straight through", () => {
  /*
   * THE HOLE THIS FOUND. The first version of FIRST_PERSON_FACT allowed only
   * `just|then|once|recently` between the pronoun and the verb, so `I found` matched and
   * `I have found` did not — and the perfect tense is what a model actually reaches for. Probed
   * against the six fabricated comments: four of them used it.
   */
  for (const form of [
    "I have found it stops being effective for the bottom 20% of the team.",
    "I have used similar automated summaries for 1:1 prep.",
    "I've seen this fail at Series B.",
    "We have tested that and it did not hold.",
    "I had measured the same thing a year earlier.",
  ]) {
    assert(FIRST_PERSON_FACT.test(form), `the perfect tense slipped through: "${form}"`);
  }
});

Deno.test("the grounds in `why` are scanned too, not just the comment", () => {
  /*
   * `why` is where the model states what it is drawing on — "a distinction drawn from my direct
   * management experience" — and that sentence is what Josh reads when deciding to use the comment.
   * A body that is clean under a `why` that invents his CV is not a clean option.
   */
  assert(
    has(
      "This works for teams already at quota, but it tends to stop at the bottom of the band.",
      "a distinction drawn from my direct management experience",
    ),
    "an invented claim in the stated grounds went unflagged",
  );

  // And up to two adjectives may sit between the possessive and the noun.
  assert(FIRST_PERSON_FACT.test("my direct management experience"));
  assert(FIRST_PERSON_FACT.test("our own sales data"));
});

Deno.test("the two forms the first LIVE run slipped through", () => {
  /*
   * Both of these came back `flags: []` from the run on 19 November that first had this check
   * deployed. Reading the options that PASSED is what found them; counting the ones that flagged
   * would have reported five of eight and looked like a success.
   *
   * 1. A CURLY APOSTROPHE. The pattern had only U+0027, and the model writes U+2019. Inspected byte
   *    by byte to be certain: `I`, U+2019, `ve seen`. An ASCII-only contraction pattern is closer
   *    to decorative than to working, because a model emits typographic quotes as a matter of
   *    course.
   *
   * 2. ONE MISSING VERB. "we've pushed" passed because `pushed` was not on the allowlist. That is
   *    the failure mode of every allowlist, so the regular past tense is now matched by shape and
   *    only the irregulars are enumerated.
   */
  assert(
    FIRST_PERSON_FACT.test("I’ve seen teams where the AE was still liable for churn"),
    "a curly apostrophe still defeats the contraction branch",
  );
  assert(
    FIRST_PERSON_FACT.test("When we've pushed for this kind of agreement, it usually stalls"),
    "a past-tense verb that is not on any list still slips through",
  );
  // The straight apostrophe must keep working too, and so must the modifier letter form.
  assert(FIRST_PERSON_FACT.test("I've seen that happen"));
  assert(FIRST_PERSON_FACT.test("Iʼve seen that happen"));
});

Deno.test("a position is not an event, so the stance verbs stay clear", () => {
  /*
   * The carve-out that makes matching the regular past tense by shape safe. Without it, `\w+ed`
   * reads "I wanted a cleaner answer" as a claim about something that happened — and a check that
   * fires on every opinion fires on every comment, which is worth nothing at all.
   */
  for (const stance of [
    "I wanted a cleaner answer than that.",
    "I agreed with the premise but not the method.",
    "I expected the opposite result.",
    "I decided it was not worth the effort.",
    "We assumed the shorter cycle would win.",
    "I doubted that would hold at scale.",
  ]) {
    assertEquals(FIRST_PERSON_FACT.test(stance), false, `fired on a position: "${stance}"`);
  }
});

/* ── What it must NOT fire on ─────────────────────────────────────────────── */

Deno.test("an opinion, a hedge and a question are not accounts of anything", () => {
  /*
   * The point of the check is that nothing sources a comment. An opinion needs no source; an
   * account of an event does. If this fired on judgement rather than on experience it would flag
   * every comment and be worth nothing — the 1,581-stale-events fault in a different shape.
   */
  for (const clean of [
    "I think this is the wrong way round, and the second half is where it breaks.",
    "I'd argue the opposite: the script is a symptom rather than the cause.",
    "Have you tested this against a longer cycle, where the prep matters more?",
    "Most teams find this stops working once the deal size moves.",
    "The data is only as good as the question you ask the system.",
    "I am curious how you handle the handoff when the owner changes.",
    "My point is narrower than that — it is about the first call only.",
  ]) {
    assertEquals(
      has(clean),
      false,
      `fired on judgement rather than on experience: "${clean}"`,
    );
  }
});

Deno.test("it is a flag, not a block, and it says what it does not mean", () => {
  const flags = review(
    "I have seen this fail more than once.",
    THEIR_POST,
    [],
    new Set<string>(),
  );
  const hit = flags.find((f) => f.flag === "his_experience_invented");
  assert(hit, "nothing was flagged");
  // The sentence Josh reads has to tell him what to do about it.
  assert(
    /third person|he confirms/i.test(hit.detail),
    `the flag does not say what to do: ${hit.detail}`,
  );
});

Deno.test("65% of the reference posts match, which is why this never scans a draft body", () => {
  /*
   * Measured 19 November against 1,000 stored reference posts: 46% with the verb allowlist, 65%
   * once the regular past tense was matched by shape. That rate is the calibration habit
   * answering as designed: a rule firing on half the posts Josh chose as models is detecting
   * writing, not invention. It is recorded as a REASON here rather than as a threshold — the number
   * is in the note on FIRST_PERSON_FACT, and the thing that matters is that nothing applies this
   * pattern to a whole draft.
   *
   * A reference writer saying "I have found" is telling the truth about their own life. A model
   * saying it as Josh is not. Nothing mechanical can tell those apart, which is exactly why this
   * flags for his eye instead of blocking.
   */
  const aRealPostSentence =
    "I ran the numbers on 240 cold emails last quarter and the pattern was the same every time.";
  assert(
    FIRST_PERSON_FACT.test(aRealPostSentence),
    "the pattern does not match the shape it is meant to catch",
  );
});
