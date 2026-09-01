#!/usr/bin/env node
/**
 * CLAUSE 17 — THE SCORECARD.
 *
 *   node eval/acceptance.mjs
 *
 * Answers "how far along is this?" from the live database, for all twelve component tests and the
 * overall test in 17a. Until this existed, nobody could answer that question without querying by
 * hand, which meant the contractual finish line was invisible to both parties.
 *
 * The scoring lives in `supabase/functions/_shared/acceptance.ts` and is shared verbatim with
 * `worker-ops`, which folds the same summary into Josh's monthly message. Node 22+ strips types
 * natively, so the module is imported rather than copied — `app/lib/diff.ts` had to be copied and
 * needed its own test to stop the two drifting.
 *
 * Reads through PostgREST with the service role, the same way `gate-acceptance.mjs` does. Set
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or put them in a gitignored `eval/.env`.
 */

import { overall, score, summarise, voiceGuideWarning } from "../supabase/functions/_shared/acceptance.ts";
import { loadEnv } from "./env.mjs";
import { gatherAll } from "./gather.mjs";

const { url: URL_BASE, key: KEY } = loadEnv();

async function q(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const MARK = { passing: "PASS", failing: "FAIL", blocked: "----" };

const counts = await gatherAll(q);

const results = score(counts);
const finish = overall(counts);

console.log("\nCLAUSE 17 — COMPONENT TESTS");
console.log("Verification fixtures excluded. Every number read from the live database.\n");

for (const r of [...results, finish]) {
  console.log(`  ${MARK[r.verdict]}  ${r.n.padEnd(4)} ${r.name}`);
  console.log(`        needs:  ${r.requires}`);
  console.log(`        actual: ${r.actual}`);
  if (r.blocker) console.log(`        blocked on: ${r.blocker}`);
  console.log("");
}

console.log(`  ${summarise(results)}`);
console.log(`  17a: ${finish.actual}\n`);

const warning = voiceGuideWarning(counts);
if (warning) console.log(`  NOTE  ${warning}\n`);

// Non-zero while anything is outstanding, so this can gate a handover checklist rather than being
// read by eye and misremembered.
process.exit(results.every((r) => r.verdict === "passing") && finish.verdict === "passing" ? 0 : 1);
