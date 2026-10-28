/**
 * The three free judges — measure_draft, scrub_draft, compare_to_references.
 *
 * WHY THIS FILE EXISTS
 *
 * `compare_to_references` had NO test of any kind. It is deterministic, free, makes no model call
 * and is one of the three things a drafter runs before spending a gate run, and on 28 October it was
 * measured grading drafts against the default framework the brief had explicitly told it to
 * override: with ryanscarlin named in the brief, the draft that MISSED Carlin by four places was
 * told "that is the right neighbourhood" and the draft that HIT him first was told "this shape would
 * fight them". Nothing could have caught that, because nothing was looking.
 *
 * So the tests here are about the three ways these tools can be confidently wrong:
 *
 *   a false pass    — a verdict phrase ("within their range") over a number nowhere near its target
 *   two readers     — the same body measured two ways in two tools, neither saying which is which
 *   a number with   — "3 of 21 lines carry a finding" printed above findings on line 25 and line 36
 *   no base
 *
 * NO DATABASE. All three read the stored sentinel report, so every test here runs in a clone with no
 * credentials — which is the point of a free look.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { measureTools } from "./tools/measure.mjs";
import { scrubTools } from "./tools/scrub.mjs";
import { voiceTools, corpusBand, writerTarget, writerName } from "./tools/voice.mjs";
import { scan, RULES, HIGH_CONFIDENCE, EXEMPTIONS, EXEMPT, quotedRanges } from "./aitells.mjs";
import { tokens, words } from "../scripts/lib/prose.mjs";
import sentinels from "../data/josh/sentinels/latest.json" with { type: "json" };

const measure = measureTools.find((t) => t.name === "measure_draft");
const scrub = scrubTools.find((t) => t.name === "scrub_draft");
const compare = voiceTools.find((t) => t.name === "compare_to_references");

/**
 * A body with the shape of a real post of his: a scene, a number, a qualification, uneven lines.
 * Written here rather than taken from the bank, because nothing in this file may carry his material
 * or theirs.
 */
const BODY = [
  "The client asked for the number on a Tuesday.",
  "",
  "I did not have it. We had built the whole report around what the tool did, and nobody had asked "
    + "who owned the figure after we left.",
  "",
  "We rebuilt it that night. 915 of 1,933 sites had the booking system on them.",
  "",
  "It worked, though I still think we got lucky on the timing.",
].join("\n");

/* ── compare_to_references: the ranking ──────────────────────────────────────── */

test("compare_to_references ranks every measured writer, nearest first", async () => {
  const r = await compare.handler({ body: BODY });

  assert.equal(r.ranked.length, (sentinels.report ?? []).length, "a writer went missing");
  for (let i = 1; i < r.ranked.length; i++) {
    assert.ok(
      r.ranked[i].distance >= r.ranked[i - 1].distance,
      `the ranking is not sorted: ${JSON.stringify(r.ranked.map((x) => x.distance))}`,
    );
  }
  assert.equal(r.nearest.handle, r.ranked[0].handle, "nearest is not the top of the ranking");
  assert.ok(r.yours.sentence_words_sd >= 0, "the draft's own figures are missing");
});

test("no writer named means the scene/cut reading, and it says so", async () => {
  // Correct when nobody was asked for: the default IS the scene, and a draft drifting into the cut
  // mode by accident is worth a word. What it must not do is imply a target.
  const r = await compare.handler({ body: BODY });

  assert.equal(r.against_the_writer_asked_for, undefined, "a target appeared that nobody asked for");
  assert.match(r.reading, /No writer was named/);
  assert.match(r.reading, /scene|CUT mode/);
});

test("a writer named is reported as four gaps rather than a neighbourhood", async () => {
  /*
   * THE REGRESSION THIS FILE WAS WRITTEN FOR.
   *
   * ryanscarlin is a cut writer, so the old reading told every draft aimed at him that it was
   * fighting Josh's rules — for hitting exactly what the brief asked it to hit. The handler had no
   * parameter that could know a writer had been briefed.
   */
  const r = await compare.handler({ body: BODY, writer_handle: "ryanscarlin" });
  const against = r.against_the_writer_asked_for;

  assert.ok(against, "naming a writer produced no comparison against them");
  assert.equal(against.handle, "ryanscarlin");
  assert.equal(against.name, "Ryan Carlin");
  assert.equal(against.their_mode, "cut");

  const sd = against.dimensions.find((d) => d.what === "sentence_words_sd");
  assert.equal(sd.their_median, 14.9, "Carlin's measured sd is not the one being compared against");
  assert.equal(sd.gap, +(r.yours.sentence_words_sd - 14.9).toFixed(1), "the gap is not the gap");

  // The reading must name him and must NOT grade the draft against the default it was told to
  // override. "the right neighbourhood" is the phrase that delivered the false pass.
  assert.match(r.reading, /Ryan Carlin/);
  assert.doesNotMatch(r.reading, /the right neighbourhood/);
  assert.match(r.reading, /the measured shape wins/);
});

test("the Matt Barker caution survives both readings", async () => {
  // He is where Josh's rules came from, not a peer. A draft resembling him proves nothing, and his
  // cadence is the one most likely to leak — so the caution may not be lost to a refactor.
  const src = readFileSync(new URL("./tools/voice.mjs", import.meta.url), "utf8");
  assert.match(src, /is where Josh's rules came from rather than a peer/);

  const barker = await compare.handler({ body: BODY, writer_handle: "mattjbarker1" });
  assert.ok(barker.against_the_writer_asked_for, "naming Barker produced no comparison");
});

test("an unknown handle refuses, in all three judges", async () => {
  // Matching writerShapeBlock, which has refused since it was written. A silent fallback to the
  // default is the failure: it answers a question nobody asked and reads like a pass.
  for (const [name, call] of [
    ["compare_to_references", () => compare.handler({ body: BODY, writer_handle: "not-a-writer" })],
    ["measure_draft", () => measure.handler({ body: BODY, writer_handle: "not-a-writer" }, {})],
    ["scrub_draft", () =>
      scrub.handler({ body: BODY, include_library: false, writer_handle: "not-a-writer" }, {})],
  ]) {
    const r = await call();
    assert.ok(r.refused, `${name} answered for a writer it has never measured`);
    assert.equal(r.ranked, undefined, `${name} ranked anyway`);
    assert.equal(r.rhythm, undefined, `${name} measured anyway`);
  }
});

test("the display name never carries what the scrape put in it", async () => {
  /*
   * outboundphd's stored name is "🦾Eric Nowoslawski" — his own profile. It reaches a drafting
   * brief through .toUpperCase(), which is how "BUILD THIS ONE IN 🦾ERIC NOWOSLAWSKI'S SHAPE."
   * happened. writers.mjs carries the clean name, and it is the only source for a display name.
   */
  assert.equal(writerName("outboundphd"), "Eric Nowoslawski");

  const r = await compare.handler({ body: BODY, writer_handle: "outboundphd" });
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u, "an emoji reached the output");

  const src = readFileSync(new URL("./tools/voice.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(
    src,
    /const name = \(sentinels\.report/,
    "writerShapeBlock reads the display name off the scraped report again",
  );
});

/* ── The band that could not have caught it ──────────────────────────────────── */

test("widening the band from four writers to eight catches nothing", () => {
  /*
   * The measured argument for the parameter, asserted so nobody re-derives the wrong fix. The dead
   * `allBand` in measure.mjs was described as the missing piece; it was not. Every cut writer's
   * sd_median (10.9, 10.6, 13.9, 14.9) sits inside the scene four's 7.1–18.8, so the corpus band
   * and the scene band are the same band, and a draft at 9.8 aimed at Carlin's 14.9 reads "inside
   * the spread" on both.
   */
  const scene = new Set(["demandjen1", "juliacarter98", "outboundphd", "mattjbarker1"]);
  const sds = (handles) =>
    (sentinels.report ?? [])
      .filter((r) => !handles || handles.has(r.handle))
      .map((r) => r.sd_median)
      .sort((a, b) => a - b);

  const four = sds(scene);
  const eight = sds(null);
  assert.equal(four[0], eight[0], "the bands no longer coincide — re-read the comment above");
  assert.equal(four.at(-1), eight.at(-1), "the bands no longer coincide");

  const band = corpusBand("sd_median");
  assert.ok(9.8 > band.low && 9.8 < band.high, "9.8 is not inside the band it falsely passed on");
  assert.equal(writerTarget("ryanscarlin").sd, 14.9, "the only figure that catches it has moved");
});

test("measure_draft no longer computes a band it never reads", () => {
  // The assignment, not the word: the comment that explains why it is gone names it.
  const src = readFileSync(new URL("./tools/measure.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /const allBand\s*=/, "the dead band is back");
});

/* ── measure_draft with and without a writer ─────────────────────────────────── */

test("measure_draft reports the named writer BESIDE the corpus, never instead of it", async () => {
  // Its own description says it is a measurement and not a verdict, and the corpus range is the
  // honest context. The per-writer figure is an addition to it.
  const plain = await measure.handler({ body: BODY }, {});
  const aimed = await measure.handler({ body: BODY, writer_handle: "ryanscarlin" }, {});

  assert.ok(plain.rhythm.against_the_corpus, "the corpus view is missing");
  assert.equal(plain.rhythm.against_the_writer_asked_for, undefined);
  assert.match(plain.rhythm.note, /pass writer_handle/, "it does not say the parameter exists");

  assert.ok(aimed.rhythm.against_the_corpus, "naming a writer replaced the corpus view");
  assert.match(aimed.rhythm.against_the_writer_asked_for, /Ryan Carlin's median of 14\.9/);
  assert.match(aimed.shape.against_the_writer_asked_for.paragraphs, /Ryan Carlin's median of 21/);

  // The same numbers either way. A parameter that changes a measurement is not a parameter.
  assert.equal(aimed.rhythm.sentence_words_sd, plain.rhythm.sentence_words_sd);
  assert.equal(aimed.shape.above_fold_words, plain.shape.above_fold_words);
});

test("no range is described with a word that reads as a pass", async () => {
  // "within their range (7.1–18.8)" was a verdict in a measurement's clothes and it passed a draft
  // 5.1 from its target. Every range now carries the number and says a range is not a target.
  const r = await measure.handler({ body: BODY }, {});
  for (const text of [r.rhythm.against_the_corpus, r.length.against_the_corpus]) {
    assert.doesNotMatch(text, /^within their range/);
    assert.match(text, /not a target/);
    assert.match(text, /\d/, "a placement with no number in it");
  }
});

test("the field name no longer counts the writers, because it cannot be derived", async () => {
  const r = await measure.handler({ body: BODY }, {});
  assert.equal(r.length.against_all_seven, undefined, "the stale field name is back");
  assert.ok(r.length.against_the_corpus, "the corpus comparison went missing with it");
  assert.match(
    r.length.note,
    new RegExp(`All ${(sentinels.report ?? []).length} of their medians`),
    "the writer count in the prose does not match the measurements",
  );
});

test("measure_draft still works with no database and keeps its contractual fields", async () => {
  // guards.test.mjs asserts these too. Repeated here because the writer parameter is the change
  // most likely to have reached for a connection.
  const r = await measure.handler({ body: BODY }, {});
  assert.equal(typeof r.shape.paragraphs, "number");
  assert.equal(typeof r.shape.above_fold_words, "number");
  assert.match(r.shape.against_the_writers.paragraphs, /they run \d/);
});

/* ── The two fold numbers ────────────────────────────────────────────────────── */

test("both above-fold numbers say which one they are, and they are not merged", async () => {
  /*
   * Observed pairs in one run on 28 October: 14/28, 16/22, 19/72, 21/65 — the simulation and the
   * authored count, with nothing saying which the brief's "23 words above the fold" meant. It is
   * the authored one: writerShapeBlock builds the target from writerShapeTargets over the
   * above_fold_words column.
   *
   * shape.test.ts:140 asserts these two may never converge, so this asserts the LABELS and not the
   * values.
   */
  const r = await measure.handler({ body: BODY }, {});

  assert.match(r.fold.words_above_it_is, /SIMULATED/);
  assert.match(r.fold.words_above_it_is, /shape\.above_fold_words/);
  assert.match(r.shape.above_fold_words_is, /AUTHORED/);
  assert.match(r.shape.above_fold_words_is, /ninth gate check judges/);
  assert.ok(r.fold.not_the_same_as, "the never-merge note is gone");
  assert.notEqual(
    r.fold.words_above_it,
    undefined,
    "the simulation stopped being reported rather than being labelled",
  );
});

test("cuts_mid_sentence agrees with the preview printed beside it", async () => {
  /*
   * measureShape tests `rendered[FOLD_LINES - 1]`, and renderedLines pushes an empty string for a
   * blank gap, so that slot is often empty and the regex tests nothing: `cuts_mid_sentence: true`
   * appeared beside a preview ending in a full stop. The honest answer is read off the preview.
   *
   * Both directions, because a boolean that is always false is also wrong.
   */
  const ends = [
    "One line, and it ends properly.",
    "",
    "Then a second paragraph that goes on long enough to be cut somewhere after the fold, which is "
      + "what makes the field meaningful at all.",
    "",
    "And a third.",
  ].join("\n");
  const mid = "The client asked for the number on a Tuesday afternoon and I did not have it to hand "
    + "so I said I would come back, which is the kind of answer that costs a deal.";

  const a = await measure.handler({ body: ends }, {});
  const b = await measure.handler({ body: mid }, {});

  // A third case: the preview itself ends on a full stop, with more post after it. This is the one
  // that reported true beside a preview ending in "." and a newline.
  const clean = ["Late again.", "", "Sorry.", "", "The call had started without me and the client "
    + "had already asked the only question that mattered."].join("\n");
  const c = await measure.handler({ body: clean }, {});

  for (const [label, r] of [["clean break", a], ["mid sentence", b], ["blank third line", c]]) {
    const last = r.fold.what_he_would_see
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "";
    const looksCut = r.fold.rendered_lines > 3 && !/[.!?:"”]\s*$/.test(last);
    assert.equal(
      r.fold.cuts_mid_sentence,
      looksCut,
      `${label}: the boolean says ${r.fold.cuts_mid_sentence} over a preview ending "${last}"`,
    );
  }
  assert.equal(c.fold.cuts_mid_sentence, false, "the blank-third-line case still reports a cut");
  assert.match(a.fold.cuts_mid_sentence_is, /last non-empty line/);
});

/* ── One tokeniser ───────────────────────────────────────────────────────────── */

test("measure_draft and scrub_draft report the same sentence lengths", async () => {
  /*
   * Observed: measure said longest 24 where scrub said 23, on one body. measure_draft counted with
   * `words()` through measurePost and scrub_draft counted with `tokens()` through aitells — the
   * lexicon tokeniser, which requires a leading a-z and two characters, so it drops "I", "a" and
   * every number. The body below is built to separate them: it carries "I", "a", and two numerals.
   */
  const numeric = "I ran a check on 915 of 1,933 sites and 4 of them answered in under 2 seconds.";

  const m = await measure.handler({ body: numeric }, {});
  const s = await scrub.handler({ body: numeric, include_library: false }, {});

  assert.equal(
    m.rhythm.longest,
    s.measured.longest_sentence,
    "the two judges still count a sentence differently",
  );
  assert.equal(m.rhythm.shortest, s.measured.shortest_sentence);
  assert.match(s.measured.counted_with, /words\(\)/);

  // And the two counters really do disagree on this body, so the agreement above is a fix rather
  // than a coincidence: the lexicon tokeniser drops "I", "a" and all four numerals.
  assert.equal(scan(numeric).measured.longest_sentence, words(numeric), "the counter is not words()");
  assert.ok(
    tokens(numeric).length < words(numeric),
    "the fixture no longer separates the two counters",
  );
});

test("the stored medians and the scanner now use one counter", () => {
  // The sentinel medians in data/josh/sentinels/latest.json were produced by measurePost, which
  // counts with words(). If aitells ever goes back to tokens(), rubric()'s readings are comparing
  // against a corpus measured another way, and nothing in the output would say so.
  const src = readFileSync(new URL("./aitells.mjs", import.meta.url), "utf8");
  assert.match(src, /const wordCount = \(s\) => words\(s\)/, "the scanner is back on tokens()");

  const prose = readFileSync(new URL("../scripts/lib/prose.mjs", import.meta.url), "utf8");
  assert.match(prose, /export const words =/, "the shared counter is gone");
  const structure = readFileSync(
    new URL("../scripts/sentinel-structure.mjs", import.meta.url),
    "utf8",
  );
  assert.match(structure, /measurePost/, "the medians are no longer produced by measurePost");
});

/* ── One line base ───────────────────────────────────────────────────────────── */

test("no finding is reported on a line outside its own total", async () => {
  /*
   * "3 of 21 lines carry a finding", then findings on line 25 and line 36. The numerator counted
   * raw lines and the denominator counted non-blank ones. Both numbers are real; the ratio needs
   * one base and the reader needs the other, so both are emitted and both are labelled.
   */
  const spaced = [
    "Here is where it starts.",
    "",
    "",
    "It's not the tools. It's the people.",
    "",
    "",
    "",
    "We leveraged a robust, scalable, and comprehensive framework.",
    "",
    "",
    "Let that sink in.",
  ].join("\n");

  const r = await scrub.handler({ body: spaced, include_library: false }, {});

  assert.ok(r.findings.length > 0, "the fixture no longer trips anything — the test is not testing");
  for (const f of r.findings) {
    assert.ok(f.non_blank_line >= 1, "a finding has no non-blank line number");
    assert.ok(
      f.non_blank_line <= r.lines_total,
      `finding on non-blank line ${f.non_blank_line} of ${r.lines_total}`,
    );
    assert.ok(f.line <= r.measured.lines_raw, `finding on raw line ${f.line} of ${r.measured.lines_raw}`);
    assert.match(f.line_of, /raw lines/);
  }
  assert.ok(r.lines_touched <= r.lines_total, "more lines touched than exist");
  assert.match(r.line_base, /NON-BLANK/);
  assert.ok(r.measured.lines_raw > r.measured.lines_non_blank, "the fixture has no blank lines");
});

test("the re-voice ratio is computed on one base", async () => {
  /*
   * The visible half of the bug was the line numbers. The half that could throw away a good post is
   * this: the ratio decides between "fix these lines" and "write it again whole", and it was a
   * count of raw lines over a count of non-blank ones. Padding a post with blank lines moved it.
   */
  const dense = ["It's not the tools. It's the people.", "Let that sink in."].join("\n");
  const padded = ["It's not the tools. It's the people.", "", "", "", "Let that sink in."].join("\n");

  const a = await scrub.handler({ body: dense, include_library: false }, {});
  const b = await scrub.handler({ body: padded, include_library: false }, {});

  assert.equal(a.lines_total, b.lines_total, "blank lines changed the denominator");
  assert.equal(a.lines_touched, b.lines_touched, "blank lines changed the numerator");
  assert.equal(a.action, b.action, "blank lines alone changed the verdict");
});

/* ── A verdict that counts what it shows ─────────────────────────────────────── */

test("the verdict counts every finding it is about to print", async () => {
  /*
   * Observed: `ai_tells.total: 4` and one flag, then "1 thing(s) worth fixing before spending a
   * gate run." Only HIGH_CONFIDENCE rules reach `flags`, and the verdict counted `flags`.
   */
  const many = [
    "We leveraged a robust, scalable, and comprehensive framework.",
    "",
    "It's not the tools. It's the people — and that changed everything.",
    "",
    "Let me explain; the landscape is a tapestry.",
  ].join("\n");

  const r = await measure.handler({ body: many }, {});
  const others = r.ai_tells.total - r.ai_tells.in_flags_above;

  assert.ok(r.ai_tells.total > r.flags.length, "the fixture does not reproduce the undercount");
  assert.ok(others > 0, "the fixture leaves nothing outside the flags");

  // Both counts named, and no sum: the two overlap where a flag and a rule describe the same thing
  // (an em dash is a flag in its own right and rule 2C-1), so a total would overcount.
  const claimed = [...r.verdict.matchAll(/(\d+)/g)].map((x) => Number(x[1]));
  assert.ok(claimed.includes(r.flags.length), `the verdict "${r.verdict}" omits the flag count`);
  assert.ok(claimed.includes(others), `the verdict "${r.verdict}" omits the ${others} outside them`);
  assert.match(r.verdict, /need a reader/, "the remainder is not accounted for");
});

test("a clean draft is still called clean", async () => {
  // The opposite failure: a verdict that counts judgement calls as faults would tell a writer to
  // fix a post that is finished.
  const r = await measure.handler({ body: "Two sentences. That is all." }, {});
  assert.equal(r.ai_tells.total, 0);
  assert.match(r.verdict, /Nothing mechanical to fix/);
});

/* ── Standing: which findings a reader may leave alone ───────────────────────── */

test("every rule declares its standing, and every blocking rule is mechanical", () => {
  /*
   * scrub_draft's own rewrite_discipline says "when a flag is a judgement call, say so and leave
   * it" — and until 28 October no finding carried a field that could say so. The only
   * machine-readable thing was an imperative `fix` string, which is how "say the plain thing
   * instead" was applied to a client's verbatim words.
   *
   * And the invariant that matters: a rule that can REFUSE a draft may not rest on a heuristic.
   */
  for (const r of RULES) {
    assert.ok(
      r.standing === "mechanical" || r.standing === "judgement",
      `${r.id} declares standing "${r.standing}"`,
    );
  }
  for (const id of HIGH_CONFIDENCE) {
    const rule = RULES.find((r) => r.id === id);
    assert.equal(rule.standing, "mechanical", `${id} can refuse a draft on a judgement`);
  }
});

test("a finding carries the standing of its rule, and may only lower it", () => {
  const found = scan("We leveraged a robust, scalable, and comprehensive framework — once.").findings;
  assert.ok(found.length > 0, "the fixture trips nothing");
  for (const f of found) {
    const rule = RULES.find((r) => r.id === f.rule);
    assert.ok(f.standing, `${f.rule} finding carries no standing`);
    if (rule.standing === "judgement") {
      assert.equal(f.standing, "judgement", `${f.rule} raised its own standing`);
    }
  }
  const counts = scan("We leveraged a robust, scalable, and comprehensive framework — once.").counts;
  assert.equal(counts.mechanical + counts.judgement_calls, counts.total, "the split does not add up");
});

/* ── Quoted text is downgraded, never silenced ───────────────────────────────── */

test("a finding inside a quote keeps its rule and loses its instruction", () => {
  /*
   * "Say the plain thing instead" was handed to a drafter about a client's own sentence. The
   * construction really is there, so suppressing the finding would be a lie — and suppression would
   * open a laundering channel: wrap a generic paragraph in quotation marks and the scanner goes
   * quiet with nothing reporting that it had.
   */
  const quoted = 'She put it plainly: "It is not the tools, it is the people."';
  const bare = "She put it plainly: It is not the tools, it is the people.";

  const inQuote = scan(quoted).findings.filter((f) => f.rule === "2C-2");
  const outside = scan(bare).findings.filter((f) => f.rule === "2C-2");

  assert.equal(inQuote.length, outside.length, "the quote silenced the finding");
  assert.equal(inQuote[0].in_quote, true);
  assert.equal(inQuote[0].blocking, false, "a draft can be refused over somebody else's words");
  assert.match(inQuote[0].fix, /leave the words alone/);
  assert.ok(inQuote[0].rule_fix_if_not_quoted, "the rule's own fix was lost rather than replaced");
  assert.equal(outside[0].in_quote, undefined);
  assert.notEqual(outside[0].blocking, false);
});

test("one stray quotation mark marks nothing, and a quote cannot swallow the post", () => {
  // An odd number of marks must not silence everything after it, and past a share of the body the
  // "quote" IS the post. Both are reported rather than applied in silence.
  const stray = 'He said "it is not the tools, it is the people.';
  assert.deepEqual(quotedRanges(stray).ranges, [], "an unpaired mark opened a range to the end");
  assert.equal(scan(stray).quoted_text.lines.length, 0);
  assert.match(scan(stray).quoted_text.ignored, /odd number/);

  // A post's worth of lines, because the cap is a claim about a post: one quoted sentence inside a
  // one-line draft is 65% quoted and ordinary, and below three lines the cap does not apply.
  const whole = `"${[
    "It is not the tools, it is the people.",
    "",
    "We leveraged a robust, scalable, and comprehensive framework.",
    "",
    "Let that sink in.",
  ].join("\n")}"`;
  const r = scan(whole);
  assert.deepEqual(r.quoted_text.lines, [], "a quote covering the post was treated as a quote");
  assert.match(r.quoted_text.ignored, /cap/);
  assert.ok(r.findings.some((f) => !f.in_quote), "findings were downgraded past the cap");
});

test("the block-quote marker is left alone, because it is a bullet", () => {
  // `>` is in BULLET_MARKER on purpose. Treating it as a quote marker would break 2C-17 and
  // uses_list, which is the bug the shared marker was introduced to close.
  const src = readFileSync(new URL("./aitells.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /QUOTE_MARK = [^\n]*>/, "`>` has been added to the quote marks");
});

/* ── The exemption that did nothing and said nothing ─────────────────────────── */

test("each voice exemption says whether it is load-bearing today", () => {
  /*
   * Measured 28 October: not one of `potentially`, `might`, `guys` or `appreciate` appears in any
   * VOCAB list, and 2C-31 — the rule three of them cite — is a JUDGEMENT rule with no detector. So
   * the list suppressed nothing, and the test that guarded it asserted an empty findings array,
   * which is what you get whether the mechanism works or the terms were never reachable.
   *
   * The status is COMPUTED from the rules as they stand, so it cannot go stale: wire one of these
   * words into a VOCAB list and the entry turns itself active.
   */
  const standing = scan("anything").exemptions;
  assert.equal(standing.length, EXEMPTIONS.length);

  for (const e of standing) {
    assert.ok(e.rule, `${e.term} names no rule`);
    assert.match(e.evidence, /voiceprint/, `${e.term} cites no evidence`);
    assert.ok(["active", "reserved"].includes(e.status), `${e.term} has status "${e.status}"`);

    // The claim each status makes, checked against the rules rather than trusted.
    const bare = new Set();
    const probe = `We ${e.term} did it and the number held.`;
    const reaches = RULES.some((r) =>
      r.detect(probe, { exempt: bare }).some((hit) =>
        String(hit.matched ?? "").toLowerCase().includes(e.term.toLowerCase())
      )
    );
    assert.equal(
      e.status,
      reaches ? "active" : "reserved",
      `${e.term} is labelled ${e.status} and the rules say otherwise`,
    );
    if (e.status === "reserved") assert.match(e.means, /suppresses nothing/);
  }
});

test("the exemption mechanism itself fires, and the test can prove it", () => {
  /*
   * The positive control the old test could not run: scan() takes the exemption set, so the rules
   * can be run with a term UNPROTECTED and with it protected, and the difference is the mechanism.
   * Run against a word that IS in a VOCAB list, because the four recorded terms are not.
   */
  const body = "This is basically the whole problem.";
  assert.ok(
    scan(body).findings.some((f) => /basically/i.test(f.matched)),
    "the control word is no longer detected, so this test proves nothing",
  );
  assert.equal(
    scan(body, { exempt: new Set(["basically"]) }).findings.filter((f) => /basically/i.test(f.matched))
      .length,
    0,
    "an exempt term was flagged anyway — the exemption mechanism does nothing",
  );

  // And his own hedges still come back quiet, which is what the list is for.
  assert.equal(scan("We might get there. Potentially by October.").findings.length, 0);
  for (const term of EXEMPT) assert.ok(typeof term === "string" && term.length > 2);
});

/* ── sd reaches the drafter ──────────────────────────────────────────────────── */

test("the per-writer rhythm figure a drafter aims at is in the brief block", () => {
  /*
   * writerShapeBlock handed over opening, fold, paragraphs, close, lists and length — and not sd.
   * So the one rhythm figure a drafter aims at never reached them from the brief, while
   * measure_draft reported it against a range nobody chose. Asserted on the source and on the data,
   * because the block itself needs a database and this file deliberately needs none.
   */
  const src = readFileSync(new URL("./tools/voice.mjs", import.meta.url), "utf8");
  assert.match(src, /SENTENCE VARIATION:/, "sd is out of the shape block again");

  const target = writerTarget("mattjbarker1");
  assert.equal(target.sd, 9.3, "the figure the block would carry is not the measured one");
  const band = corpusBand("sd_median");
  assert.deepEqual({ low: band.low, high: band.high }, { low: 7.1, high: 18.8 });
});

test("a thin corpus refuses a per-writer target rather than degrading", () => {
  // measure_draft reads latest.json directly, which bypasses writerShapeBlock's refusal entirely.
  // It fires for none of the eight today — the thinnest is 232 of 250 — which is why it has to be
  // asserted rather than observed.
  for (const r of sentinels.report ?? []) {
    const t = writerTarget(r.handle);
    assert.ok(!t.refused, `${r.handle} is refused today: ${t.refused}`);
  }
  const src = readFileSync(new URL("./tools/voice.mjs", import.meta.url), "utf8");
  assert.match(src, /basis < 12 \|\| \(measured > 0 && basis \/ measured < 0\.6\)/);
});

/* ── Nothing of theirs travels ───────────────────────────────────────────────── */

test("none of the three judges emits a word of the writers' prose", async () => {
  // 8.3. These tools read medians and tallies only, and the stored report carries no sentences —
  // but a refactor that reached for reference_writer_posts.text would be invisible otherwise.
  const results = await Promise.all([
    measure.handler({ body: BODY, writer_handle: "mattjbarker1" }, {}),
    scrub.handler({ body: BODY, include_library: false, writer_handle: "mattjbarker1" }, {}),
    compare.handler({ body: BODY, writer_handle: "mattjbarker1" }),
  ]);
  for (const r of results) {
    const text = JSON.stringify(r);
    assert.doesNotMatch(text, /reference_writer_posts/);
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u);
  }
});
