/**
 * The fold, drawn as a reader sees it, for showing in a session.
 *
 * WHY THIS IS SEPARATE FROM shape.ts
 *
 * `shape.ts` MEASURES — it answers "how many lines does this draw" for the gate, the writers'
 * medians and `compare_to_references`, and `above_fold_words` has a fixed meaning that several
 * recorded verdicts rest on. Nothing here may change any of that.
 *
 * This DRAWS. It is the half that was missing: `measure_draft` has carried
 * `fold.what_he_would_see` since 26 October, and it arrives in a session as
 * `"line one\nline two"` — escaped, on one line — because `server.mjs` JSON-stringifies any handler
 * that returns an object. So the preview existed and nobody could see it, which is this
 * repository's defect wearing yet another hat: a value nothing renders.
 *
 * THREE THINGS THE OLD MODEL DOES NOT EXPRESS, and this one has parameters for
 *
 * 1. `seeMoreCost` — "…see more" is drawn INLINE on the last visible line and takes horizontal
 *    space from it. The old model takes three whole lines and ignores the link entirely, so it
 *    always over-reports what fits.
 *
 * 2. `widthOf` — a per-character relative advance, so `WWWWW` can be wider than `iiiii`. LinkedIn
 *    wraps by pixel width in a proportional font; a single characters-per-line scalar cannot be
 *    right for both, whatever value it takes. The default table is flat (every character 1.0),
 *    which reproduces the old behaviour exactly — so this file changes nothing until a fitted table
 *    is supplied.
 *
 * 3. `breaksMidWord` — whether the renderer clips mid-word at the clamp point or backs up to a word
 *    boundary. CSS line-clamp does the former; the old model can only do the latter.
 *
 * ALL THREE ARE UNFITTED UNTIL `data/josh/fold-observations.json` EXISTS. Every surface carries its
 * own `basis` string and `previewBlock` prints it, because a preview that looks precise and is not
 * is worse than one that admits it: the whole reason the fold numbers were never trusted is that
 * three constants were presented as if measured.
 */

import {
  displayWidth,
  EMOJI_WIDTH,
  FULL_WIDTH,
  isEmoji,
  isFullWidth,
  type WidthTable,
} from "./fold-metrics.ts";

export type { WidthTable };

export interface Surface {
  /** What to call it when showing him. */
  name: string;
  /** Line capacity, in the units of `widths`. With a flat table this is characters per line. */
  capacity: number;
  /** Visible lines before the cut. */
  lines: number;
  /** How many rendered lines a blank source line costs. May be fractional — see foldLines(). */
  blankCost: number;
  /** Capacity consumed on the last visible line by the inline "…see more" link. */
  seeMoreCost: number;
  /** True if the renderer clips mid-word rather than backing up to a word boundary. */
  breaksMidWord: boolean;
  /** Per-character relative widths. Omit for a flat table, which is the old behaviour. */
  widths?: WidthTable;
  /** What these numbers were fitted against. Printed with the preview. Never omit. */
  basis: string;
}

/*
 * THE NUMBERS COME FROM A FILE, NOT FROM HERE.
 *
 * `data/josh/fold-fit.json` holds them, `scripts/calibrate-fold.mjs` writes them, and this reads
 * them. Three reasons it is data rather than constants:
 *
 *   - Calibrating becomes a paste and one command instead of an edit to a shared module that nine
 *     things import. The ask has been open on Josh since 26 October; it should not also require a
 *     code change the day it arrives.
 *   - The BASIS travels with the numbers. shape.ts puts its caveat in a comment, which is why the
 *     42 has been quoted as though measured for a week — a comment cannot reach a tool result.
 *   - `fitted: false` is a fact a reader can act on. A preview that says what it does not know is
 *     worth more than one that looks precise.
 *
 * A STATIC IMPORT, because an edge bundle carries the import graph and nothing else. build-info.mjs
 * learned that the expensive way: a JSON file read with readFileSync never arrived, and the
 * connector reported "unknown" on the first deploy after it shipped. Which is also why the file
 * must exist unfitted rather than being created by the first calibration.
 */
import fit from "../../../data/josh/fold-fit.json" with { type: "json" };

export const FOLD_FIT = fit;

/** True once a real reading has been fitted. Until then every number here is inherited guesswork. */
export const IS_FITTED: boolean = fit.fitted === true;

function surfaceFrom(key: "mobile" | "desktop"): Surface {
  const s = fit.surfaces[key];
  return {
    name: s.name,
    capacity: s.capacity,
    lines: s.lines,
    blankCost: s.blankCost,
    seeMoreCost: s.seeMoreCost,
    breaksMidWord: s.breaksMidWord,
    widths: s.widths ?? undefined,
    basis: fit.basis,
  };
}

export const SURFACES: Record<"mobile" | "desktop", Surface> = {
  mobile: surfaceFrom("mobile"),
  desktop: surfaceFrom("desktop"),
};

/** Kept as an export because tests and tools assert on the unfitted wording. */
export const UNFITTED_BASIS: string = fit.basis;

/** Graphemes, not UTF-16 units, or every emoji costs two characters of width. */
/*
 * BUILT ONCE, not per call.
 *
 * `shape.ts` constructs a fresh `Intl.Segmenter` inside its own `widthOf`, which is called once per
 * word per candidate line — fine for measuring one draft, and ruinous the moment anything sweeps a
 * parameter space. The calibration's grid is around a hundred thousand candidate surfaces, and with
 * a Segmenter built per call the self-test ran past ten minutes without finishing. Constructing it
 * here took that to seconds.
 *
 * Kept in a `try` because the constructor is what throws on a runtime without ICU, not the call.
 */
const SEGMENTER: Intl.Segmenter | null = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    return null;
  }
})();

function graphemes(s: string): string[] {
  if (!SEGMENTER) return [...s];
  return [...SEGMENTER.segment(s)].map((g) => g.segment);
}

/** The width of a string in a surface's units. A flat table makes this a grapheme count. */
/*
 * MEMOISED, per width table.
 *
 * Measuring one draft does not need this. Fitting does: `calibrate-fold.mjs` re-wraps the same
 * eight observation texts against tens of thousands of candidate surfaces, so the same words get
 * measured over and over. Timed before memoising, one `foldFor` took 0.735ms, which put a single
 * surface's fit at about six minutes and the self-test past ten without finishing.
 *
 * A WeakMap keyed on the table means a table that goes out of scope takes its cache with it, and
 * two different tables cannot read each other's answers — which they would under a single cache
 * keyed on the string alone, silently, giving every proportional candidate the flat model's widths.
 */
const WIDTH_CACHE = new WeakMap<WidthTable, Map<string, number>>();
const FLAT_CACHE = new Map<string, number>();

/** Guards the caches against a pathological input growing them without bound. */
const CACHE_CEILING = 50_000;

export function widthIn(s: string, widths?: WidthTable): number {
  const cache = widths ? (WIDTH_CACHE.get(widths) ?? new Map()) : FLAT_CACHE;
  if (widths && !WIDTH_CACHE.has(widths)) WIDTH_CACHE.set(widths, cache);

  const hit = cache.get(s);
  if (hit !== undefined) return hit;

  const g = graphemes(s);
  let total: number;
  if (!widths) {
    total = g.length;
  } else {
    const fallback = widths.default ?? 1;
    total = 0;
    for (const ch of g) {
      const listed = widths[ch];
      if (listed !== undefined) total += listed;
      else if (isEmoji(ch)) total += EMOJI_WIDTH;
      // Chinese, Japanese and Korean. Nothing in the table matches them, so the fallback of 1
      // applied and a CJK post measured as fitting twice as much above the fold as it does. The
      // scripts where this matters most are also the ones with no spaces to wrap on, so the
      // capacity is the only thing deciding the answer.
      else if (isFullWidth(ch)) total += FULL_WIDTH;
      else total += fallback;
    }
  }

  if (cache.size < CACHE_CEILING) cache.set(s, total);
  return total;
}

export interface FoldResult {
  /** The lines a reader sees, already shortened for the "see more" link. */
  shown: string[];
  /** Every rendered line, so "is there more" is answerable. */
  all: string[];
  /** True when the post continues past the cut. */
  truncated: boolean;
  /** The characters dropped from the last visible line, if the cut landed inside a word. */
  cutInsideWord: { kept: string; dropped: string } | null;
}

/**
 * Lay the text out for one surface and say where the cut falls.
 *
 * Greedy word wrap, kept deliberately: the arithmetic version (ceil(width / capacity)) undercounts
 * a line of long words, and the opening line is exactly where long words live — which is the line
 * this whole measurement exists to judge.
 */
export function foldFor(text: string | null | undefined, surface: Surface): FoldResult {
  const all: string[] = [];
  const source = (text ?? "").replace(/\r/g, "").split("\n");
  let lastWasBlank = false;

  /*
   * A fractional blank cost is REAL and has to survive.
   *
   * shape.ts does `for (let i = 0; i < blankCost; i++)`, which pushes one line for 1.5 and none for
   * 0.5 — while calibrate-fold.mjs searches over exactly those values. The fitter could therefore
   * recommend a number the renderer silently floors, and then report an error it was not actually
   * delivering. Accumulating the fraction and emitting a line when it crosses 1 keeps the search
   * space honest: 0.5 means every OTHER gap costs a line, which is a real rendering behaviour when
   * paragraph spacing is less than a full line height.
   */
  let blankDebt = 0;

  for (const raw of source) {
    const line = raw.trim();
    if (!line) {
      if (!lastWasBlank) {
        blankDebt += surface.blankCost;
        while (blankDebt >= 1) {
          all.push("");
          blankDebt -= 1;
        }
      }
      lastWasBlank = true;
      continue;
    }
    lastWasBlank = false;

    let current = "";
    for (const word of line.split(/\s+/)) {
      if (!current) {
        current = word;
      } else if (widthIn(`${current} ${word}`, surface.widths) <= surface.capacity) {
        current = `${current} ${word}`;
      } else {
        all.push(current);
        current = word;
      }

      /*
       * A WORD WIDER THAN THE LINE HAS TO WRAP, and this is where shape.ts stops being able to
       * describe a renderer at all.
       *
       * Its comment says "a word longer than the line still occupies one", so a 200-character
       * unbroken string measures as ONE rendered line — and a post built around a pasted URL
       * reports as sitting comfortably above the fold. A browser hard-wraps it; that is what
       * overflow-wrap does, and it is why a long link destroys a hook.
       *
       * Found by a test that fed it 200 identical characters and was told nothing was cut.
       *
       * Probe 4 (`long-word`) decides whether LinkedIn breaks mid-word like this or lets the word
       * overflow its container, which is the one part this cannot settle on its own.
       */
      while (widthIn(current, surface.widths) > surface.capacity) {
        const g = graphemes(current);
        let head = "";
        for (const ch of g) {
          if (widthIn(head + ch, surface.widths) > surface.capacity) break;
          head += ch;
        }
        // Never make no progress: one grapheme wider than the whole line still takes a line.
        if (!head) head = g[0] ?? "";
        all.push(head);
        current = current.slice(head.length);
      }
    }
    if (current) all.push(current);
  }

  while (all.length && all[0] === "") all.shift();
  while (all.length && all.at(-1) === "") all.pop();

  const visible = all.slice(0, surface.lines);
  const truncated = all.length > surface.lines;

  /*
   * The "see more" link is drawn INLINE and takes room from the last visible line. Only when the
   * post is actually truncated — an untruncated post has no link and loses nothing.
   */
  let cutInsideWord: FoldResult["cutInsideWord"] = null;
  const shown = [...visible];

  if (truncated && surface.seeMoreCost > 0 && shown.length > 0) {
    const i = shown.length - 1;
    const budget = surface.capacity - surface.seeMoreCost;
    if (widthIn(shown[i], surface.widths) > budget) {
      const g = graphemes(shown[i]);
      let kept = "";
      for (const ch of g) {
        if (widthIn(kept + ch, surface.widths) > budget) break;
        kept += ch;
      }
      const dropped = shown[i].slice(kept.length);
      if (!surface.breaksMidWord) {
        // Back up to the last space, the way a word-wrapping renderer would.
        const lastSpace = kept.lastIndexOf(" ");
        if (lastSpace > 0) kept = kept.slice(0, lastSpace);
      }
      if (dropped.trim()) cutInsideWord = { kept: kept.trimEnd(), dropped: shown[i].slice(kept.length) };
      shown[i] = kept.trimEnd();
    }
  }

  return { shown, all, truncated, cutInsideWord };
}

/* ── Drawing it ───────────────────────────────────────────────────────────── */

/**
 * Columns a string occupies in a monospaced grid.
 *
 * Not the same as its grapheme count, which is what the box used to pad by: an emoji is one
 * grapheme and two columns, so a line of them drew a frame around content twice its apparent
 * width and the right border landed nowhere near the other box's.
 */
const columns = (s: string) => graphemes(s).reduce((n, g) => n + displayWidth(g), 0);

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - columns(s)));

/** Greedy wrap for the preview's own prose. Not the fold model — this is just legibility. */
function softWrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= width) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * One surface as a box. Width is in CHARACTERS of the box, which is not the surface's capacity when
 * a fitted width table is in play — a proportional line of 42 units can be 60 narrow characters. So
 * the box is drawn to the longest line it actually contains, and the caption says the capacity.
 */
function box(result: FoldResult, surface: Surface): string[] {
  // Bounded by the surface: a line cannot be wider than the container that drew it, and a box
  // 200 characters across is not a preview of a phone.
  /*
   * Sized to the CONTENT's columns, not to the surface's capacity.
   *
   * Capacity is in model units and the frame is drawn in display columns, and for a full-width
   * glyph those differ by two: 42 emoji is 42 units and 84 columns. Bounding the frame by capacity
   * drew it 42 wide around content 84 wide, and the right border landed off the end of the line.
   * A box whose border does not line up with its own content is not a preview of anything.
   */
  const widest = Math.max(10, ...result.shown.map((l) => columns(l)));
  const out: string[] = [];
  out.push("┌" + "─".repeat(widest + 2) + "┐");
  for (const line of result.shown) out.push("│ " + pad(line, widest) + " │");
  if (result.truncated) {
    const label = "… see more ";
    out.push("└" + label + "─".repeat(Math.max(0, widest + 2 - label.length)) + "┘");
  } else {
    out.push("└" + "─".repeat(widest + 2) + "┘");
  }
  return out;
}

export interface PreviewOptions {
  /** Shown above the boxes, e.g. the idea's name. Never an id. */
  title?: string;
  /** The first sentence, so "does the hook land above the cut" can be answered. */
  hook?: string;
}

/**
 * Both surfaces, side by side, as plain text for a session to show him.
 *
 * Returned as a STRING on purpose. `mcp-server/server.mjs` passes a string handler result through
 * verbatim and JSON-stringifies everything else, so this is the only shape that arrives as lines
 * rather than as `\n` inside a quoted field. No tool in the repo had ever taken that path.
 */
export function previewBlock(
  text: string,
  surfaces: Surface[] = [SURFACES.mobile, SURFACES.desktop],
  opts: PreviewOptions = {},
): string {
  const out: string[] = [];
  if (opts.title) out.push(opts.title, "");

  const rendered = surfaces.map((s) => ({ surface: s, result: foldFor(text, s) }));

  // Side by side, each column padded to its own box width plus a gutter.
  const columns = rendered.map(({ surface, result }) => {
    const lines = [surface.name.toUpperCase(), ...box(result, surface)];
    const w = Math.max(...lines.map((l) => graphemes(l).length));
    return { lines, w };
  });

  const tallest = Math.max(...columns.map((c) => c.lines.length));
  for (let row = 0; row < tallest; row++) {
    out.push(
      columns.map((c) => pad(c.lines[row] ?? "", c.w)).join("    ").trimEnd(),
    );
  }

  out.push("");

  for (const { surface, result } of rendered) {
    const hookFits = opts.hook
      ? result.shown.join(" ").replace(/\s+/g, " ").includes(opts.hook.replace(/\s+/g, " ").trim())
      : null;
    const bits: string[] = [
      `${surface.name}: ${result.shown.length} of ${result.all.length} rendered line(s) visible`,
    ];
    if (!result.truncated) bits.push("nothing is cut — the whole post is above the fold");
    if (result.cutInsideWord) {
      bits.push(`cut inside a word: "${result.cutInsideWord.kept}|${result.cutInsideWord.dropped}"`);
    }
    if (hookFits !== null) {
      bits.push(hookFits ? "the first sentence lands above the cut" : "THE FIRST SENTENCE DOES NOT FIT");
    }
    out.push("  " + bits.join(" · "));
  }

  /*
   * The basis, always, and last so it is the thing left on screen.
   *
   * This is the habit the repo states outright: a check must report that it ran and say what it ran
   * against, because "0 found across 114 drafts" and "nothing to compare against" are different
   * answers and only one of them is good news.
   */
  const bases = [...new Set(surfaces.map((s) => s.basis))];
  out.push("");
  // Wrapped, because a preview that lays out the post and then emits its own caption as one
  // 250-character line is a preview nobody can read in a terminal.
  for (const b of bases) for (const line of softWrap(b, 76)) out.push("  " + line);

  return out.join("\n");
}
