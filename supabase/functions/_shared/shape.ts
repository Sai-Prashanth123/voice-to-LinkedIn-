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
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l));

  return {
    words: words(body),
    paragraphs: paras.length,
    lines: lines.length,
    above_fold_words: words(lines.slice(0, 3).join(" ")),
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
