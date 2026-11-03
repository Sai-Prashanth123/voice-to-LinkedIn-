/**
 * The fold against 120+ inputs, judged by invariants rather than by expected answers.
 *
 * WHY INVARIANTS AND NOT EXPECTED VALUES
 *
 * The model is uncalibrated, so "this cuts after 64 characters" is not a fact anybody can assert
 * yet — a test written that way would pin today's guess in place and fail the day it is measured.
 * What CAN be asserted is what must be true of any correct renderer at any parameters:
 *
 *   1. It never throws, on any input.
 *   2. No rendered line exceeds the surface's capacity. (The overflow-wrap invariant.)
 *   3. Nothing is lost, duplicated or reordered: strip whitespace from the rendered lines and from
 *      the input, and the two must be identical. This is the strongest one and it catches the most.
 *   4. `shown` is never longer than `lines`, and `truncated` agrees with `all.length > lines`.
 *   5. No NaN, undefined or "[object Object]" reaches anything a person reads.
 *
 * These hold whatever the constants turn out to be, so calibration cannot break them.
 *
 * WHAT IS BEING HUNTED
 *
 * Text this wrapper was never written for. It splits on /\s+/, which is a whole-language assumption:
 * Chinese, Japanese and Thai do not put spaces between words, so an entire paragraph arrives as one
 * "word". It counts graphemes, which is right for emoji and wrong-ish for the astral-plane
 * pseudo-bold LinkedIn users paste constantly. And it was built for prose, while real LinkedIn posts
 * are full of bullet glyphs, arrows, hashtags and 200-character URLs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  foldFor,
  previewBlock,
  SURFACES,
  widthIn,
} from "../supabase/functions/_shared/fold-preview.ts";
import {
  displayWidth,
  FULL_WIDTH,
  isFullWidth,
  SANS_WIDTHS,
} from "../supabase/functions/_shared/fold-metrics.ts";

/* ── The corpus ───────────────────────────────────────────────────────────── */

const P = "I spent four years telling founders to shorten their cold emails and then measured a hundred and fifty three of them.";
const rep = (s, n) => Array.from({ length: n }, () => s).join(" ");

/** Every case: a name and the text. Named so a failure says which shape of input broke it. */
const CASES = Object.entries({
  // ── Degenerate ──
  "empty string": "",
  "one space": " ",
  "only spaces": "        ",
  "one newline": "\n",
  "three newlines": "\n\n\n",
  "ten newlines": "\n".repeat(10),
  "one tab": "\t",
  "tabs only": "\t\t\t",
  "single char": "a",
  "single wide char": "W",
  "single narrow char": "i",
  "one word": "hello",
  "two words": "hello there",
  "only punctuation": "... --- !!! ???",
  "only a full stop": ".",
  "only an em dash": "—",

  // ── Whitespace structure ──
  "leading blank lines": "\n\n" + P,
  "trailing blank lines": P + "\n\n",
  "blanks both ends": "\n\n" + P + "\n\n",
  "single break": "One line.\nTwo line.",
  "double break": "One line.\n\nTwo line.",
  "ten consecutive breaks": "One line." + "\n".repeat(10) + "Two line.",
  "CRLF endings": "One line.\r\n\r\nTwo line.",
  "bare CR endings": "One line.\r\rTwo line.",
  "mixed CRLF and LF": "One.\r\nTwo.\n\nThree.\r\n",
  "trailing spaces per line": "One line.   \n   \nTwo line.   ",
  "tabs as word separators": "one\ttwo\tthree\tfour\tfive\tsix\tseven\teight\tnine\tten",
  "one word per line, ten lines": Array.from({ length: 10 }, (_, i) => "word" + i).join("\n"),
  "one word per line with gaps": Array.from({ length: 8 }, (_, i) => "word" + i).join("\n\n"),
  "non-breaking spaces": "one two three four five six seven eight",
  "line separator U+2028": "one two three",

  // ── Length boundaries, against mobile capacity 42 ──
  "exactly 41 chars one word": "a".repeat(41),
  "exactly 42 chars one word": "a".repeat(42),
  "exactly 43 chars one word": "a".repeat(43),
  "41 chars of words": rep("abcd", 8).slice(0, 41),
  "42 chars of words": rep("abcd", 9).slice(0, 42),
  "43 chars of words": rep("abcd", 9).slice(0, 43),
  "126 chars, three full lines": "a".repeat(126),
  "127 chars, one over": "a".repeat(127),

  // ── Long unbroken runs ──
  "60-char word": "x".repeat(60),
  "200-char word": "x".repeat(200),
  "1000-char word": "x".repeat(1000),
  "a long URL": "Read it here: https://www.example.com/a/very/long/path/that/keeps/going/and/going?utm_source=linkedin&utm_medium=social&utm_campaign=q4",
  "two long URLs": "https://example.com/" + "a".repeat(80) + " and https://example.com/" + "b".repeat(80),
  "long word then prose": "unreproducibleoverconfidentmisattributionofcausality and then the rest of it.",
  "prose then long word": "The problem was " + "y".repeat(90),
  "hyphenated monster": Array.from({ length: 12 }, () => "part").join("-"),

  // ── Emoji and graphemes ──
  "one emoji": "\u{1F600}",
  "emoji in prose": "The review went badly \u{1F62C} and that was that.",
  "ZWJ family": "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466} is one grapheme",
  "flag": "\u{1F1EC}\u{1F1E7} is one grapheme",
  "skin tone": "\u{1F44D}\u{1F3FD} is one grapheme",
  "keycap": "1️⃣ is one grapheme",
  "emoji wall": "\u{1F600}".repeat(60),
  "combining diacritics": "é" .repeat(50),
  "zero-width space": "one​two​three​four",
  "zero-width joiner alone": "a‍b‍c",
  "soft hyphen": "super­cali­fragi­listic­expiali­docious",
  "variation selector": "✔️ done",

  // ── Scripts without spaces, which /\s+/ cannot see ──
  "Chinese, no spaces": "我们测量了一百五十三封邮件的回复率结果让人意外因为短的邮件并没有更好",
  "Japanese, no spaces": "私たちは百五十三通のメールの返信率を測定しました結果は意外でした",
  // Thai is a NARROW script that happens to have no spaces, so unlike CJK it is correctly one
  // unit per character. The first fixture was simply too short to need a second line.
  "Thai, no spaces": "เราวัดอัตราการตอบกลับของอีเมล".repeat(5),
  "Korean with spaces": "우리는 메일 회신을 최소 153개 충 측정했습니다",
  "Arabic RTL": "قمنا بقياس معدل الرد على مائة وثلاث وخمسين رسالة",
  "Hebrew RTL": "מדדנו את אחוז התשובה של מאה וחמישים ושלוש הודעות",
  "mixed LTR and RTL": "We measured معدل الرد across 153 emails.",
  "Cyrillic": "Мы измерили показатель ответов на сто пятьдесят три письма",
  "Greek": "Μετρήσαμε το ποσοστό απάντησης σε εκατόν πενήντα τρεις",

  // ── What LinkedIn posts are actually full of ──
  "pseudo-bold unicode": "\u{1D5D7}\u{1D5F2}\u{1D5EE}\u{1D5F9} \u{1D5F1}\u{1D5FC}\u{1D600}\u{1D5F2}: the thing nobody checks before sending.",
  "pseudo-italic unicode": "\u{1D608}\u{1D636}\u{1D634}\u{1D62A} we measured it and the answer surprised us.",
  "bullet glyphs": "What we found:\n\n• 340 duplicates\n• three vendors\n• one owner",
  "arrow separators": "List quality → reply rate → pipeline → revenue. Every step compounds.",
  "tick and cross": "✅ signal-based lists\n❌ firmographic-only lists",
  "numbered list": "Three things:\n\n1. The list was wrong\n2. The copy was fine\n3. Nobody checked",
  "hashtags": "We measured it across 153 sends. #outbound #gtm #sales #b2bsales #coldemail",
  "at mentions": "Thanks @someone and @someone-else for pushing back on this last week.",
  "ALL CAPS opener": "WE MOVED WHOLE WORKFLOWS OFF A TOOL NOBODY OWNED AND NOBODY NOTICED FOR A MONTH",
  "SHOUTY mixed": "This is the IMPORTANT bit: the LIST was wrong, not the COPY.",
  "em dash heavy": "The list — not the copy — was the problem — and nobody had checked — for a year.",
  "smart quotes": "“We already have a tool for that”, they said. It had shut down eight months earlier.",
  "currency and digits": "11 meetings from 94 sends, a 3.4x lift, $12,400 saved, 0% of it the copy.",
  "percentages": "60% wrong ICP, 40% right, 0% of anyone's attention on the difference.",
  "decimal heavy": "3.4x, 1.07x, 0.53x, 11.2%, 94.6%, and a median of 1.00 exactly.",
  "parenthetical": "The reply rate (which nobody tracked) was fine (it was the list).",
  "colon setup": "The best cold email we sent last quarter broke every rule we teach:",
  "question opener": "What if the list, and not the copy, is what decides your reply rate?",
  "one-word paragraphs": "Wrong.\n\nList.\n\nNot.\n\nCopy.",
  "two-word paragraphs": "It was wrong.\n\nThe list was.\n\nNot the copy.",

  // ── Real-shaped posts ──
  "short post": "Nobody on my team could tell me which emails got replies.\n\nThat was the whole problem.",
  "medium post": "Nobody on my team could tell me which of our emails got replies.\n\nWe had the data. It was in three places, none of which talked to each other.\n\nSo I pulled it once, properly. The best performer was the one we almost cut.",
  "long post": rep(P, 6),
  "LinkedIn max length": "a".repeat(2990) + " end.",
  "over max length": "word ".repeat(700),
  "huge input": "word ".repeat(3000),
  "many paragraphs": Array.from({ length: 30 }, (_, i) => "Paragraph number " + i + " says a thing.").join("\n\n"),
  "many short lines": Array.from({ length: 40 }, (_, i) => "Line " + i).join("\n"),

  // ── Added after the first run, which found two real faults and two bad assertions of mine ──
  "Chinese, long": "我们测量了一百五十三封邮件".repeat(8),
  "Japanese, long": "私たちは返信率を測定しました".repeat(8),
  "Korean, long": "우리는 메일 회신을 측정했습니다 ".repeat(6),
  "fullwidth Latin": "Ｈｅｌｌｏ Ｗｏｒｌｄ ".repeat(6),
  "CJK mixed with Latin": "We measured 回复率 across 153 emails and the result 让人意外 entirely.",
  "emoji then prose": "\u{1F600}".repeat(20) + " and then some ordinary words follow on behind it.",
  "prose then emoji wall": P + " " + "\u{1F680}".repeat(30),
  "every bullet glyph": "• ▪ ▸ → ⇒ ✔ ✅ ❌ ⚠ ❗ ⭐",
  "box drawing in the post": "┌─┐ a reader pasted a table └─┘ into a post",
  "mathematical bold whole line": "\u{1D5D9}\u{1D5F6}\u{1D5FF}\u{1D600}\u{1D601} \u{1D5F9}\u{1D5F6}\u{1D5FB}\u{1D5F2} \u{1D5F6}\u{1D5FD} \u{1D5F0}\u{1D5EE}\u{1D5FF}\u{1D5FF}\u{1D5F6}\u{1D5F2}\u{1D5FC}",
  "mixed scripts one line": "Reply 回复 رد תשובה Ответ απάντηση",
  "newline inside a long word": "x".repeat(50) + "\n" + "y".repeat(50),
  "blank line between long words": "x".repeat(50) + "\n\n" + "y".repeat(50),
  "single char per line, 20 lines": Array.from({ length: 20 }, (_, i) => String(i % 10)).join("\n"),
  "alternating blank and text": Array.from({ length: 12 }, (_, i) => (i % 2 ? "" : "Line " + i)).join("\n"),
});

/* ── The invariants ───────────────────────────────────────────────────────── */

const SEG = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    return null;
  }
})();

/**
 * Display columns, segmented by GRAPHEME.
 *
 * `[...line]` splits by code point, and a ZWJ family is one grapheme and seven code points — so a
 * code-point ruler charges it four emoji instead of one and reports a box 28 columns wide that is
 * correctly 22. This measures what the renderer measures. It was the fourth wrong assertion I made
 * about this box, which is itself worth recording: text width is unusually easy to measure wrongly,
 * and every wrong way looks plausible.
 */
const cols = (line) => {
  const parts = SEG ? [...SEG.segment(line)].map((g) => g.segment) : [...line];
  return parts.reduce((w, g) => w + displayWidth(g), 0);
};

const strip = (s) => s.replace(/\s/g, "");

function invariants(name, surface, text) {
  let r;
  // 1. It never throws.
  try {
    r = foldFor(text, surface);
  } catch (err) {
    assert.fail(`${name} / ${surface.name}: threw ${err?.message ?? err}`);
  }

  // 2. No rendered line exceeds capacity. Blank lines are exempt; they are gaps, not text.
  for (const [i, line] of r.all.entries()) {
    if (line === "") continue;
    const w = widthIn(line, surface.widths);
    assert.ok(
      w <= surface.capacity + 1e-9,
      `${name} / ${surface.name}: line ${i} is ${w.toFixed(1)} wide against a capacity of ${surface.capacity}: ${JSON.stringify(line.slice(0, 60))}`,
    );
  }

  // 3. NOTHING IS LOST, DUPLICATED OR REORDERED. The strongest invariant here: a renderer may
  //    insert and remove whitespace freely, and may not touch anything else.
  assert.equal(
    strip(r.all.join("")),
    strip(text),
    `${name} / ${surface.name}: the rendered lines are not the input's characters`,
  );

  // 4. The visible slice is consistent with itself.
  assert.ok(r.shown.length <= surface.lines, `${name}: ${r.shown.length} shown against ${surface.lines} lines`);
  assert.equal(
    r.truncated,
    r.all.length > surface.lines,
    `${name} / ${surface.name}: truncated=${r.truncated} with ${r.all.length} lines of ${surface.lines}`,
  );
  // `shown` must be a prefix of `all` — with a see-more cost it may shorten the last line, and
  // nothing else.
  for (let i = 0; i < r.shown.length - 1; i++) {
    assert.equal(r.shown[i], r.all[i], `${name} / ${surface.name}: shown line ${i} is not all[${i}]`);
  }

  // 5. Nothing a person reads contains a programming artefact.
  const text_ = [...r.all, ...r.shown].join(" ");
  for (const bad of ["undefined", "NaN", "[object Object]", "null"]) {
    assert.ok(!text_.includes(bad), `${name} / ${surface.name}: "${bad}" reached the rendered text`);
  }
  return r;
}

/* ── Run them across several parameter sets ───────────────────────────────── */

/*
 * The surfaces as they stand, plus three the calibration could plausibly produce. If an invariant
 * only holds at capacity 42 it is not an invariant, and the day the fit lands would be the day it
 * broke — with the preview still rendering something, which is the failure mode that matters.
 */
const PARAM_SETS = [
  { label: "mobile as shipped", surface: SURFACES.mobile },
  { label: "desktop as shipped", surface: SURFACES.desktop },
  { label: "half blank cost", surface: { ...SURFACES.mobile, blankCost: 0.5 } },
  { label: "with see-more cost", surface: { ...SURFACES.mobile, seeMoreCost: 11, breaksMidWord: true } },
  { label: "proportional widths", surface: { ...SURFACES.mobile, widths: SANS_WIDTHS, capacity: 30 } },
  { label: "tiny surface", surface: { ...SURFACES.mobile, capacity: 10, lines: 2 } },
];

for (const { label, surface } of PARAM_SETS) {
  test(`${CASES.length} inputs hold every invariant — ${label}`, () => {
    let checked = 0;
    for (const [name, text] of CASES) {
      invariants(name, surface, text);
      checked++;
    }
    assert.equal(checked, CASES.length);
    assert.ok(checked >= 100, `only ${checked} cases — this suite is meant to be over a hundred`);
  });
}

test("previewBlock survives every input and never runs wide", () => {
  for (const [name, text] of CASES) {
    let out;
    try {
      out = previewBlock(text, [SURFACES.mobile, SURFACES.desktop], { title: name, hook: text.slice(0, 40) });
    } catch (err) {
      assert.fail(`${name}: previewBlock threw ${err?.message ?? err}`);
    }
    assert.equal(typeof out, "string");
    assert.ok(out.includes("MOBILE") && out.includes("DESKTOP"), `${name}: a surface is missing`);
    /*
     * Measured in COLUMNS, not in UTF-16 units. The first version used `line.length`, which counts
     * an emoji as two units, and reported a 216-wide line for a box that was drawn correctly. It
     * did find a real fault alongside the bad assertion — the box padded by grapheme count rather
     * than by display columns, so an emoji line's right border landed nowhere near the other
     * box's — and both were fixed.
     */
    /*
     * THE PROPERTY THAT MATTERS IS ALIGNMENT, not an absolute width.
     *
     * A wall of emoji is legitimately twice as wide in columns as it is in model units, so capping
     * the total was asserting the wrong thing. The box really was broken, though: it was framed in
     * model units and filled in display columns, so with 42 emoji the frame was drawn 42 wide
     * around content 84 wide and the right border fell off the end of the line. Every framed line
     * of a box must be the same number of columns as its own border.
     */
    /*
     * Alignment is asserted on a SINGLE surface, in the test below, not here. Side by side a row
     * holds two boxes where both columns have a line and one box where only the taller does, and
     * trailing whitespace is trimmed — so rows legitimately differ in width. Comparing them was my
     * third wrong assertion about this box in a row.
     */
    assert.ok(
      out.split("\n").every((l) => cols(l) <= 400),
      `${name}: a preview line ran past 400 columns`,
    );
    for (const bad of ["undefined", "NaN", "[object Object]"]) {
      assert.ok(!out.includes(bad), `${name}: "${bad}" reached the preview`);
    }
  }
});

/* ── The specific things worth naming ────────────────────────────────────── */

test("a space-less script still wraps instead of occupying one line", () => {
  /*
   * The wrapper splits on /\s+/, which assumes a language that puts spaces between words. Chinese,
   * Japanese and Thai do not, so an entire paragraph arrives as a single "word". Before overflow
   * wrapping existed this measured as ONE rendered line, whatever its length — so a Chinese post
   * of any size reported as fitting above the fold.
   */
  for (const name of ["Chinese, long", "Japanese, long", "Thai, no spaces"]) {
    const text = CASES.find(([n]) => n === name)[1];
    const { all } = foldFor(text, SURFACES.mobile);
    assert.ok(all.length > 1, `${name} wrapped to ${all.length} line(s) at capacity ${SURFACES.mobile.capacity}`);
    assert.equal(strip(all.join("")), strip(text), `${name} lost characters`);
  }
});

test("pseudo-bold unicode is counted by grapheme, not by UTF-16 unit", () => {
  /*
   * LinkedIn has no bold, so people paste mathematical-alphanumeric characters instead. Each is one
   * grapheme and TWO UTF-16 units, so `.length` double-counts them and a pseudo-bold hook would
   * measure as twice its real width.
   */
  const bold = "\u{1D5D7}\u{1D5F2}\u{1D5EE}\u{1D5F9}"; // 4 glyphs, 8 UTF-16 units
  assert.equal(bold.length, 8, "the fixture is not astral-plane after all");
  assert.equal(widthIn(bold), 4, "pseudo-bold is being counted by UTF-16 unit");
});

test("a grapheme cluster is never split down the middle", () => {
  /*
   * The hard-wrap walks graphemes rather than characters, so a family emoji or a flag cannot be cut
   * in half. Splitting one produces a different glyph or a replacement box — visible, and ugly.
   */
  const text = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}".repeat(12);
  const { all } = foldFor(text, { ...SURFACES.mobile, capacity: 7 });
  for (const line of all) {
    assert.ok(!line.includes("�"), "a replacement character appeared");
    // A split ZWJ sequence leaves a line beginning or ending on a joiner.
    assert.ok(!line.startsWith("‍"), `a line starts on a zero-width joiner: ${JSON.stringify(line)}`);
    assert.ok(!line.endsWith("‍"), `a line ends on a zero-width joiner: ${JSON.stringify(line)}`);
  }
  assert.equal(strip(all.join("")), strip(text));
});

test("an empty post is not reported as truncated", () => {
  for (const text of ["", " ", "\n", "\n\n\n", "\t"]) {
    const r = foldFor(text, SURFACES.mobile);
    assert.equal(r.all.length, 0, `${JSON.stringify(text)} produced ${r.all.length} line(s)`);
    assert.equal(r.truncated, false, `${JSON.stringify(text)} reported as truncated`);
    assert.equal(r.shown.length, 0);
  }
});

test("a huge input does not hang or blow up", () => {
  const huge = "word ".repeat(20000);
  const started = Date.now();
  const r = foldFor(huge, SURFACES.mobile);
  const ms = Date.now() - started;
  assert.ok(r.truncated);
  assert.ok(ms < 4000, `100,000 characters took ${ms}ms`);
  assert.equal(strip(r.all.join("")), strip(huge));
});

test("a CJK character costs two glyphs, not one", () => {
  /*
   * THE FAULT THIS SUITE FOUND. Nothing in SANS_WIDTHS matched a CJK character, so the fallback of
   * 1.0 applied and a Chinese post measured as fitting twice as much above the fold as it does.
   * It matters most in exactly these scripts, because they have no spaces to wrap on: every line
   * is a hard wrap at the capacity, so the capacity is the only thing deciding the answer.
   */
  assert.ok(isFullWidth("我"), "a Han character is not recognised as full width");
  assert.ok(isFullWidth("あ"), "Hiragana is not recognised as full width");
  assert.ok(isFullWidth("가"), "a Hangul syllable is not recognised as full width");
  assert.ok(!isFullWidth("a"), "a Latin letter is being charged double");

  assert.equal(widthIn("我们", SANS_WIDTHS), FULL_WIDTH * 2);

  // And it reaches the fold: the same character count must wrap to more lines than Latin does.
  const cjk = "我们测量了回复率".repeat(6);
  const latin = "a".repeat(cjk.length);
  const surface = { ...SURFACES.mobile, widths: SANS_WIDTHS };
  assert.ok(
    foldFor(cjk, surface).all.length > foldFor(latin, surface).all.length,
    "CJK and Latin of the same length wrapped to the same number of lines",
  );
});

test("one box's border lines up with its own content, whatever is in the post", () => {
  /*
   * THE FAULT, isolated to a single surface so the property is unambiguous.
   *
   * The frame was sized in MODEL units and filled in DISPLAY columns. For a full-width glyph those
   * differ by two, so 42 emoji produced a frame 42 wide around content 84 wide and the right
   * border fell off the end of the line. Checked across every input, including the emoji walls and
   * the CJK that provoked it.
   */
  for (const [name, text] of CASES) {
    const out = previewBlock(text, [SURFACES.mobile], { title: name });
    const framed = out.split("\n").filter((l) => /^[┌│└]/.test(l));
    if (framed.length < 2) continue;
    const border = cols(framed[0]);
    for (const line of framed) {
      assert.equal(
        cols(line),
        border,
        `${name}: a box line is ${cols(line)} columns against a border of ${border}`,
      );
    }
  }
});
