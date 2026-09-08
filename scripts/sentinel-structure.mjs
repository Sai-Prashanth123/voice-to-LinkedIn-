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
 * THE MEASURES LIVE IN lib/prose.mjs
 *
 * They used to live here. `build-voiceprint.mjs` needs the same ones to contrast Josh's speech
 * against this corpus, and two copies of "what counts as a sentence" would make that contrast an
 * artefact of the code rather than a fact about the writing. One definition, both readers.
 *
 * INPUT
 *
 * A JSON array of job results as get_job_results(kind="linkedin_posts") returns them: objects with
 * at least `author_handle` and `text`. Extra fields are ignored.
 */

import { readFileSync } from "node:fs";
import { measurePost, median, tally } from "./lib/prose.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/sentinel-structure.mjs <posts.json>");
  process.exit(2);
}

/** @type {Array<{author_handle?: string, author_name?: string, text?: string, posted_at?: string, reaction_count?: number, is_repost?: boolean}>} */
const posts = JSON.parse(readFileSync(path, "utf8"));

/* ── Roll up per account ──────────────────────────────────────────────────── */

const byHandle = new Map();
for (const p of posts) {
  if (p.is_repost) continue; // a repost is somebody else's structure
  if (!(p.text ?? "").trim()) continue;
  const h = p.author_handle ?? "unknown";
  if (!byHandle.has(h)) byHandle.set(h, { name: p.author_name ?? h, rows: [] });
  byHandle.get(h).rows.push({
    ...measurePost(p.text),
    reactions: p.reaction_count ?? 0,
    posted_at: p.posted_at,
  });
}

const report = [];
for (const [handle, { name, rows }] of [...byHandle].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dates = rows.map((r) => r.posted_at).filter(Boolean).sort();
  report.push({
    handle,
    name,
    posts_measured: rows.length,
    window: dates.length ? { from: dates[0].slice(0, 10), to: dates[dates.length - 1].slice(0, 10) } : null,
    length_words: {
      median: median(rows.map((r) => r.words)),
      min: Math.min(...rows.map((r) => r.words)),
      max: Math.max(...rows.map((r) => r.words)),
    },
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
