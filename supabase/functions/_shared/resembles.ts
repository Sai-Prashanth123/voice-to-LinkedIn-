/**
 * Has he said this before? Asked at capture, answered in exact shared wording.
 *
 * WHY THIS EXISTS
 *
 * A hundred posts written across twenty moments on 2 November 2026 produced sixty post-pairs from
 * DIFFERENT moments sharing seven-word runs. Reading the runs settled what it was:
 *
 *     119 / 120 / 121 / 122    "a survey of 153 sales leaders and"
 *     124 / 125                "page carries a practice id a live id"
 *     115 / 116 / 117          "they had about 3 900 customers"
 *
 * Nine of the twenty duplicated another. The drafter was not repeating itself — it was handed the
 * same material under different ids. Five posts were written against moment 124 that belonged to
 * 125, which carries the better material and the limit 124 has no version of.
 *
 * WHY NOT THE RETELLING CHECK, WHICH ALREADY EXISTS
 *
 * `checkRetelling` answers a different question at a different time. It runs at DRAFT time and asks
 * a model whether two posts tell the same story, which catches a retelling in different words and
 * is the only thing that can. This runs at CAPTURE time and asks whether the same words have been
 * typed before, which needs no model, no embedding provider and no network.
 *
 * They will sometimes disagree, and that is correct: one reads meaning and one reads wording. The
 * reply says which it is, because a reader who thinks this is the retelling check will trust it for
 * something it cannot do.
 *
 * AND WHY AT CAPTURE
 *
 * By draft time the duplicate has already been named, interviewed and selected. Everything after
 * capture is spent on it. This is the first moment at which saying so is free.
 */

import { borrowedRuns, hashRun, shinglesOf } from "./shingles.ts";

const words = (s: string) => s.split(" ").filter(Boolean).length;

/**
 * Two or more merged passages, OR one long one. It needs both arms, and the second arm is the
 * important one.
 *
 * WHY TWO ARMS. `borrowedRuns` merges overlapping hits, so the MORE completely two captures
 * duplicate each other the FEWER passages they produce. A threshold on passages alone therefore
 * catches partial overlap and misses total overlap, which is backwards. Measured on the real bank:
 * m110 and m111 share a single merged passage of 925 words, m93 and m94 share 609, m107 and m108
 * share 456 — and a passage count of two or more finds none of the three. m107 and m108 carry the
 * SAME TITLE. They are one thought captured twice, and the obvious rule would have reported them
 * clear.
 *
 * MEASURED, NOT CHOSEN. Across the bank on 2 November 2026 — 99 moments with raw text, 4,851
 * pairs — the two-armed rule fires on 31 pairs (0.6%). Read by eye, nearly every one is a genuine
 * duplicate: three moments share the title "TP verify widened source", two share "AI data versus
 * human messaging", and m110/m111 differ only in capitalisation.
 *
 * WHY 25 WORDS AND NOT 14. The 14-to-24-word band holds 38 single-passage pairs and almost all of
 * them are shared SEED boilerplate rather than shared material — "oct 2026 not josh's material"
 * and "a founder told me he scrapped his pitch deck", each repeated across many pairs. Taking the
 * cut at 25 drops that band and keeps every real duplicate.
 *
 * Both numbers were fitted on 99 moments and will drift as the bank grows. If you move either,
 * measure it the same way and read a sample of what changes — the rate is the easy half.
 */
export const MIN_PASSAGES = 2;
export const MIN_LONG_PASSAGE_WORDS = 25;

/** A moment's own words, as `raw_inputs` stores them. */
export interface PriorMoment {
  moment_id: number;
  title?: string | null;
  text: string;
}

export interface Resemblance {
  moment_id: number;
  title: string | null;
  passages: number;
  /**
   * Words in the longest shared passage. The near-total duplicates show up HERE and not in
   * `passages`, which is why both are reported.
   */
  longest_words: number;
  longest: string;
}

export interface ResemblesResult {
  /**
   * How many prior moments were actually compared.
   *
   * This is here because of the defect this repository keeps finding: a check with nothing to check
   * reports success. `checked: 0` and `found: []` is not good news and must never read like it —
   * which is why `means` is written from this number rather than from `found` alone.
   */
  checked: number;
  found: Resemblance[];
  means: string;
}

/**
 * Compare one new capture against his earlier ones. Pure: no database, no clock, no network.
 *
 * Returns at most `limit` matches, worst first.
 */
export function resembles(
  text: string,
  priors: PriorMoment[],
  opts: { minPassages?: number; minLongWords?: number; limit?: number } = {},
): ResemblesResult {
  const minPassages = opts.minPassages ?? MIN_PASSAGES;
  const minLongWords = opts.minLongWords ?? MIN_LONG_PASSAGE_WORDS;
  const limit = opts.limit ?? 3;

  const usable = (priors ?? []).filter((p) => p && typeof p.text === "string" && p.text.trim());

  // Nothing to compare against is its own answer, and it is not "nothing resembles it".
  if (!text?.trim() || usable.length === 0) {
    return { checked: usable.length, found: [], means: meaning(usable.length, []) };
  }

  const found: Resemblance[] = [];
  for (const prior of usable) {
    // The index is built from the PRIOR and the new text is walked against it, so the passages
    // returned are spans of what he just typed — which is what a reader needs to see.
    const index = new Set(shinglesOf(prior.text).map(hashRun));
    const passages = borrowedRuns(text, index);
    if (passages.length === 0) continue;

    const longest = passages.reduce((a, b) => (words(b) > words(a) ? b : a));
    const longestWords = words(longest);

    // Either arm. See MIN_LONG_PASSAGE_WORDS for why the second one is not optional.
    if (passages.length < minPassages && longestWords < minLongWords) continue;

    found.push({
      moment_id: prior.moment_id,
      title: prior.title ?? null,
      passages: passages.length,
      longest_words: longestWords,
      longest,
    });
  }

  // Worst first, and "worst" is how much was shared rather than how many times — a 925-word
  // single passage is a nearer duplicate than three short ones.
  found.sort((a, b) => b.longest_words - a.longest_words || b.passages - a.passages);
  const top = found.slice(0, limit);
  return { checked: usable.length, found: top, means: meaning(usable.length, top) };
}

/**
 * What the finding means, in a sentence a drafter will read out loud.
 *
 * The wording matters more than it looks. A second angle on one piece of material is NORMAL and
 * explicitly allowed — 115 and 116 are two different arguments off one figure and both are good.
 * A retelling is not. Only Josh can tell those apart, so this must hand him the decision rather
 * than imply the capture was a mistake.
 */
function meaning(checked: number, found: Resemblance[]): string {
  if (checked === 0) {
    return "NOTHING WAS COMPARED — there are no earlier captures with text, so this is not a " +
      "clean result. Do not tell him it looks new.";
  }
  if (found.length === 0) {
    return `No shared wording against ${checked} earlier ${checked === 1 ? "idea" : "ideas"}. ` +
      "This checks exact phrasing only. A retelling in different words would not show up here, " +
      "and the draft-time retelling check is what reads for that.";
  }
  /*
   * Named, never numbered. He is never shown ids like M-000024, so a finding he cannot act on by
   * name is a finding he will ignore — and printing the id to fill the gap breaks the rule the
   * whole reply exists to respect. Untitled moments do exist (older captures, before autoName),
   * so the gap is admitted instead.
   */
  const names = found
    .map((f) => (f.title ? `"${f.title}"` : "an earlier idea that never got a name"))
    .join(", ");
  return `He has used some of these exact words before, in ${names}. THIS IS HIS CALL: a second ` +
    "angle on the same material is normal and a retelling is not, and only he can tell them " +
    "apart. Mention the idea by name and let him choose. Do not park or kill anything over this, " +
    "and do not treat it as the retelling check, which reads meaning at draft time rather than " +
    "wording now.";
}
