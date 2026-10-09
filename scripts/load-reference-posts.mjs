#!/usr/bin/env node
/**
 * Load the reference writers' posts so Josh can read them.
 *
 *   node scripts/load-reference-posts.mjs --posts <scraped.json>
 *   node scripts/load-reference-posts.mjs --posts <scraped.json> --apply
 *
 * WHY THIS EXISTS
 *
 * Josh chose eight writers whose storytelling structure he wants to borrow, and the first time he
 * went looking for one he got nothing: "I tried testing with Matt Barker and it returned nothing,
 * and I can't get to the posts through Claude Code." The build had deliberately stored no reference
 * text — see the long note in migration 0044 — so there was nothing to return.
 *
 * This is the other half of `sentinel-refresh.mjs`. That one measures and keeps numbers; this one
 * keeps the posts, for him to read. They take the same input file, so one scrape feeds both and the
 * per-post figures and the aggregates cannot disagree about the same corpus.
 *
 * WHAT IT WILL NOT DO
 *
 * Reach the drafting or gate path. `get_reference_posts` is a tool Josh calls; the library views that
 * build a drafting brief and a gate brief never touch this table, and `reference-split.test.ts` is
 * what keeps that true. The split is the whole protection now that the text is held.
 *
 * THE TWO GUARDS, BOTH LEARNED THE HARD WAY ON 5 OCTOBER
 *
 *   Only the eight handles. A profile scrape returns the subject's FEED, so other people's posts and
 *   reposts arrive with it. Measured as writers in their own right, they produced "new account"
 *   findings about a DM-setter and a dog rescue page.
 *
 *   Line breaks or no shape. That scrape returned every post as one unbroken line, which collapses
 *   paragraphs and above-fold counts to one and makes openingShape read the whole post. Those posts
 *   are still stored and still readable — they are the writer's words either way — but they are
 *   flagged, and the shape columns are left null rather than filled with an artefact.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { measurePost } from "./lib/prose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** Clause 8.3 names eight writers. Nobody else gets stored, whatever the scrape returned. */
const SENTINELS = new Set([
  "demandjen1",
  "ryanscarlin",
  "outboundphd",
  "curtishowland",
  "adam-treboutat",
  "juliacarter98",
  "amangrowth",
  "mattjbarker1",
]);

const APPLY = process.argv.includes("--apply");
const postsPath = (() => {
  const i = process.argv.indexOf("--posts");
  return i >= 0 ? process.argv[i + 1] : null;
})();

if (!postsPath) {
  console.error("usage: node scripts/load-reference-posts.mjs --posts <scraped.json> [--apply]");
  process.exit(2);
}

function credentials() {
  let file = "";
  try {
    file = readFileSync(join(ROOT, "eval", ".env"), "utf8");
  } catch { /* env only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();

  const url = field("SUPABASE_URL");
  const key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/* ── Read and shape ───────────────────────────────────────────────────────── */

const raw = JSON.parse(readFileSync(postsPath, "utf8"));
const items = Array.isArray(raw) ? raw : (raw.items ?? []);

let skippedForeign = 0;
let skippedRepost = 0;
let flat = 0;

const rows = [];
const seen = new Set();

for (const p of items) {
  const handle = p.author_handle ?? "";
  const text = (p.text ?? "").trim();

  if (!text) continue;
  if (p.is_repost) { skippedRepost++; continue; }
  if (!SENTINELS.has(handle)) { skippedForeign++; continue; }

  // The activity id is the natural key. Without one, fall back to something stable so a re-run
  // updates the same row rather than adding a near-duplicate.
  const id = String(p.activity_id ?? `${handle}:${p.posted_at ?? ""}:${text.slice(0, 40)}`);
  if (seen.has(id)) continue;
  seen.add(id);

  const hasBreaks = text.includes("\n");
  if (!hasBreaks) flat++;

  const m = measurePost(text);

  rows.push({
    activity_id: id,
    handle,
    author_name: p.author_name ?? null,
    url: p.url ?? null,
    posted_at: p.posted_at ?? null,
    text,
    words: m.words,
    // Null rather than a number nobody can source: every one of these is counted from line breaks,
    // and a post that arrived as one line has none to count.
    paragraphs: hasBreaks ? m.paragraphs : null,
    above_fold_words: hasBreaks ? m.above_fold_words : null,
    opening_words: hasBreaks ? m.opening_words : null,
    opening_shape: hasBreaks ? m.opening_shape : null,
    close_shape: hasBreaks ? m.close_shape : null,
    uses_list: hasBreaks ? m.uses_list : null,
    sentence_words_sd: m.sentence_words_sd,
    has_line_breaks: hasBreaks,
    reaction_count: p.reaction_count ?? null,
    comment_count: p.comment_count ?? null,
  });
}

const byHandle = new Map();
for (const r of rows) {
  const e = byHandle.get(r.handle) ?? { n: 0, shaped: 0, from: r.posted_at, to: r.posted_at };
  e.n++;
  if (r.has_line_breaks) e.shaped++;
  if (r.posted_at && (!e.from || r.posted_at < e.from)) e.from = r.posted_at;
  if (r.posted_at && (!e.to || r.posted_at > e.to)) e.to = r.posted_at;
  byHandle.set(r.handle, e);
}

console.log("\n  Reference posts\n");
console.log("  " + "─".repeat(66));
for (const [handle, e] of [...byHandle].sort()) {
  console.log(
    `  ${handle.padEnd(16)} ${String(e.n).padStart(3)} posts  ` +
      `${String(e.shaped).padStart(3)} with line breaks  ` +
      `${(e.from ?? "").slice(0, 10)}..${(e.to ?? "").slice(0, 10)}`,
  );
}
console.log("  " + "─".repeat(66));
console.log(`  ${rows.length} to store across ${byHandle.size} writer(s)`);
if (skippedForeign) console.log(`  ${skippedForeign} feed item(s) by other authors ignored (8.3)`);
if (skippedRepost) console.log(`  ${skippedRepost} repost(s) ignored`);
if (flat) {
  console.log(
    `  ${flat} arrived as one unbroken line — stored and readable, shape columns left null ` +
      `rather than filled with an artefact of the scrape`,
  );
}

const missing = [...SENTINELS].filter((h) => !byHandle.has(h));
if (missing.length) {
  console.log(`\n  nothing for: ${missing.join(", ")}`);
  console.log("  (adam-treboutat has returned zero posts on every run — worth confirming the handle)");
}

if (!APPLY) {
  console.log("\n  Dry run. Nothing written. Pass --apply to store them.\n");
  process.exit(0);
}

/* ── Store ────────────────────────────────────────────────────────────────── */

const { url, key } = credentials();

// Upsert on the activity id, in batches: a re-run after a fresh scrape updates the same rows and adds
// only what is new, so this is safe to run as often as he likes.
const BATCH = 100;
let stored = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const res = await fetch(`${url}/rest/v1/reference_writer_posts?on_conflict=activity_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(chunk),
  });

  if (!res.ok) {
    console.error(`\n  failed at row ${i}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  stored += chunk.length;
  process.stdout.write(`\r  stored ${stored}/${rows.length}`);
}

console.log(`\n\n  Done. Josh can read these with get_reference_posts.`);
console.log(`  The drafting and gate briefs still see measurements only — that split is the whole`);
console.log(`  protection now, and reference-split.test.ts is what holds it.\n`);
