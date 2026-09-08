/**
 * How prose gets measured. One definition, every reader.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `sentinel-structure.mjs` measures other writers' posts. `build-voiceprint.mjs` measures Josh's
 * speech and contrasts it against them. If those two counted a sentence differently, or split
 * paragraphs differently, the contrast between them would be an artefact of the code rather than a
 * fact about the writing — and it would look entirely reasonable.
 *
 * That is the same failure this repository keeps finding: two readers of one thing, both
 * individually correct, disagreeing. `isSupplied` had it. The MCP gate brief had it. The library
 * views had it. So the measures live here once, and both scripts import them.
 *
 * NOTHING HERE HOLDS TEXT. Every function takes a string and returns numbers or category names.
 * Callers are responsible for not putting the input back into their output; `sentinel-structure.mjs`
 * enforces that with an explicit guard, because clause 8.3 depends on it.
 */

/* ── Counting ─────────────────────────────────────────────────────────────── */

export const words = (s) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Sentence split that tolerates the way people actually punctuate, including not at all. */
export const sentences = (text) =>
  (text ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1);
};

export const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 0);

/** Sample standard deviation. n-1, because these are samples of a writer, not a population. */
export const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return +Math.sqrt(xs.reduce((a, n) => a + (n - m) ** 2, 0) / (xs.length - 1)).toFixed(1);
};

/** Category counts, commonest first. Returns [name, count] pairs, never the underlying text. */
export const tally = (xs) =>
  Object.entries(xs.reduce((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1]);

/* ── Shapes ───────────────────────────────────────────────────────────────── */

/**
 * Which move an opening line makes. The bucket is recorded; the line never is.
 *
 * Ordered, because a line can qualify for several and the earliest match is the most specific.
 * "Until 2021, I was firmly on the gold line" is both time-anchored and a statement, and time is
 * the more useful fact about it.
 */
export function openingShape(first) {
  const t = (first ?? "").trim();
  if (/\?\s*$/.test(t)) return "question";
  if (
    /^(in|on|last|until|back in|this|next|a few|two|three|when i)\b/i.test(t) &&
    /\b(19|20)\d\d\b|\b(week|month|year|monday|tuesday|wednesday|thursday|friday|night|morning)\b/i.test(t)
  ) return "time_anchored";
  if (/\b\d+([.,]\d+)?\s*(k|m|%|percent|x)?\b/i.test(t) && /\b(i|we|my|our)\b/i.test(t)) return "number_claim";
  if (/^(i|we|my|our)\b/i.test(t)) return "first_person";
  if (/^(most|everyone|nobody|people|they|you)\b/i.test(t)) return "consensus_claim";
  if (/:\s*$/.test(t)) return "colon_setup";
  return "statement";
}

/** How a piece ends. Again: the category, not the sentence. */
export function closeShape(last) {
  const t = (last ?? "").trim();
  if (/\?\s*$/.test(t)) return "question";
  if (/\b(dm|message|comment|link in|sign up|join|book a|apply|register)\b/i.test(t)) return "direct_ask";
  if (/\b(like|repost|follow|share this)\b/i.test(t)) return "engagement_ask";
  if (/^(p\.?s\.?|ps)\b/i.test(t)) return "postscript";
  if (words(t) <= 8) return "short_landing";
  return "soft_close";
}

/* ── One post ─────────────────────────────────────────────────────────────── */

export function measurePost(text) {
  const body = (text ?? "").replace(/\r/g, "");
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
  const lengths = sentences(body).map(words).filter((n) => n > 0);

  return {
    words: words(body),
    paragraphs: paras.length,
    lines: lines.length,
    // The three lines LinkedIn shows before "see more". Where the cut falls is a real craft
    // decision, and it is measurable without keeping the words.
    above_fold_words: words(lines.slice(0, 3).join(" ")),
    opening_words: words(lines[0] ?? ""),
    opening_shape: openingShape(lines[0] ?? ""),
    close_shape: closeShape(lines[lines.length - 1] ?? ""),
    bullet_lines: bullets.length,
    uses_list: bullets.length >= 2,
    // Colons as a device, which Josh's formatting section calls the most underused tool available.
    colon_lines: lines.filter((l) => /:\s*$/.test(l)).length,
    has_link: /https?:\/\/|lnkd\.in/.test(body),
    sentence_words_mean: mean(lengths),
    // Variation matters more than the average. Josh's guide says everything the same length is
    // exhausting, and standard deviation is the number that says whether a writer varies it.
    sentence_words_sd: sd(lengths),
    shortest_sentence: lengths.length ? Math.min(...lengths) : 0,
    longest_sentence: lengths.length ? Math.max(...lengths) : 0,
  };
}

/* ── Lexicon ──────────────────────────────────────────────────────────────── */

/**
 * Words, lowercased, apostrophes kept.
 *
 * "don't" and "dont" are the same word and "its" and "it's" are not, so the apostrophe stays in.
 * Numbers are dropped: a writer's distinctive vocabulary is not the figures they happen to cite,
 * and keeping them would make every transcript look distinctive for saying "2021".
 */
export const tokens = (text) =>
  (text ?? "").toLowerCase().match(/[a-z][a-z'’-]{1,}/g) ?? [];

export function freq(list) {
  const out = new Map();
  for (const t of list) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}

/** Occurrences per thousand words, so two corpora of different sizes can be compared. */
export const per1k = (count, total) => (total ? +((count / total) * 1000).toFixed(2) : 0);

/**
 * Words this speaker uses far more than the comparison corpus does.
 *
 * A ratio, not a raw count, and with a floor on the raw count so a word said twice in eleven
 * thousand cannot look like a signature. `minCount` is deliberately not 1: with a corpus this size,
 * single occurrences are noise, and a fingerprint built from noise reads as authoritative anyway.
 */
export function distinctive(mineFreq, mineTotal, theirsFreq, theirsTotal, { minCount = 4, top = 30 } = {}) {
  const out = [];
  for (const [word, n] of mineFreq) {
    if (n < minCount) continue;
    const mineRate = per1k(n, mineTotal);
    const theirRate = per1k(theirsFreq.get(word) ?? 0, theirsTotal);
    // +0.05 rather than a zero guard: a word absent from the comparison corpus should score high,
    // not infinitely, or the list fills with one-off proper nouns.
    out.push({ word, count: n, mine_per_1k: mineRate, theirs_per_1k: theirRate, ratio: +(mineRate / (theirRate + 0.05)).toFixed(1) });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, top);
}
