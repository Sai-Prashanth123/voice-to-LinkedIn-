/**
 * The preview that finally reaches a session, and the fold bug found while building it.
 *
 * TWO THINGS ARE UNDER TEST AND THEY ARE DIFFERENT KINDS OF THING
 *
 * The first is a transport fact: `preview_post` must return a STRING. `server.mjs:90` is
 * `typeof value === "string" ? value : JSON.stringify(value, null, 2)`, so a handler returning an
 * object has its newlines encoded as the two characters backslash-n inside a quoted field. The
 * fold preview has existed on `measure_draft` since 26 October and arrived that way every time,
 * which is why nobody had ever actually seen it. A test that only checked the preview's CONTENT
 * would have passed throughout. So this asserts the shape that reaches the client, through the real
 * `wrap()`.
 *
 * The second is arithmetic: a fractional blank cost. `shape.ts` does
 * `for (let i = 0; i < blankCost; i++)`, which pushes one line for 1.5 and none for 0.5, while
 * `calibrate-fold.mjs` searches over exactly `[0, 0.5, 1, 1.5, 2]`. The fitter could recommend a
 * value the renderer floors and then report an error it was not delivering — a calibration lying
 * about its own fit. `fold-preview.ts` accumulates the fraction instead, and that is tested by
 * behaviour rather than by reading the loop.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { wrap } from "./server.mjs";
import { measureTools } from "./tools/measure.mjs";
import {
  foldFor,
  previewBlock,
  SURFACES,
  UNFITTED_BASIS,
  widthIn,
} from "../supabase/functions/_shared/fold-preview.ts";

const tool = measureTools.find((t) => t.name === "preview_post");

const POST = [
  "I spent four years telling founders to shorten their cold emails.",
  "",
  "Then I measured a hundred and fifty three of them. The short ones did not do better.",
].join("\n");

/* ── The transport fact ───────────────────────────────────────────────────── */

test("preview_post exists and returns a string, not an object", async () => {
  assert.ok(tool, "preview_post is not registered");
  const out = await tool.handler({ text: POST });
  assert.equal(typeof out, "string", `returned a ${typeof out}, which server.mjs would JSON-encode`);
});

test("it arrives through wrap() as real lines, not as escaped newlines", async () => {
  /*
   * The whole point, asserted through the actual wrapper rather than by reading it. If this ever
   * returns an object again, `text` becomes a quoted JSON blob and the preview silently stops being
   * readable while every content assertion still passes.
   */
  const handler = wrap(tool, {}, undefined);
  const res = await handler({ text: POST });
  const text = res.content[0].text;

  assert.equal(res.content[0].type, "text");
  assert.ok(text.includes("\n"), "no real newlines survived the transport");
  assert.ok(!text.includes("\\n"), "newlines were escaped, so this renders as one long line");
  assert.ok(!text.trimStart().startsWith("{"), "it came through as a JSON object");
  // And the box actually drew.
  assert.match(text, /┌─+┐/, "no box was drawn");
  assert.match(text, /MOBILE/);
  assert.match(text, /DESKTOP/);
});

test("the preview always says what it was fitted against", async () => {
  /*
   * The repo's own rule: a check must report its basis, because "0 found across 114 drafts" and
   * "nothing to compare against" are different answers. A preview that looks precise and is not is
   * worse than one that admits it — three constants presented as if measured is exactly why no fold
   * number in this system has ever been trusted.
   */
  const out = await tool.handler({ text: POST });
  assert.ok(out.includes("NOT FITTED"), "the preview does not disclose that it is uncalibrated");
  assert.ok(out.includes(UNFITTED_BASIS.slice(0, 40)));
});

test("the tool description tells a session not to quote the numbers yet", () => {
  assert.match(tool.config.description, /NOT FITTED/);
  assert.match(tool.config.description, /do not quote/i);
  // And explains why it is not measure_draft's block.
  assert.match(tool.config.description, /JSON-encoded|arrives as lines|plain text/i);
});

/* ── The hook question, which is the only one worth acting on while unfitted ─ */

test("it answers whether the first sentence lands above the cut", async () => {
  const fits = await tool.handler({
    text: POST,
    hook: "I spent four years telling founders to shorten their cold emails.",
  });
  assert.match(fits, /lands above the cut/);

  /*
   * A long opener of ordinary WORDS. The first version of this test used a single 200-character
   * run of "A", which exposed a different fault instead — see the overflow-wrap test below — and
   * told me the whole post fit above the fold.
   */
  const longOpener =
    "I spent four years telling founders to shorten their cold emails and then measured a " +
    "hundred and fifty three of them to find out whether the short ones actually did any better " +
    "than the long ones, which is the sort of thing you only do once.";
  const misses = await tool.handler({ text: longOpener, hook: longOpener });
  assert.match(misses, /DOES NOT FIT/);
});

test("a word wider than the line wraps, instead of occupying one line", () => {
  /*
   * THE FAULT A BAD TEST FOUND. shape.ts says "a word longer than the line still occupies one", so
   * a 200-character unbroken string measures as ONE rendered line and a post built around a pasted
   * URL reports as fitting comfortably above the fold. A browser hard-wraps it; that is what
   * overflow-wrap does, and it is why a long URL destroys a hook.
   *
   * Probe 4 decides whether LinkedIn breaks mid-word like this or lets it overflow — that is the
   * part this cannot settle on its own.
   */
  const giant = "A".repeat(200);
  const { all } = foldFor(giant, SURFACES.mobile);
  assert.ok(
    all.length >= 4,
    `a 200-character word wrapped to ${all.length} line(s) at capacity ${SURFACES.mobile.capacity}`,
  );
  // Every line respects the container.
  for (const line of all) {
    assert.ok(
      widthIn(line) <= SURFACES.mobile.capacity,
      `a rendered line is wider than the surface: ${widthIn(line)}`,
    );
  }
  // And nothing is lost or duplicated in the wrapping.
  assert.equal(all.join(""), giant);
});

test("nothing in the preview is too wide to read in a terminal", async () => {
  /*
   * Both halves. The boxes must respect the surface that drew them — a 200-character word must not
   * produce a 200-character box — and the preview's own caption must wrap, which it did not: the
   * basis paragraph came out as a single 247-character line.
   */
  const out = await tool.handler({ text: "A".repeat(200) });
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 140, `a preview line is ${line.length} characters wide: ${line.slice(0, 60)}…`);
  }
  // The box specifically, bounded by mobile capacity plus desktop capacity plus frames and gutter.
  const boxLines = out.split("\n").filter((l) => l.includes("│") || l.includes("┌"));
  const bound = Math.ceil(SURFACES.mobile.capacity + SURFACES.desktop.capacity) + 16;
  for (const line of boxLines) {
    assert.ok(line.length <= bound, `a box line is ${line.length} wide, bound is ${bound}`);
  }
});

test("a post short enough to fit entirely says nothing is cut", async () => {
  const out = await tool.handler({ text: "Three words here." });
  assert.match(out, /nothing is cut/);
  // And draws no see-more marker, because there is no link on an untruncated post.
  assert.ok(!out.includes("see more"), "it drew a see more link on a post that is not truncated");
});

/* ── The fractional blank cost: the bug this found ────────────────────────── */

const twoParas = "First paragraph here.\n\nSecond paragraph here.";

test("a blank cost of 1 spends one visible line on the gap", () => {
  const s = { ...SURFACES.mobile, blankCost: 1 };
  const { all } = foldFor(twoParas, s);
  assert.deepEqual(all, ["First paragraph here.", "", "Second paragraph here."]);
});

test("a blank cost of 0 spends none", () => {
  const s = { ...SURFACES.mobile, blankCost: 0 };
  const { all } = foldFor(twoParas, s);
  assert.deepEqual(all, ["First paragraph here.", "Second paragraph here."]);
});

test("a blank cost of 2 spends two", () => {
  const s = { ...SURFACES.mobile, blankCost: 2 };
  const { all } = foldFor(twoParas, s);
  assert.deepEqual(all, ["First paragraph here.", "", "", "Second paragraph here."]);
});

test("a FRACTIONAL blank cost is not silently floored", () => {
  /*
   * THE BUG. shape.ts floors 0.5 to zero and 1.5 to one, so calibrate-fold.mjs could fit a value
   * the renderer never delivers and then report that fit as the error. 0.5 means every other gap
   * costs a line, which is a real behaviour when paragraph spacing is under one line height.
   */
  const three = "One.\n\nTwo.\n\nThree.";
  const half = foldFor(three, { ...SURFACES.mobile, blankCost: 0.5 });
  const gaps = half.all.filter((l) => l === "").length;
  assert.equal(gaps, 1, `0.5 across two gaps should cost one line, got ${gaps}`);

  // And it is not simply rounding up either: one gap at 0.5 costs nothing yet.
  const one = foldFor(twoParas, { ...SURFACES.mobile, blankCost: 0.5 });
  assert.equal(one.all.filter((l) => l === "").length, 0, "0.5 on a single gap already cost a line");

  // 1.5 across two gaps is three lines, not two.
  const oneAndAHalf = foldFor(three, { ...SURFACES.mobile, blankCost: 1.5 });
  assert.equal(oneAndAHalf.all.filter((l) => l === "").length, 3);
});

test("consecutive blank lines still collapse to one gap", () => {
  // renderedLines assumes a reader sees one gap however many newlines produced it. Kept, so the
  // two models do not disagree about something neither has measured.
  const a = foldFor("One.\n\nTwo.", SURFACES.mobile);
  const b = foldFor("One.\n\n\n\nTwo.", SURFACES.mobile);
  assert.deepEqual(a.all, b.all);
});

/* ── The width model, which is what makes letter-exactness possible at all ── */

test("with a flat table, width is a grapheme count — the old behaviour exactly", () => {
  assert.equal(widthIn("WWWWW"), 5);
  assert.equal(widthIn("iiiii"), 5);
  // An emoji is one grapheme, not two UTF-16 units.
  assert.equal(widthIn("😬"), 1);
});

test("with a fitted table, W is wider than i — which no single charsPerLine can express", () => {
  /*
   * This is the fault the probes are designed to confirm. LinkedIn wraps by pixel width in a
   * proportional font; `WWWWW` and `iiiii` are five characters each and nowhere near the same
   * width. The point of this test is that the MODEL can now represent that at all. Whether these
   * particular weights are right is what calibration decides.
   */
  const widths = { W: 2.2, i: 0.45, default: 1 };
  assert.ok(widthIn("WWWWW", widths) > widthIn("iiiii", widths) * 4);

  const wide = foldFor("WWWWW ".repeat(20).trim(), { ...SURFACES.mobile, widths });
  const thin = foldFor("iiiii ".repeat(20).trim(), { ...SURFACES.mobile, widths });
  assert.ok(
    wide.all.length > thin.all.length,
    `same character count wrapped to the same number of lines (${wide.all.length} vs ${thin.all.length}), so the width table is not being read`,
  );
});

/* ── The see-more link, which the old model ignored entirely ───────────────── */

test("the see more link takes room from the last visible line", () => {
  const long = "word ".repeat(60).trim();
  const without = foldFor(long, { ...SURFACES.mobile, seeMoreCost: 0 });
  const with_ = foldFor(long, { ...SURFACES.mobile, seeMoreCost: 12 });

  assert.ok(with_.truncated && without.truncated);
  const lastWithout = without.shown.at(-1).length;
  const lastWith = with_.shown.at(-1).length;
  assert.ok(lastWith < lastWithout, `the link cost nothing: ${lastWith} vs ${lastWithout}`);
});

test("it can report a cut that falls inside a word", () => {
  /*
   * What LinkedIn does and the old model could never show: a clamp mid-word. Only reported when
   * the surface says the renderer clips rather than backing up to a space.
   */
  const text = "antidisestablishmentarianism " + "word ".repeat(30).trim();
  const clipped = foldFor(text, {
    ...SURFACES.mobile,
    seeMoreCost: 12,
    breaksMidWord: true,
    lines: 1,
  });
  assert.ok(clipped.cutInsideWord, "no mid-word cut was reported");
  assert.ok(clipped.cutInsideWord.dropped.length > 0);

  // And with word-boundary wrapping it backs up instead.
  const backedUp = foldFor(text, {
    ...SURFACES.mobile,
    seeMoreCost: 12,
    breaksMidWord: false,
    lines: 1,
  });
  assert.ok(!backedUp.shown.at(-1).endsWith("-"), "it left a dangling partial word");
});

test("an unfitted surface spends nothing on the link, so nothing is invented", () => {
  // seeMoreCost 0 is the carried-over behaviour. Setting it to a guess would trade a known error
  // for an unknown one; the probes fit it.
  assert.equal(SURFACES.mobile.seeMoreCost, 0);
  assert.equal(SURFACES.desktop.seeMoreCost, 0);
  assert.equal(SURFACES.mobile.breaksMidWord, false);
});

/* ── Nothing the gate judges may move ─────────────────────────────────────── */

test("this file does not touch the measurement the gate judges", async () => {
  /*
   * `above_fold_words` feeds the ninth check, the writers' stored medians and
   * compare_to_references. shape.ts is emphatic that the authored count and the rendered one must
   * never be averaged or compared. This module draws; it must not become a second measurer.
   */
  const { measureShape } = await import("../supabase/functions/_shared/shape.ts");
  const before = measureShape(POST);
  await tool.handler({ text: POST });
  const after = measureShape(POST);
  assert.deepEqual(after, before, "drawing a preview changed what measureShape reports");
});
