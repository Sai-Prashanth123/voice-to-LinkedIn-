/**
 * The shape of a post: how it sits on a phone, rather than what it says.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IMPORTS NOTHING
 *
 * Josh, on the call of 14 October 2026, describing every draft he had been shown:
 *
 *   "there is a lack of using line breaks... it's quite text-heavy... bullet points every now and
 *    then, we don't need to overdo the bullet points, but break it up a little bit... header and
 *    then underneath the A B C and then header... structure in a way that's a little easier to
 *    consume rather than just a wall of text."
 *
 * The rule for that already existed and had done nothing. `formatting` is in the library, the
 * drafter is shown it, the GATE IS NOT — `GATING_SECTIONS` in views.ts leaves it out — and the
 * voice guide is built never to acquire shape taste of its own (`VOICE_GUIDE_SYSTEM`: "Do not
 * describe how a LinkedIn post should be structured"). So a post that is specific, traceable,
 * aimed, in-voice and clean of banned phrases passed all eight checks as one unbroken block,
 * which is exactly what he kept receiving.
 *
 * Adding a ninth check needs the numbers in both runtimes: Deno judges server-side, Node assembles
 * the brief for Claude. Three implementations of "split into paragraphs" already existed in this
 * repository — prose.mjs, diff.ts, aitells.mjs — and the header of prose.mjs warns at length about
 * exactly that. So this is the fourth place it would have been written, and instead it is the
 * first place it is written once: import-free, type-stripped by Node, imported by Deno, and
 * `scripts/lib/prose.mjs` now calls it rather than keeping its own copy.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not judge. There is no threshold here and no opinion about what a good post looks like.
 * The targets a verdict is measured against are the eight writers Josh chose, stored per writer,
 * and they belong to the check that reads them — not to the thing that counts.
 */

/** Words, counted the way every other measure in this system counts them. */
function words(s: string): number {
  return (s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * WHAT A BULLET IS. Spelled once, because it was spelled twice and the two disagreed.
 *
 * This file said `/^[-*•]\s+/` and aitells.mjs said `/^(?:[-*•‣]|\d+[.)])\s+/`. Neither included
 * `→`, which is the marker Josh's drafter actually reaches for. The cost, measured on drafts 89 and
 * 90 on 26 October: eight blocks of four arrow bullets each, the same scaffold stamped on every one
 * ("Pro:", "Con:", "Effort to use:", "Used in GTM:"), and
 *
 *   - rule 2C-17 is in HIGH_CONFIDENCE, so create_draft was supposed to refuse the draft before
 *     filing it. It found nothing, because it was looking for a dash.
 *   - the ninth gate check reported "no list" about a post that is nothing but lists, because
 *     uses_list below was looking for the same dash.
 *
 * Josh then read the post and told us it was bullet soup. He was the third reader, and the only one
 * that could see the bullets.
 *
 * Anchored, no `g` flag: a global regex carries lastIndex between calls and these are shared.
 */
export const BULLET_MARKER = /^(?:[-*•‣▪·>→➔»›]|\d+[.)])\s+/;

/**
 * A DASH USED AS PUNCTUATION — the AI tell. Not a normaliser, and that distinction is the point.
 *
 * `aitells.mjs` rule 2C-1 tested `/[—–]/`: em dash and en dash, nothing else. Two other places in
 * this repo also decide what a dash is, and both are WIDER:
 *
 *   - `claims.ts` and `shingles.ts` fold `[‐-―−]` (U+2010..U+2015 plus minus) down to "-", so that
 *     "well-known" and "well‑known" are the same words to the claim ledger;
 *   - `frameworks.mjs` folds `[‐-―_]`, underscore included, because `Problem_Agitate_Solve` is the
 *     same framework as `Problem-Agitate-Solve`.
 *
 * Those two are right as they are and must NOT be made identical to this one: they are normalisers
 * answering "are these the same string", and a normaliser wants to be greedy. This answers "did the
 * writer reach for a dash instead of a full stop", and the one that refuses a draft was the
 * narrowest of the three. A horizontal bar or a figure dash passed 2C-1 while being a dash to
 * everything else — the `→` bug in a different character class.
 *
 * Deliberately EXCLUDED, with reasons, because a detector's false positives cost more than its
 * misses here:
 *   - U+2010 hyphen and U+2011 non-breaking hyphen: those are hyphens. "Go-to-market" is not a tell.
 *   - U+2212 minus: "the number was −5" is arithmetic, not punctuation.
 */
export const PUNCTUATION_DASH = /[—–―‒]/g;

/**
 * WHICH ROWS THE SHAPE TARGETS REST ON. Spelled here because three callers load them.
 *
 * The two runtimes genuinely need separate loaders — Deno reaches the database through
 * SupabaseClient and Node through its own wrapper — so what they must not disagree on is WHICH ROWS
 * they load. That is the same reasoning as the note on HIS_WORDS_TABLE in entry.ts, and the same bug
 * class it was written for.
 *
 * MEASURED 26 OCTOBER, and the reason this exists: PostgREST caps a response at 1,000 rows whatever
 * limit is asked for. `limit: "2000"` and `limit: "5000"` both return exactly 1,000. There are 1,839
 * posts with their line breaks intact, and the gate was asking for 500 — so every `shape` verdict
 * was judged against per-writer medians computed from about 43 of Matt Barker's 241 measurable
 * posts, and the band across the eight came out 7 to 23 where the truth is 8 to 21. Wider than real,
 * which makes the check more permissive than it was written to be.
 *
 * The ninth check was added on 14 October to answer Josh's "wall of text" complaint. It has been
 * answering it against a sample nobody chose.
 *
 * So: page. A single large limit cannot work, because the ceiling is the server's and it is silent.
 */
export const SHAPE_ROWS_SELECT = "handle,paragraphs,above_fold_words";
export const SHAPE_ROWS_PAGE = 1000;

/* ── The fold, as a phone actually renders it ─────────────────────────────────
 *
 * Josh, 26 October: "If the hook doesn't sit above the 'see more' line on mobile, it doesn't do its
 * job. I'd like the system to actually measure that, in phone lines, not just word count."
 *
 * `above_fold_words` below is not that number and never was. It takes the first three entries of
 * `lines`, which has blank lines FILTERED OUT, so it is wrong in both directions:
 *
 *   - three one-word paragraphs measure 3 words, while occupying five rendered lines on a phone
 *     once the gaps between them are counted;
 *   - a single 60-word opening paragraph is ONE entry, so slice(0, 3) hands back the whole
 *     paragraph as "above the fold". That is why measure_draft can ever see 90 words up there.
 *     Ninety words do not fit above any fold on any phone.
 *
 * So this is a second, differently-named measurement rather than a correction of that one.
 * `above_fold_words` keeps its meaning exactly, because the writers' stored medians, the ninth
 * check's targets and compare_to_references all rest on it. The two must never be averaged or
 * compared — they count different things.
 *
 * THE CONSTANTS ARE PROVISIONAL AND MUST BE CALIBRATED.
 *
 * LinkedIn does not publish where the cut falls, and it moves with the device, the OS text size and
 * the app version. These are a starting point, not a measurement. The precedent for fixing that is
 * in this repo: the list detector in scripts/measure-structure.mjs published its confusion matrix,
 * was re-tested at scale, and turned out to have been flattering — 90% became 83.8%. Until the same
 * is done here with real posts read off a real phone, `hook_above_fold` is the only signal worth
 * acting on, because it only flips when the error is bigger than the gap, and it is kept out of the
 * gate rubric entirely.
 */
export const FOLD_LINES = 3;
/** PROVISIONAL. Fit against posts read off a phone before anyone trusts a number derived from it. */
export const FOLD_CHARS_PER_LINE = 42;
/**
 * PROVISIONAL, and a fitted parameter rather than a fact — how many rendered lines a blank line
 * costs. It is the single assumption most likely to be wrong, and it moves the answer by one or two
 * lines out of three, which is decisive.
 */
export const FOLD_BLANK_COST = 1;

/** Graphemes, not UTF-16 units, or every emoji costs two characters of line width. */
function widthOf(s: string): number {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let n = 0;
    for (const _ of seg.segment(s)) n++;
    return n;
  } catch {
    return [...s].length;
  }
}

/**
 * The post as a narrow screen lays it out: one entry per rendered line, blank lines included.
 *
 * Greedy word wrap rather than ceil(chars / perLine). The arithmetic version undercounts a line of
 * long words, and the opening line is exactly where long words live — which is the line this whole
 * measurement exists to judge.
 */
export function renderedLines(
  text: string | null | undefined,
  { charsPerLine = FOLD_CHARS_PER_LINE, blankCost = FOLD_BLANK_COST } = {},
): string[] {
  const out: string[] = [];
  const source = (text ?? "").replace(/\r/g, "").split("\n");
  let lastWasBlank = false;

  for (const raw of source) {
    const line = raw.trim();
    if (!line) {
      // Consecutive blanks collapse: a reader sees one gap however many newlines produced it.
      if (!lastWasBlank) for (let i = 0; i < blankCost; i++) out.push("");
      lastWasBlank = true;
      continue;
    }
    lastWasBlank = false;

    let current = "";
    for (const word of line.split(/\s+/)) {
      if (!current) {
        current = word;
      } else if (widthOf(`${current} ${word}`) <= charsPerLine) {
        current = `${current} ${word}`;
      } else {
        out.push(current);
        current = word;
      }
    }
    // A word longer than the line still occupies one, so never push nothing.
    out.push(current);
  }

  // Leading and trailing gaps are not lines a reader sees.
  while (out.length && out[0] === "") out.shift();
  while (out.length && out.at(-1) === "") out.pop();
  return out;
}

export interface Shape {
  /**
   * Counted here so no caller writes the split itself.
   *
   * Both callers did, through a code generator that ate the backslash, and `/\s+/` became `/s+/` —
   * splitting on the letter s. The gate was handed "54 words above the fold, 31 words in total",
   * which is impossible, and it shipped because nobody reads a number that is merely wrong rather
   * than absent. One place counts words now.
   */
  words: number;
  /** Blocks separated by a blank line. One block is a wall of text however long it is. */
  paragraphs: number;
  /** Non-empty lines. A post can have many lines and one paragraph — that is a list. */
  lines: number;
  /**
   * The three lines LinkedIn shows before "see more". Where the cut falls is a real craft decision
   * and the single most shape-relevant number there is — it was computed in prose.mjs and then
   * dropped on the floor, never surfaced by measure_draft to the writer who needed it.
   */
  above_fold_words: number;
  /**
   * The same cut, measured as a phone renders it. Blank lines counted, long paragraphs wrapped.
   *
   * These are NOT comparable with above_fold_words above and must never be averaged with it or
   * swapped for it — see the note on FOLD_CHARS_PER_LINE. The constants behind them are provisional
   * until calibrated against posts read off a real phone.
   */
  rendered_lines: number;
  above_fold_rendered: string;
  above_fold_rendered_words: number;
  /**
   * The question Josh actually asked: does his hook finish before the "see more" cut?
   *
   * A boolean rather than a word count, and the only signal here worth acting on while the
   * constants are provisional — it only flips when the error is larger than the gap between the end
   * of the first sentence and the cut, and usually it is not.
   */
  hook_above_fold: boolean;
  /** The cut lands inside a sentence rather than between two. Reported, never judged. */
  cut_mid_sentence: boolean;
  opening_words: number;
  bullet_lines: number;
  /** Two or more. One stray dash is a sentence, not a list. */
  uses_list: boolean;
  /** Colons as a device — the formatting section calls them the most underused tool available. */
  colon_lines: number;
}

export function measureShape(text: string | null | undefined): Shape {
  const body = (text ?? "").replace(/\r/g, "");
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => BULLET_MARKER.test(l));

  /*
   * The rendered cut, alongside the old measurement rather than replacing it.
   *
   * `fold` is what a reader sees before "see more"; `firstSentence` is where the hook ends. The
   * hook clears the fold when every word of it is inside that text — compared on collapsed
   * whitespace, because the wrap inserts breaks where the source had spaces.
   */
  const rendered = renderedLines(body);
  const fold = rendered.slice(0, FOLD_LINES).join("\n");
  const foldFlat = fold.replace(/\s+/g, " ").trim();
  const firstSentence = (body.split(/(?<=[.!?])\s/)[0] ?? "").replace(/\s+/g, " ").trim();
  const hookFits = firstSentence.length > 0 && foldFlat.includes(firstSentence);

  return {
    words: words(body),
    paragraphs: paras.length,
    lines: lines.length,
    above_fold_words: words(lines.slice(0, 3).join(" ")),
    rendered_lines: rendered.length,
    above_fold_rendered: fold,
    above_fold_rendered_words: words(foldFlat),
    hook_above_fold: hookFits,
    /*
     * Only meaningful when there is more post after the cut.
     *
     * TESTED ON THE LAST NON-EMPTY LINE OF THE PREVIEW, NOT ON THE THIRD SLOT.
     *
     * This read `rendered[FOLD_LINES - 1]`, and `renderedLines()` pushes `""` for a blank gap — so
     * on a post whose first paragraph is two lines, the third slot is the BLANK LINE and the regex
     * tested the empty string. It therefore reported `true` beside an `above_fold_rendered` that
     * visibly ended on a full stop. Measured 28 October 2026: "My holidays used to have client
     * meetings / in them. / " came back `cut_mid_sentence: true`, while a longer draft that also
     * ended on a period came back `false`. The boolean was set by where the character budget landed
     * rather than by what the preview showed, so it contradicted the field printed next to it.
     *
     * It is reported and never judged — no rubric reads it — so this cannot change a verdict. It
     * can only stop the payload disagreeing with itself.
     */
    cut_mid_sentence: rendered.length > FOLD_LINES &&
      !/[.!?:"”]\s*$/.test(
        rendered.slice(0, FOLD_LINES).map((l) => l.trim()).filter(Boolean).at(-1) ?? "",
      ),
    opening_words: words(lines[0] ?? ""),
    bullet_lines: bullets.length,
    uses_list: bullets.length >= 2,
    colon_lines: lines.filter((l) => /:\s*$/.test(l)).length,
  };
}

/**
 * Said in words, for a judge that is reading rather than comparing floats.
 *
 * The ranges come from the writers Josh chose, measured: paragraph medians run 4 to 14 across the
 * seven that could be measured, and words above the fold 17 to 74.5. A post outside that is not
 * automatically wrong — Aman Ghataura's median is 4 paragraphs and 17 words above the fold — but a
 * post of 250 words in one block is outside it in the direction that has no example at all.
 */
export function shapeAgainst(
  shape: Shape,
  targets: { paragraphs: number[]; aboveFold: number[] },
): string[] {
  const notes: string[] = [];
  const range = (xs: number[]) =>
    xs.length ? `${Math.min(...xs)} to ${Math.max(...xs)}` : "not measured";

  notes.push(
    `This post: ${shape.paragraphs} paragraph(s), ${shape.lines} line(s), ` +
      `${shape.above_fold_words} word(s) above the fold, ` +
      `${shape.uses_list ? `a list of ${shape.bullet_lines} items` : "no list"}, ` +
      `${shape.colon_lines} line(s) ending on a colon, ${shape.words} words in total.`,
  );
  notes.push(
    `The writers he chose: ${range(targets.paragraphs)} paragraphs, ` +
      `${range(targets.aboveFold)} words above the fold.`,
  );

  return notes;
}

/**
 * The writers' medians, from their stored posts.
 *
 * A pure function over rows so both runtimes compute the targets the same way — Deno queries
 * through SupabaseClient and Node through its own wrapper, and the only thing they must agree on
 * is the arithmetic.
 *
 * Only posts that kept their line breaks count. The scraping console returns most posts as one
 * line (70 of 70 on 9 October, 66 of 66 on the 13th), and averaging those in would report the
 * scraper's behaviour as a habit of the writer — which is the whole reason `shape_measurable`
 * exists on those rows.
 */
export function writerShapeTargets(
  rows: { handle?: string | null; paragraphs?: number | null; above_fold_words?: number | null }[],
): { paragraphs: number[]; aboveFold: number[] } {
  const byHandle = new Map<string, { paragraphs: number[]; aboveFold: number[] }>();

  for (const r of rows ?? []) {
    const handle = r.handle ?? "";
    if (!handle) continue;
    if (typeof r.paragraphs !== "number" || typeof r.above_fold_words !== "number") continue;
    const e = byHandle.get(handle) ?? { paragraphs: [], aboveFold: [] };
    e.paragraphs.push(r.paragraphs);
    e.aboveFold.push(r.above_fold_words);
    byHandle.set(handle, e);
  }

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    if (s.length === 0) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const paragraphs: number[] = [];
  const aboveFold: number[] = [];
  for (const e of byHandle.values()) {
    const p = median(e.paragraphs);
    const a = median(e.aboveFold);
    if (p !== null) paragraphs.push(p);
    if (a !== null) aboveFold.push(a);
  }

  return { paragraphs, aboveFold };
}
