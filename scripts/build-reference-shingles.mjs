#!/usr/bin/env node
/**
 * Build the fingerprint that catches a reference writer's words in one of Josh's drafts.
 *
 *   node scripts/build-reference-shingles.mjs            # print what it would write
 *   node scripts/build-reference-shingles.mjs --apply    # write data/josh/reference-shingles.json
 *
 * The reasoning for the whole idea — why it exists, why hashes and not sentences, why seven words —
 * is in supabase/functions/_shared/shingles.ts, which holds the code this and the draft-time check
 * both use. One implementation, so the thing that builds the index and the thing that queries it
 * cannot normalise a sentence two different ways.
 *
 * Re-run it after any scrape. An index built before a post was collected cannot catch that post.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  HASH_WIDTH,
  hashRun,
  normaliseRun,
  SHINGLE_WORDS,
  shinglesOf,
} from "../supabase/functions/_shared/shingles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");
const OUT = join(ROOT, "data", "josh", "reference-shingles.json");

/*
 * Runs that are ordinary English rather than anybody's writing.
 *
 * Nothing goes in here on a hunch. Each entry is a run that fired against a draft of Josh's written
 * BEFORE the post it matched was collected, which makes it a false positive by construction: he
 * cannot have borrowed from something the system did not hold. scripts/check-shingle-noise.mjs is
 * what finds them.
 */
const EXEMPT = [];

const envText = ["eval/.env", ".env", "mcp-server/.env"]
  .map((p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } })
  .join("\n");
const field = (k) =>
  (process.env[k] ?? (envText.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1] ?? "").trim();
const url = field("SUPABASE_URL").replace(/\/+$/, "");
const key = field("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const posts = [];
for (let offset = 0; ; offset += 1000) {
  const q = new URLSearchParams({
    select: "activity_id,handle,text",
    order: "activity_id",
    limit: "1000",
    offset: String(offset),
  });
  const res = await fetch(`${url}/rest/v1/reference_writer_posts?${q}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`  Could not read the corpus: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const page = await res.json();
  posts.push(...page);
  if (page.length < 1000) break;
}

if (posts.length === 0) {
  console.error("  No reference posts are stored, so there is nothing to fingerprint.");
  process.exit(1);
}

const exempt = new Set(EXEMPT.map((s) => hashRun(normaliseRun(s))));
const writers = new Set();
const hashes = new Set();
let runs = 0;

for (const p of posts) {
  writers.add(p.handle);
  for (const run of shinglesOf(p.text)) {
    runs++;
    const h = hashRun(run);
    if (!exempt.has(h)) hashes.add(h);
  }
}

const out = {
  built_at: new Date().toISOString(),
  algorithm: `cyrb53 base36 x${HASH_WIDTH} of ${SHINGLE_WORDS}-word runs, normalised`,
  posts: posts.length,
  writers: [...writers].sort(),
  words: SHINGLE_WORDS,
  distinct: hashes.size,
  packed: [...hashes].sort().join(""),
};

/*
 * The guard sentinel-structure.mjs carries, for the same reason. This file must contain no readable
 * run of anybody's post, and if a bug ever put one there it has to fail loudly rather than ship
 * quietly, whatever the comments above promise.
 */
const emitted = JSON.stringify(out);
for (const p of posts) {
  const sample = normaliseRun(p.text).slice(0, 40);
  if (sample.length >= 40 && emitted.includes(sample)) {
    console.error("\nREFUSING: post text leaked into the shingle file.");
    process.exit(1);
  }
}

console.log(`\n  Reference shingles\n`);
console.log(`  ${out.posts} posts across ${out.writers.length} writer(s)`);
console.log(`  ${runs} runs of ${SHINGLE_WORDS} words, ${out.distinct} distinct`);
console.log(`  ${EXEMPT.length} exempted as ordinary English`);
console.log(`  ${(emitted.length / 1e6).toFixed(1)} MB, no readable post text in it`);

if (!APPLY) {
  console.log(`\n  Dry run. Nothing written. Pass --apply to write data/josh/reference-shingles.json\n`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, emitted);
console.log(`\n  written: data/josh/reference-shingles.json\n`);
