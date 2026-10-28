import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { carveOutsFor, measureTools } from "./tools/measure.mjs";
import { EXEMPTIONS } from "./aitells.mjs";
import { FUNCTION_WORDS } from "../scripts/lib/stopwords.mjs";
import voiceprint from "../data/josh/law/voiceprint.json" with { type: "json" };

const measure = measureTools.find((t) => t.name === "measure_draft");
// The empty context guards.test.mjs hands it: this tool makes no database call and no network call.
const run = (body) => measure.handler({ body }, {});

/**
 * THE LEXICON FLAGGED A PHRASE JOSH PERSONALLY AUTHORISED — 28 October.
 *
 * Measured before the fix, on a draft containing "Here's my system:":
 *
 *   lexicon.peer_words_used: ["who", "last", "here's"]
 *   flags: ["Uses who, last, here's — words the reference writers use far more than he does.
 *            One is nothing; several together is a draft drifting toward their voice."]
 *   verdict: "1 thing(s) worth fixing before spending a gate run."
 *
 * Three faults in one line. Two of the three words are function words, which clear the peer list's
 * raw-rate test on the speech/writing register gap alone. The third is a carve-out Josh added to
 * `banned_phrases` himself on 13 October — "I actually like ... my very simple system" — and the
 * regex engine already honoured it, because rule 2C-22 matches `here's (the thing|what|why|how|
 * something)` and never reaches `here's my system`. And the flag printed "one is nothing" and then
 * fired on one.
 */

test("here's my system: is not a complaint, because Josh asked for it", async () => {
  const body = [
    "A founder asked me on Thursday why her team had stopped reading the weekly report.",
    "",
    "Nobody had cancelled it. They had just stopped opening it, and no one said so for five weeks.",
    "",
    "Here's my system:",
    "",
    "1. Ask who read it last.",
    "2. Ask what they did differently after.",
    "3. If nobody answers the second one, kill the report.",
    "",
    "She killed it that afternoon.",
  ].join("\n");

  const r = await run(body);
  assert.deepEqual(r.lexicon.peer_words_used, [], "the peer list still has something to say here");
  assert.ok(
    !r.flags.some((f) => /peer list|drifting toward their voice/.test(f)),
    `a peer-word flag survived: ${r.flags.join(" | ")}`,
  );
  const carved = r.lexicon.carve_outs_applied ?? [];
  assert.equal(carved.length, 1, "the carve-out is not reported");
  assert.equal(carved[0].term, "here's");
  assert.match(carved[0].matched, /Here's my system:/);
  // The half this tool cannot check, said out loud rather than implied — the same discipline
  // will_refuse already holds to about what it decided and what it only guessed.
  assert.match(carved[0].not_checked_here, /scrub_draft/);
});

test("the carve-out does not cover the forms that stayed banned", () => {
  // His own line: the "Here's why.", "Here's what happened.", "Here's the thing:" and "Here's what
  // I learned:" forms stay banned. So a body using both keeps its flag, and 2C-22 catches the
  // second separately. The carve-out applies only when EVERY occurrence is the allowed form.
  assert.equal(carveOutsFor("Here's my system:\n\n1. One.\n2. Two.").length, 1);
  assert.equal(
    carveOutsFor("Here's my system:\n\n1. One.\n\nHere's the thing: it worked.").length,
    0,
    "a banned use of the term was carved out along with the allowed one",
  );
  assert.equal(carveOutsFor("Here's what I learned.").length, 0);
  // Narrower than the library on purpose: he described it as "a colon lead-in to a numbered list"
  // and then "before any list". No colon is not what he described, and narrow is the safe side.
  assert.equal(carveOutsFor("Here's my system for this.").length, 0);
});

test("function words are filtered and the filter says which ones", async () => {
  const r = await run("Every account by the same target before the day it ran down. Who ran it?");
  for (const w of ["who", "by", "every", "same", "down", "before", "your", "last"]) {
    assert.ok(!r.lexicon.peer_words_used.includes(w), `${w} is still evidence of drift`);
  }
  const dropped = r.lexicon.peer_list_filtered_at_read_time;
  assert.ok(dropped, "the filter removed words and did not say so");
  assert.ok(dropped.dropped.includes("who"));
  // The stored artefact is NOT regenerated — it cannot be, the 59-post corpus is gone — so this
  // must say that the artefact still carries them and get_voice_brief still shows them.
  assert.match(dropped.the_artefact_still_carries_them, /get_voice_brief/);
});

test("the flag needs a density, which is the sentence it has always printed", async () => {
  // One peer word is nothing. A draft steeped in their vocabulary is the thing the list exists to
  // catch, and both sides of the comparison are measured: this draft's rate against the writers'
  // own rate over the same words, which build-voiceprint already stored and nothing read.
  const one = await run(
    "The report had one reader left. She told me so on the call, and then she cancelled it.",
  );
  assert.ok(
    !one.flags.some((f) => /peer list/.test(f)),
    "a single peer word still fires the flag",
  );

  const saturated = await run(
    "Our sales pipeline was the problem. Pipeline coverage looked fine. The revenue number did " +
      "not. Ads spend was flat, content was flat, and the account team had no target for the day. " +
      "Sales said marketing, marketing said sales.",
  );
  const flag = saturated.flags.find((f) => /peer list/.test(f));
  assert.ok(flag, "a draft at their saturation is not flagged at all");
  assert.match(flag, /per 1k against the writers' own/, "the flag does not show both rates");
  assert.match(saturated.lexicon.peer_words_note, /Flagged above/);
});

test("the signature half produces a sentence, never a flag and never a threshold", async () => {
  // (d) — it was returned as a bare empty array, so the only lexicon output that said anything was
  // the negative one, on a system whose first rule is "could anyone else have written this?".
  const none = await run(
    "The report had one reader left. She told me so on the call, and then she cancelled it.",
  );
  assert.deepEqual(none.lexicon.signature_terms_used, []);
  assert.match(none.lexicon.signature_terms_note, /NONE of his \d+ measured signature terms/);
  assert.match(none.lexicon.signature_terms_note, /no target/);
  // No flag and no refusal: the terms are measured from SPEECH and most do not belong in a post,
  // so a threshold would make a drafter pad with "Melbourne" to clear a count.
  assert.ok(!none.flags.some((f) => /signature/i.test(f)));
  assert.ok(!/signature/i.test(none.verdict));

  const some = await run("We potentially recut the Melbourne enrollment list and it held.");
  assert.ok(some.lexicon.signature_terms_used.length > 0);
  assert.match(some.lexicon.signature_terms_note, /Reported, never scored/);
});

test("the four voice exemptions survive the filter", () => {
  /*
   * aitells.mjs's EXEMPTIONS cite `potentially`, `might`, `guys` and `appreciate` as signature
   * terms, with an `evidence` string naming the voiceprint that aitells.test.mjs asserts. The
   * filter must not reach them: it applies to `peer_words_he_avoids` only, and by construction a
   * word Josh uses MORE than the writers cannot be on that list — but "by construction" is the
   * kind of reasoning that stops being true after a rebuild, so it is asserted.
   */
  const signature = new Set(
    (voiceprint.contrast?.signature_terms ?? []).map((e) => String(e.word).toLowerCase()),
  );
  for (const e of EXEMPTIONS) {
    assert.ok(signature.has(e.term), `${e.term} is no longer a measured signature term`);
    assert.match(e.evidence, /voiceprint\.contrast\.signature_terms/);
  }
});

test("one stopword list, read by the builder and by the reader", () => {
  // Two copies would let the artefact and the tool disagree about which words are function words
  // while both reported "the measurement". build-voiceprint.mjs applies it BEFORE its slice(0, 25),
  // because get_voice_brief takes 25 off the stored list and a filter applied after that hands
  // Josh however many of the 25 survived, with nothing saying one was dropped.
  const builder = readFileSync(new URL("../scripts/build-voiceprint.mjs", import.meta.url), "utf8");
  const reader = readFileSync(new URL("./tools/measure.mjs", import.meta.url), "utf8");
  for (const [label, src] of [["build-voiceprint.mjs", builder], ["measure.mjs", reader]]) {
    assert.match(src, /stopwords\.mjs"/, `${label} does not read the shared list`);
    assert.doesNotMatch(src, /^const FUNCTION_WORDS = new Set/m, `${label} declares a second list`);
  }
  assert.ok(FUNCTION_WORDS.has("who") && FUNCTION_WORDS.has("before"));
  // A word he could be talking ABOUT stays — the same membership test SPEECH_ONLY states.
  for (const topic of ["sales", "pipeline", "revenue", "consulting", "melbourne"]) {
    assert.ok(!FUNCTION_WORDS.has(topic), `${topic} is a topic, not a function word`);
  }
  // The filter runs before the slice, so the stored list is 25 words that passed.
  const avoidedLoop = builder.slice(builder.indexOf("const avoided = []"));
  assert.ok(
    avoidedLoop.indexOf("FUNCTION_WORDS.has(word)") < avoidedLoop.indexOf("avoided.slice(0, 25)"),
    "the filter now runs after the slice, so Josh gets a short list instead of a filtered one",
  );
});

test("the carve-out is gated on the live library, by the tool that reads it", async () => {
  /*
   * prefile.mjs's rule, with the sign flipped. There, "a refusal that outlived the rule it came
   * from would be the system inventing a standard of its own". Here, a CARVE-OUT that outlived its
   * line would keep ignoring something Josh had re-banned, and nothing would say so.
   *
   * measure_draft cannot check it — no database call, by design. scrub_draft loads the library, so
   * it is the one that confirms the line is still in `banned_phrases`, the same device as
   * RULE_PRESENT. Driven here with a stub, so this costs no network call either.
   */
  const { scrubTools } = await import("./tools/scrub.mjs");
  const scrub = scrubTools.find((t) => t.name === "scrub_draft");
  const db = (banned) => ({
    select: async () => [{ key: "banned_phrases", title: "Banned phrases", body: banned, sort_order: 80 }],
  });
  const body = "A founder asked me why nobody read the report.\n\nHere's my system:\n\n1. Ask.\n2. Cut.";

  const live = 'Allowed, Josh 13 Oct 2026: "here\'s my very simple system:" (or "here\'s my '
    + 'system:") as a colon lead-in to a numbered list.';
  const present = await scrub.handler({ body }, { db: db(live) });
  assert.equal(present.lexicon_carve_outs?.[0]?.still_in_the_library, true);
  assert.match(present.lexicon_carve_outs[0].means, /right to suppress/);

  const withdrawn = await scrub.handler({ body }, { db: db("# Banned phrases\n\nNo em dashes.") });
  assert.equal(withdrawn.lexicon_carve_outs?.[0]?.still_in_the_library, false);
  assert.match(withdrawn.lexicon_carve_outs[0].means, /GONE from the live banned_phrases/);
  assert.match(withdrawn.lexicon_carve_outs[0].means, /LEXICON_CARVE_OUTS/);
});
