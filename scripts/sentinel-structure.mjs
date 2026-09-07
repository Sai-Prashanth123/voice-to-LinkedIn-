#!/usr/bin/env node
/**
 * Turn scraped sentinel posts into STRUCTURE, and nothing else.
 *
 *   node scripts/sentinel-structure.mjs <posts.json>
 *
 * WHY THIS EXISTS AS A SEPARATE STEP
 *
 * Clause 8.3 allows Josh to learn structure from eight other writers and forbids everything else
 * about them: never a source of voice, never copied, never quoted. The honest way to hold that line
 * is not a rule in a prompt — prompts get edited, and a view list is one line in views.ts away from
 * being wrong. It is to make the text UNAVAILABLE.
 *
 * So the raw posts stay in the scraping console, which is already their store of record. This
 * reads them, measures them, and emits numbers and category counts. What it prints contains no
 * sentence any of these writers wrote. That output is what goes into Josh's library.
 *
 * The one deliberate exception is `opening_shape`, which classifies a first line into a bucket. It
 * records WHICH BUCKET, never the line.
 *
 * WHAT IT DELIBERATELY DOES NOT MEASURE
 *
 * Nothing about topic, argument or opinion. Those are the things Josh must supply from his own
 * experience, and a system that learned "posts about pricing do well" from someone else's feed
 * would be steering what he writes about rather than how he shapes it. 12.13 already covers what
 * lands, from HIS posts.
 *
 * INPUT
 *
 * A JSON array of job results as get_job_results(kind="linkedin_posts") returns them: objects with
 * at least `author_handle` and `text`. Extra fields are ignored.
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/sentinel-structure.mjs <posts.json>");
  process.exit(2);
}

/** @type {Array<{author_handle?: string, author_name?: string, text?: string, posted_at?: string, reaction_count?: number, comment_count?: number, is_repost?: boolean}>} */
const posts = JSON.parse(readFileSync(path, "utf8"));

/* ── Measures ─────────────────────────────────────────────────────────────── */

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Which move the first line makes. The bucket is recorded; the line never is.
 *
 * Ordered, because a line can qualify for several and the earliest match is the most specific.
 * "Until 2021, I was firmly on the gold line" is both time-anchored and a statement — time is the
 * more useful fact about it.
 */
function openingShape(first) {
  const t = first.trim();
  if (/\?\s*$/.test(t)) return "question";
  if (/^(in|on|last|until|back in|this|next|a few|two|three|when i)\b/i.test(t) &&
      /\b(19|20)\d\d\b|\b(week|month|year|monday|tuesday|wednesday|thursday|friday|night|morning)\b/i.test(t)) {
    return "time_anchored";
  }
  if (/\b\d+([.,]\d+)?\s*(k|m|%|percent|x)?\b/i.test(t) && /\b(i|we|my|our)\b/i.test(t)) return "number_claim";
  if (/^(i|we|my|our)\b/i.test(t)) return "first_person";
  if (/^(most|everyone|nobody|people|they|you)\b/i.test(t)) return "consensus_claim";
  if (/:\s*$/.test(t)) return "colon_setup";
  return "statement";
}

/** How the post ends. Again: the category, not the sentence. */
function closeShape(last, whole) {
  const t = last.trim();
  if (/\?\s*$/.test(t)) return "question";
  if (/\b(dm|message|comment|link in|sign up|join|book a|apply|register)\b/i.test(t)) return "direct_ask";
  if (/\b(like|repost|follow|share this)\b/i.test(t)) return "engagement_ask";
  if (/^(p\.?s\.?|ps)\b/i.test(t)) return "postscript";
  if (words(t) <= 8) return "short_landing";
  return "soft_close";
}

function measure(post) {
  const text = (post.text ?? "").replace(/\r/g, "");
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const lengths = sentences.map(words).filter((n) => n > 0);

  return {
    words: words(text),
    paragraphs: paras.length,
    lines: lines.length,
    // The three lines LinkedIn shows before "see more". Where the cut falls is a real craft
    // decision, and it is measurable without keeping the words.
    above_fold_words: words(lines.slice(0, 3).join(" ")),
    opening_words: words(lines[0] ?? ""),
    opening_shape: openingShape(lines[0] ?? ""),
    close_shape: closeShape(lines[lines.length - 1] ?? "", text),
    bullet_lines: bullets.length,
    uses_list: bullets.length >= 2,
    // Colons as a device, which Josh's formatting section calls the most underused tool available.
    colon_lines: lines.filter((l) => /:\s*$/.test(l)).length,
    has_link: /https?:\/\/|lnkd\.in/.test(text),
    sentence_words_mean: lengths.length ? +(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1) : 0,
    // Variation matters more than average — Josh's guide says everything the same length is
    // exhausting. Standard deviation is the number that says whether they vary it.
    sentence_words_sd: lengths.length > 1 ? +Math.sqrt(
      lengths.reduce((a, n) => a + (n - lengths.reduce((x, y) => x + y, 0) / lengths.length) ** 2, 0) /
        (lengths.length - 1),
    ).toFixed(1) : 0,
    shortest_sentence: lengths.length ? Math.min(...lengths) : 0,
    longest_sentence: lengths.length ? Math.max(...lengths) : 0,
  };
}

/* ── Roll up per account ──────────────────────────────────────────────────── */

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1);
};

const tally = (xs) =>
  Object.entries(xs.reduce((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1]);

const byHandle = new Map();
for (const p of posts) {
  if (p.is_repost) continue; // a repost is somebody else's structure
  if (!(p.text ?? "").trim()) continue;
  const h = p.author_handle ?? "unknown";
  if (!byHandle.has(h)) byHandle.set(h, { name: p.author_name ?? h, rows: [] });
  byHandle.get(h).rows.push({ ...measure(p), reactions: p.reaction_count ?? 0, posted_at: p.posted_at });
}

const report = [];
for (const [handle, { name, rows }] of [...byHandle].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dates = rows.map((r) => r.posted_at).filter(Boolean).sort();
  report.push({
    handle,
    name,
    posts_measured: rows.length,
    window: dates.length ? { from: dates[0].slice(0, 10), to: dates[dates.length - 1].slice(0, 10) } : null,
    length_words: { median: median(rows.map((r) => r.words)), min: Math.min(...rows.map((r) => r.words)), max: Math.max(...rows.map((r) => r.words)) },
    above_fold_words_median: median(rows.map((r) => r.above_fold_words)),
    opening_words_median: median(rows.map((r) => r.opening_words)),
    paragraphs_median: median(rows.map((r) => r.paragraphs)),
    opening_shapes: tally(rows.map((r) => r.opening_shape)),
    close_shapes: tally(rows.map((r) => r.close_shape)),
    uses_a_list: rows.filter((r) => r.uses_list).length + "/" + rows.length,
    colon_lines_median: median(rows.map((r) => r.colon_lines)),
    links: rows.filter((r) => r.has_link).length + "/" + rows.length,
    sentence_words: {
      mean_of_means: median(rows.map((r) => r.sentence_words_mean)),
      variation_sd_median: median(rows.map((r) => r.sentence_words_sd)),
      shortest_seen: Math.min(...rows.map((r) => r.shortest_sentence)),
      longest_seen: Math.max(...rows.map((r) => r.longest_sentence)),
    },
  });
}

console.log(JSON.stringify({ accounts: report.length, posts: posts.length, report }, null, 2));

// A last guard rather than a comment. If any post text survived into the output, the whole point
// of this script is defeated, and that must fail loudly rather than ship quietly.
const emitted = JSON.stringify(report);
for (const p of posts) {
  const sample = (p.text ?? "").trim().slice(0, 40);
  if (sample.length >= 40 && emitted.includes(sample)) {
    console.error("\nREFUSING: post text leaked into the structural output.");
    process.exit(1);
  }
}
