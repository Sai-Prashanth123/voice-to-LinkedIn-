/**
 * Relative advance widths for a UI sans-serif, so the fold can wrap by width instead of by count.
 *
 * WHY THIS FILE EXISTS
 *
 * `FOLD_CHARS_PER_LINE = 42` says every character is one unit wide. LinkedIn renders in a
 * proportional font, where `WWWWW` is roughly three times the width of `iiiii` — so no value of
 * that constant can be right for both, and the published cut-off figures disagree (140, 210, 265,
 * "120–210") precisely because each is a character count standing in for a pixel measurement,
 * fitted to whatever text that person happened to test.
 *
 * WHAT THESE NUMBERS ARE, AND ARE NOT
 *
 * They are **ratios**, normalised so an average lowercase glyph is 1.0. They are NOT LinkedIn's
 * font: LinkedIn's feed CSS, font stack and container widths are published nowhere, and this
 * session has no browser to measure a live render with. What they encode is the SHAPE of a
 * proportional font — that `i` is about half a normal glyph, `W` about seventy percent wider than
 * one, a space narrower than either — which is a property every UI sans shares to within a few
 * percent.
 *
 * So the ratios are approximate and the SCALE is fitted. `capacity` in `fold-fit.json` absorbs the
 * font size and the container width together, which is the only part that has to be measured.
 * Getting the ratios slightly wrong costs a character at the margin; getting the model wrong in
 * kind — which is what a flat table does — costs five.
 *
 * THE FIT CHOOSES BETWEEN THIS AND A FLAT TABLE.
 *
 * `scripts/calibrate-fold.mjs` scores both and keeps whichever predicts the observations better.
 * If the `W` and `i` probes come back cutting at the same character count, LinkedIn really does
 * count characters, the flat table wins, and this file goes unused — which is a result worth being
 * able to reach rather than something to assume away.
 *
 * Import-free on purpose, like `shape.ts` and `library-spans.ts` beside it: type-stripped by Node,
 * imported by Deno, and carried into an edge bundle by the import graph.
 */

/** A relative advance width per character. 1.0 is an average lowercase glyph. */
export type WidthTable = Record<string, number> & { default?: number };

/*
 * Grouped by width rather than listed per character, because the groups are the thing that is
 * actually known and a per-character list invites false precision.
 *
 * Ratios relative to an average lowercase glyph (`n`, `o`, `e` — the ones that set the rhythm of a
 * line). Derived from the advance widths a Helvetica/Roboto-class UI sans uses, divided through by
 * that average.
 */
const GROUPS: Array<[number, string]> = [
  // The thin ones. `i` and `l` are the reason a line of them fits nearly twice as much text.
  [0.46, "ijl.,;:!|'`’"],
  [0.52, " "],
  [0.58, "ftr()[]{}/\\\"“”-‑"],
  [0.72, "I"],
  // The ordinary lowercase run. This is the 1.0 the rest is measured against.
  [1.0, "abcdeghknopqsuvxyz"],
  [1.04, "0123456789$"],
  // Wide lowercase.
  [1.5, "mw"],
  // Uppercase sits between a lowercase glyph and a wide one.
  [1.24, "ABCDEFGHJKLNOPQRSTUVXYZ"],
  [1.68, "MW"],
  // An em dash is about two lowercase glyphs; an en dash about one and a half.
  [1.45, "–"],
  [1.95, "—"],
];

/**
 * The table, built once.
 *
 * `default` is 1.0 rather than something cautious: an unlisted character is far more likely to be
 * an ordinary letter from another script than an unusually wide glyph, and a wrong default should
 * fail towards the common case.
 */
export const SANS_WIDTHS: WidthTable = (() => {
  const t: Record<string, number> = { default: 1.0 };
  for (const [width, chars] of GROUPS) {
    for (const ch of chars) t[ch] = width;
  }
  return t as WidthTable;
})();

/**
 * An emoji occupies roughly two lowercase glyphs and is matched by shape rather than by listing
 * every codepoint — `widthIn` already segments by grapheme, so a flag or a skin-tone sequence
 * arrives here as one entry and should cost one emoji's width, not six characters'.
 */
export const EMOJI_WIDTH = 2.0;

/** True for a grapheme that should be charged `EMOJI_WIDTH`. */
export function isEmoji(grapheme: string): boolean {
  // Extended_Pictographic covers the pictographs without dragging in digits or letters, which a
  // naive \p{Emoji} does: "1" and "#" are Emoji by that property and are plainly not emoji here.
  try {
    return /\p{Extended_Pictographic}/u.test(grapheme);
  } catch {
    return false;
  }
}

/**
 * A full-width character — Chinese, Japanese, Korean, and the full-width Latin forms — costs about
 * two ordinary glyphs.
 *
 * FOUND BY AN EDGE-CASE SUITE, and it was wrong by a factor of two. Nothing in the table above
 * matches a CJK character, so `default: 1` applied: a Chinese post measured as fitting twice as
 * much above the fold as it actually does. The same held for Japanese and Korean.
 *
 * It matters beyond correctness-for-its-own-sake. These are the scripts where the space-based word
 * wrap has nothing to break on, so every line is a hard wrap at exactly the capacity — which makes
 * the capacity the only thing deciding the answer, and it was half what it should be.
 */
export const FULL_WIDTH = 2.0;

/**
 * True for a grapheme drawn at double width.
 *
 * The ranges are the East Asian Wide and Fullwidth blocks, written out rather than taken from
 * `\p{East_Asian_Width=W}` because that property escape is not supported everywhere this module
 * runs and a silent `false` would put the bug straight back.
 */
export function isFullWidth(grapheme: string): boolean {
  const cp = grapheme.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi, CJK symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana, Bopomofo, Hangul compat, CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // pictographs, also caught by isEmoji
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Extension B and beyond
  );
}

/**
 * Columns a grapheme occupies in a monospaced grid — for drawing the ASCII preview box, not for
 * the fold model.
 *
 * Also found by the edge-case suite: the box padded by GRAPHEME COUNT, so a line of emoji drew a
 * frame 42 units wide around content occupying 84 columns and the right border landed nowhere near
 * the others. Zero-width marks pad nothing; wide characters pad two.
 */
export function displayWidth(grapheme: string): number {
  const cp = grapheme.codePointAt(0);
  if (cp === undefined) return 0;
  // Combining marks and zero-width controls take no column of their own.
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff || cp === 0x00ad) return 0;
  if (cp >= 0x0300 && cp <= 0x036f) return 0;
  if (isEmoji(grapheme) || isFullWidth(grapheme)) return 2;
  return 1;
}

/**
 * The two candidate models the calibration scores against each other.
 *
 * Named rather than passed as booleans so the report can say which one won in words, and so a
 * future third model is an entry here instead of another flag.
 */
export const MODELS: Record<string, WidthTable | null> = {
  /** Every character one unit. Exactly what shape.ts does today. */
  flat: null,
  /** A proportional font's ratios, with the scale left to `capacity`. */
  proportional: SANS_WIDTHS,
};
