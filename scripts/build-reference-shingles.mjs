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
 *
 * WHY IT WRITES A TABLE AND NOT A FILE
 *
 * The first version wrote data/josh/reference-shingles.json and the MCP tools imported it, so that
 * it would be in the deployed module graph rather than a file that quietly goes missing on the
 * connector. Supabase refuses an edge function over 5MB and the index is 4.4MB, so that version
 * shipped nowhere — caught by the deploy, which is the right place to catch it.
 *
 * A table is the better answer regardless. The corpus grows; an index in a file needs a deploy to
 * catch up, and an index in a row does not.
 */

import { readFileSync } from "node:fs";
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

const all = [...hashes].sort();

/*
 * The guard sentinel-structure.mjs carries, for the same reason. What goes to the database must
 * contain no readable run of anybody's post, and if a bug ever put one there it has to fail loudly
 * rather than ship quietly, whatever the comments above promise. A hash is not text, so this cannot
 * fire — which is exactly why it is cheap to keep and worth keeping.
 */
const emitted = JSON.stringify(all);
for (const p of posts) {
  const sample = normaliseRun(p.text).slice(0, 40);
  if (sample.length >= 40 && emitted.includes(sample)) {
    console.error("\nREFUSING: post text leaked into the shingle index.");
    process.exit(1);
  }
}

console.log(`\n  Reference shingles\n`);
console.log(`  ${posts.length} posts across ${writers.size} writer(s)`);
console.log(`  ${runs} runs of ${SHINGLE_WORDS} words, ${all.length} distinct`);
console.log(`  ${EXEMPT.length} exempted as ordinary English`);
console.log(`  hashes are ${HASH_WIDTH} chars of base36; no readable post text in them`);

if (!APPLY) {
  console.log(`\n  Dry run. Nothing written. Pass --apply to store them.\n`);
  process.exit(0);
}

/*
 * MERGED, NOT REPLACED — and this used to be the other way round.
 *
 * It cleared the table first, so that "a run no longer anywhere in the corpus stops being a
 * borrowing". That reasoning needed a standing DELETE grant on service_role, which broke the
 * guarantee Josh has in writing that no application role can delete anything. The e2e harness
 * caught it: S0-04 and S3-04 both named this table. 0051 took the grant back.
 *
 * The case it was guarding against cannot happen the way it described: 0046 revoked DELETE on
 * reference_writer_posts from every role, so a post cannot leave the corpus.
 *
 * What remains is narrower and is accepted. A re-scrape upserts on activity_id, so a post CAN come
 * back worded differently, and shingles from the old wording would linger — a draft could then be
 * refused for a run nobody holds any more. The refusal quotes the run, so a human reading it can
 * see the draft borrows nothing. Emptying the index is a migration now, which is a deliberate act
 * with a name on it rather than a permission a script carries every time it runs.
 *
 * merge-duplicates on the primary key makes this idempotent: re-running costs nothing and changes
 * nothing.
 */

const BATCH = 5000;
let stored = 0;
for (let i = 0; i < all.length; i += BATCH) {
  const chunk = all.slice(i, i + BATCH).map((hash) => ({ hash }));
  const res = await fetch(`${url}/rest/v1/reference_shingles`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) {
    console.error(`\n  failed at row ${i}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  stored += chunk.length;
  process.stdout.write(`\r  stored ${stored}/${all.length}`);
}

console.log(`\n\n  Stored. create_draft now refuses a draft that reuses one of these runs.\n`);
