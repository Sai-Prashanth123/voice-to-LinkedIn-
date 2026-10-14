#!/usr/bin/env node
/**
 * The end-to-end proof: every stage of the pipeline, with evidence.
 *
 *   node eval/e2e/run.mjs                 deterministic + live, no model spend
 *   node eval/e2e/run.mjs --stage 6       one stage
 *   node eval/e2e/run.mjs --live-only     deployment checks alone, seconds
 *   node eval/e2e/run.mjs --with-model    adds the model-driven journeys
 *   node eval/e2e/run.mjs --verbose       print every assertion, not just the verdict
 *   node eval/e2e/run.mjs --pglite        force the no-docker engine, even if docker is up
 *   node eval/e2e/run.mjs --keep          leave the throwaway database up afterwards
 *   node eval/e2e/run.mjs --json          provenance path only
 *
 * WHAT MAKES THIS DIFFERENT FROM THE UNIT TESTS
 *
 * The unit tests prove functions. This proves the joins between them — which is where every bug in
 * this build has actually been. It runs the deterministic cases against a database built from the
 * 28 migrations and thrown away, and the live cases against the deployed project, because some
 * failures only exist in a deployment: eight of ten Edge Functions were found running shared code
 * three days old, and no test in the repo could have said so.
 *
 * Exits non-zero on any failure. Skipped and blocked do not fail the run, but they are always
 * printed with their reason — a skip nobody reads is a pass nobody earned.
 */

import { execFileSync } from "node:child_process";

import { assertUniqueIds, runCase } from "./harness.mjs";
import { startLocal, stopLocal } from "./local.mjs";
import { startPglite, stopPglite } from "./pglite.mjs";
import { openLive } from "./live.mjs";
import { printResults, printSummary, writeProvenance } from "./report.mjs";
import { allCases } from "./cases/index.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const ONLY_STAGE = valueOf("--stage");
const ONLY_CASE = valueOf("--case");
const LIVE_ONLY = has("--live-only");
const WITH_MODEL = has("--with-model");
const VERBOSE = has("--verbose");
const KEEP = has("--keep");
const JSON_ONLY = has("--json");
const PGLITE_ONLY = has("--pglite");

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function wanted(c) {
  if (ONLY_CASE) return c.id === ONLY_CASE;
  if (ONLY_STAGE !== undefined && String(c.stage) !== String(ONLY_STAGE)) return false;
  if (c.tier === "model" && !WITH_MODEL) return false;
  if (LIVE_ONLY && c.tier !== "live") return false;
  return true;
}

async function main() {
  const started = Date.now();
  const cases = assertUniqueIds(allCases()).filter(wanted);

  if (cases.length === 0) {
    console.error("No cases matched. Check --stage / --case.");
    return 2;
  }

  const say = JSON_ONLY ? () => {} : (s) => console.log(`  ${s}`);
  if (!JSON_ONLY) {
    console.log(`\n  Content system — end to end`);
    console.log(`  ${cases.length} case(s) · ${gitSha()}\n`);
  }

  // Only stand up the database if something actually needs it. --live-only should take seconds.
  const needsLocal = cases.some((c) => c.tier === "deterministic");
  const needsLive = cases.some((c) => c.tier === "live" || c.tier === "model");

  /*
   * DOCKER FIRST, THEN PGLITE, THEN SKIP.
   *
   * Docker first because it runs the real pgvector, so it is the only engine on which every case
   * is meaningful. PGlite second because the alternative was nothing: `startLocal` returns null on
   * a machine without Docker running, and the deterministic tier — 103 of 109 cases — has been
   * skipping silently for weeks as a result. A second engine that runs most of them beats a first
   * engine that runs none.
   *
   * Which one answered is reported, loudly, both ways. A pass on pglite is a pass against a
   * pgvector substitute, and a reader of the report has to be able to see that without digging.
   */
  let db = null;
  if (needsLocal) {
    // --pglite exists so the second engine is reachable on a machine where Docker IS up. Without
    // it the fallback is only ever exercised by accident, on the machines least able to report it.
    db = PGLITE_ONLY ? null : await startLocal({ log: say });
    if (!db) {
      say(PGLITE_ONLY
        ? "--pglite: skipping docker on purpose."
        : "Docker is not running — falling back to pglite (real Postgres, substitute pgvector).");
      db = await startPglite({ log: say });
      if (db) {
        say("Running on pglite. Cases needing a real vector index will skip, not pass.");
      } else {
        say("Neither Docker nor pglite is available — deterministic cases will be skipped, not passed.");
        say("  npm install @electric-sql/pglite --prefix eval   # no daemon, no container");
      }
    }
  }

  const live = needsLive ? await openLive() : null;
  if (needsLive && !live && !JSON_ONLY) {
    say("No live credentials — live cases will be skipped, not passed.");
  }

  const context = { db, live, withModel: WITH_MODEL };
  const records = [];

  for (const spec of cases) {
    // A missing environment is a SKIP with a reason, never a silent pass. Both of these have
    // already happened in this repo: tests that returned early on an empty database and reported
    // green, and a harness that could not tell "nothing to do" from "everything is rate-limited".
    if (spec.tier === "deterministic" && !db) {
      records.push({
        ...pick(spec),
        verdict: "skipped",
        reason: "Docker is not running, so the throwaway database could not be built",
        evidence: { checks: [], queries: [], observed: {} },
        duration_ms: 0,
        at: new Date().toISOString(),
      });
      continue;
    }
    if ((spec.tier === "live" || spec.tier === "model") && !live) {
      records.push({
        ...pick(spec),
        verdict: "skipped",
        reason: "no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — see eval/.env.example",
        evidence: { checks: [], queries: [], observed: {} },
        duration_ms: 0,
        at: new Date().toISOString(),
      });
      continue;
    }
    records.push(await runCase(spec, context));
  }

  // Both, unconditionally: each is a no-op when it was not the engine that answered, and asking
  // which one ran would be a third place that has to know.
  await stopLocal({ keep: KEEP });
  await stopPglite();

  const provenance = writeProvenance(records, {
    git_sha: gitSha(),
    local_database: Boolean(db),
    live_project: live?.url ?? null,
    with_model: WITH_MODEL,
    node: process.version,
  });

  if (JSON_ONLY) {
    console.log(provenance);
  } else {
    printResults(records, { verbose: VERBOSE });
    printSummary(records, { started });
    console.log(`  Evidence: ${provenance}\n`);
    if (KEEP) console.log(`  Database left running as ${db?.container}. Remove with: docker rm -f ${db?.container}\n`);
  }

  return records.some((r) => r.verdict === "fail") ? 1 : 0;
}

const pick = (s) => ({
  id: s.id,
  stage: s.stage,
  clause: s.clause,
  tier: s.tier,
  name: s.name,
});

process.exitCode = await main();
