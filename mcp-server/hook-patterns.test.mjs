/**
 * The hook patterns artefact, and the fields a skill was written to read.
 *
 * Three times in two days a value has shipped that nothing reads: `opening_words` stored on 1,839
 * posts and reaching no brief, `his_words_chars` named in a rubric and absent from every prompt,
 * and `shape.opening_words` referenced by the josh-hook-lab skill while `measure_draft` returned
 * `undefined` for it. Each was found by RUNNING the thing, never by reading it.
 *
 * So these assert the wiring rather than the numbers: if a figure the skills depend on stops being
 * emitted, this fails before Josh finds out.
 */

import test from "node:test";
import assert from "node:assert/strict";
import hooks from "../data/josh/hooks/latest.json" with { type: "json" };
import { measureShape } from "../supabase/functions/_shared/shape.ts";

test("the artefact carries both corpora, and says which is which", () => {
  const by = hooks.basis.by_source;
  assert.ok(by.josh_eight.posts > 1000, "the eight he chose are the bulk of it");
  assert.ok(by.content_agent.posts > 500, "and the second corpus is really there");
  assert.equal(by.josh_eight.accounts, 9, "his roster is the nine he has supplied");

  // The distinction that stops the standard changing without him.
  assert.match(hooks.basis.whose_they_are.josh_eight, /THIS IS THE STANDARD/);
  assert.match(hooks.basis.whose_they_are.content_agent, /never to be reported as them/);
  assert.ok(hooks.basis.source_b_caveat, "source B says what it is not good for");
});

test("almost every content-agent post carries engagement, and his own corpus still cannot be ranked", () => {
  /*
   * This asymmetry is the reason the second corpus is worth having.
   *
   * THE THRESHOLD MOVED ON 5 NOVEMBER, AND WHAT MOVED IT IS WORTH READING.
   *
   * It was "< 0.2 — seven of eight writers have no reaction data at all". Adding Tim Scheuer broke
   * that, because his scrape arrived with a reaction count on all 248 posts where most of the
   * others have none: his corpus went from 220/1,671 to 468/1,919, which is 0.244.
   *
   * The claim the test exists to make is unchanged and still true — three quarters of his corpus
   * carries no engagement figure, so a ranking over it cannot be an engagement ranking. But the
   * bound is now stated as the thing that actually matters, because a bare ratio hid the hazard:
   * the coverage is CONCENTRATED. Barker is 51 of 51 and Tim 6 of 6 in the artefact's window,
   * against 1 of 128, 0 of 203, 0 of 198 and so on for the rest. So a ranking built on his own
   * corpus would not be a thin ranking of nine writers; it would be a ranking of two, wearing the
   * nine's name. That was true of Barker alone before and is easier to miss now there are two.
   */
  const by = hooks.basis.by_source;
  assert.ok(
    by.content_agent.with_reactions / by.content_agent.posts > 0.95,
    "the second corpus can be ranked",
  );
  const covered = by.josh_eight.with_reactions / by.josh_eight.posts;
  assert.ok(
    covered < 0.5,
    `most of his corpus must still lack engagement data for the asymmetry to hold; got ${covered.toFixed(3)}`,
  );
  assert.ok(
    covered > 0,
    "and some of it carries reactions — a zero here means the loader stopped storing them",
  );
});

test("the fold measurement exists and adds up", () => {
  const f = hooks.all_writers.fold;
  assert.ok(f, "the headline measurement is present");
  const u = f.lines_the_hook_uses;
  const total = u.one + u.two + u.three + u.four_or_more;
  assert.ok(Math.abs(total - 100) < 0.5, `the distribution sums to 100, got ${total}`);
  assert.ok(Math.abs(f.leaves_room_pct + f.fills_or_overflows_pct - 100) < 0.5);
  // The number the whole thing was built to produce.
  assert.ok(f.fills_or_overflows_pct > 20, "a real share of openings eat the whole fold");
});

test("the engagement reading refuses to be mistaken for a measurement", () => {
  const r = hooks.all_writers.reactions_by_fold_use;
  if (!r) return; // no engagement in the corpus is a legitimate state
  assert.match(r.how_much_to_trust_it, /SUGGESTIVE, NOT A MEASUREMENT/);
  assert.match(r.how_much_to_trust_it, /PROVISIONAL/);
  assert.ok(r.authors >= 2, "normalised across more than one author");
});

test("the bait filter reports what it excluded, not just that it ran", () => {
  const x = hooks.excluded_by_his_rules;
  assert.ok(x.count > 0, "his rules exclude something");
  assert.ok(x.of > x.count, "and keep much more than they exclude");
  assert.ok(Array.isArray(x.by_reason) && x.by_reason.length, "broken down by reason");
  // It has to be HIS standard, not a second opinion invented here.
  assert.match(x.what_judged_it, /aitells/);
  assert.match(x.why_a_filter, /No bait/);
});

test("no post text reached the artefact", () => {
  /*
   * Clause 8.3, asserted rather than trusted. The build has its own leak guard; this is the
   * second reader, because the artefact ships to the hosted connector and a sentence in it would
   * be a reference writer's words inside every brief.
   */
  const json = JSON.stringify(hooks);
  // A real opening from the corpus, long enough that ordinary English would not collide.
  assert.ok(
    !json.includes("booking widget on their site"),
    "a phrase from a real post is in the artefact",
  );
  for (const s of hooks.shapes) {
    assert.equal(typeof s.shape, "string");
    assert.equal(typeof s.posts, "number");
    assert.ok(!("example" in s) && !("line" in s), "shapes carry no sentence");
  }
});

test("every field josh-hook-lab reads is actually emitted", () => {
  // The skill names these. A skill pointing at a field that does not exist is the defect this
  // file was written after.
  for (const s of hooks.shapes) {
    assert.ok(s.line_one_words, `${s.shape} has a word band`);
    assert.ok(s.fold, `${s.shape} has a fold reading`);
    assert.ok(s.first_figure_arrives, `${s.shape} says where the figure lands`);
  }
  assert.ok(hooks.all_writers.line_one_words.median > 0);
});

test("measure_draft's own first-line count agrees with the corpus definition", () => {
  // Two readers of one thing: the artefact counts opening_words from prose.mjs, measure_draft
  // from measureShape. If they ever disagree, a drafter aims at one and is judged by the other.
  const line = "We grew one vertical's new deals 110% in a month.";
  assert.equal(measureShape(line).opening_words, 10);
  assert.equal(measureShape(line + "\n\nAnd more below.").opening_words, 10,
    "the first line is the first line, whatever follows it");
});
