#!/usr/bin/env node
/**
 * Calibrate the borrowed-phrase check before it is allowed to refuse anything.
 *
 *   node scripts/check-shingle-noise.mjs
 *
 * WHY THIS RUNS FIRST
 *
 * A blocking check that misfires stops all of Josh's work, which is worse than the risk it covers.
 * So before `create_draft` is allowed to refuse on a borrowed run, the same check runs over every
 * draft already in the system and every post he has published.
 *
 * Those are the ideal control group. Each was written before the 1,900-post corpus existed and most
 * before any of it did, so Josh cannot have borrowed from a post the system had not collected. Any
 * hit here is therefore a false positive by construction, and tells us exactly one thing: that run
 * of words is ordinary English, not anybody's writing, and belongs in EXEMPT.
 *
 * A clean run means the check can block. A noisy one means it ships advisory until the noise is
 * named.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { borrowedRuns, hashRun, shinglesOf } from "../supabase/functions/_shared/shingles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const envText = ["eval/.env", ".env", "mcp-server/.env"]
  .map((p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } })
  .join("\n");
const field = (k) =>
  (process.env[k] ?? (envText.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1] ?? "").trim();
const url = field("SUPABASE_URL").replace(/\/+$/, "");
const key = field("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }

async function rows(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) { console.error(`  ${path}: ${res.status} ${await res.text()}`); process.exit(1); }
  return res.json();
}

/*
 * The same question create_draft asks, the same way: send this text's own run hashes and keep the
 * ones that come back known. Asking it differently here would calibrate something other than the
 * check that actually runs.
 */
async function knownRuns(text) {
  const wanted = [...new Set(shinglesOf(text).map(hashRun))];
  const known = new Set();
  for (let i = 0; i < wanted.length; i += 150) {
    const batch = wanted.slice(i, i + 150).join(",");
    for (const r of await rows(`reference_shingles?select=hash&hash=in.(${batch})&limit=150`)) {
      known.add(r.hash);
    }
  }
  return known;
}

const indexSize = (await rows("reference_shingles?select=hash&limit=1")).length
  ? "stored"
  : "EMPTY — nothing will be caught";

const drafts = await rows("drafts?select=id,body&limit=2000");
const published = await rows("published_archive?select=id,body&limit=2000");

const corpus = [
  ...drafts.map((d) => ({ what: `draft ${d.id}`, body: d.body })),
  ...published.map((p) => ({ what: `published ${p.id}`, body: p.body })),
].filter((x) => typeof x.body === "string" && x.body.length > 0);

console.log(`\n  Borrowed-phrase calibration\n`);
console.log(`  index: ${indexSize}`);
console.log(`  control group: ${drafts.length} draft(s), ${published.length} published post(s)\n`);

let hitCount = 0;
const runsSeen = new Map();

for (const item of corpus) {
  const hits = borrowedRuns(item.body, await knownRuns(item.body));
  if (hits.length === 0) continue;
  hitCount++;
  console.log(`  ${item.what}: ${hits.length} run(s)`);
  for (const h of hits) {
    console.log(`      "${h}"`);
    runsSeen.set(h, (runsSeen.get(h) ?? 0) + 1);
  }
}

console.log(`\n  ${"─".repeat(66)}`);
if (hitCount === 0) {
  console.log(`  Clean. 0 of ${corpus.length} pieces of Josh's own writing match a reference run.`);
  console.log(`  The check can refuse a draft without risking a false refusal.\n`);
} else {
  console.log(`  ${hitCount} of ${corpus.length} matched. Every one is a false positive by construction.`);
  console.log(`  Add these to EXEMPT in scripts/build-reference-shingles.mjs and rebuild, or ship`);
  console.log(`  the check advisory until they are named:\n`);
  for (const [run, n] of [...runsSeen].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}x  "${run}"`);
  }
  console.log();
}
