#!/usr/bin/env node
/**
 * SOAK — drive the pipeline hard, then read what it rejected (tasks 4.1–4.3).
 *
 *   node eval/soak.mjs                 # report on every gate run so far
 *   node eval/soak.mjs --run           # push waiting drafts through the gate, then report
 *   node eval/soak.mjs --run --max 5   # ...at most five of them
 *   node eval/soak.mjs --reasons       # every rejection in full, grouped by check
 *
 * WHY THE REPORT IS THE DEFAULT
 *
 * Task 4.3 is "read every rejection", and reading them by hand in SQL is how the last finding was
 * made: `voice_guide` had failed 0 times in 18 runs, which looked like a lenient check and was
 * actually a check with nothing to judge against. That took a query nobody would think to write
 * twice. This makes it the thing you get for free.
 *
 * THE ONE DISTINCTION THIS FILE EXISTS TO PRESERVE
 *
 * Fixtures are separated from real drafts everywhere. Acceptance test 8 seeds ten deliberately
 * generic drafts and REQUIRES at least nine to be rejected, so their rejections are the system
 * working. Mixed into the same average they look like a drafter that cannot write, and the two
 * numbers pull in opposite directions.
 *
 * The second distinction is throttling. A run that stopped because the provider returned 429 has
 * not failed; it has not finished. Reporting those together is how a rate limit gets mistaken for a
 * quality problem, which has already happened once in this build.
 */

import { loadEnv } from "./env.mjs";

const { url: URL_BASE, key: KEY } = loadEnv();

const args = new Set(process.argv.slice(2));
const RUN = args.has("--run");
const REASONS = args.has("--reasons");
const MAX = Number(
  process.argv[process.argv.indexOf("--max") + 1] ?? (process.argv.includes("--max") ? 5 : 5),
);
/** Between dispatcher pokes. The free tiers limit requests per minute; hammering just burns them. */
const POKE_GAP_MS = Number(process.env.SOAK_GAP_MS ?? 20000);
const FIXTURE = "acceptance-fixture";

async function q(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${URL_BASE}/${path}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const pct = (n, d) => (d === 0 ? "  — " : `${String(Math.round((100 * n) / d)).padStart(3)}%`);
const bar = (n, d) => "█".repeat(d === 0 ? 0 : Math.round((10 * n) / d)).padEnd(10, "·");

/* ── Driving ──────────────────────────────────────────────────────────────── */

/**
 * Enqueue gate jobs for drafts that have not been fully judged, then poke the dispatcher.
 *
 * Deliberately does NOT create drafts. Fabricating material to soak against would measure the
 * fabricator, and 6.3 means every fixture written stays in the bank for good.
 */
async function run() {
  const [drafts, runs, existingJobs] = await Promise.all([
    q("drafts?select=id,moment_id,framework,gate_passed&order=created_at.desc&limit=100"),
    q("gate_runs?select=draft_id"),
    q("jobs?select=payload,status&type=eq.gate&status=in.(pending,running)"),
  ]);

  const judged = new Map();
  for (const r of runs) judged.set(r.draft_id, (judged.get(r.draft_id) ?? 0) + 1);
  const queued = new Set(existingJobs.map((j) => Number(j.payload?.draft_id)).filter(Boolean));

  const waiting = drafts.filter((d) => (judged.get(d.id) ?? 0) < 8).slice(0, MAX);
  if (waiting.length === 0) {
    console.log("Nothing waiting — every recent draft has all eight verdicts.\n");
    return;
  }

  console.log(`${waiting.length} draft(s) to push through:\n`);
  for (const d of waiting) {
    const done = judged.get(d.id) ?? 0;
    const already = queued.has(d.id);
    console.log(
      `  draft ${String(d.id).padEnd(5)} ${done}/8 judged` +
      `${d.framework === FIXTURE ? "  (fixture)" : ""}${already ? "  already queued" : ""}`,
    );
    if (!already) {
      await post("rest/v1/jobs", {
        type: "gate",
        payload: { draft_id: d.id, moment_id: d.moment_id, attempt: 1 },
        status: "pending",
        dedupe_key: `soak-${d.id}-${Date.now()}`,
      });
    }
  }

  console.log("\nDispatching. A 429 here is the free tier, not a failure — the queue backs off.\n");

  let throttled = 0;
  let completed = 0;

  for (let pass = 1; pass <= waiting.length + 2; pass += 1) {
    const res = await fetch(`${URL_BASE}/functions/v1/worker-dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await res.json().catch(() => ({}));
    const results = body.results ?? [];
    const rateLimited = results.filter((r) => /TRANSIENT/.test(r.error ?? "")).length;
    const ok = results.filter((r) => r.ok).length;
    throttled += rateLimited;
    completed += ok;

    console.log(
      `  pass ${String(pass).padStart(2)}  claimed ${String(body.claimed ?? 0).padStart(2)}` +
      `  done ${String(ok).padStart(2)}  throttled ${String(rateLimited).padStart(2)}`,
    );

    if ((body.claimed ?? 0) === 0) {
      // "Claimed nothing" has two meanings and they are opposite. Either the queue is empty, or
      // every job is in backoff after a rate limit and will not be claimable for minutes. Reporting
      // both as "0 done" is how a throttled run gets read as a finished one.
      const deferred = await q(
        "jobs?select=run_after&type=eq.gate&status=in.(pending,running)&order=run_after.asc",
      );
      if (deferred.length > 0) {
        const next = new Date(deferred[0].run_after);
        const mins = Math.max(0, Math.round((next - Date.now()) / 60000));
        console.log(
          `\n  Nothing claimable. ${deferred.length} gate job(s) are backed off after a rate\n` +
          `  limit; the earliest is runnable in about ${mins} minute(s). The queue will pick them\n` +
          `  up on its own — this is the free tier, not a stall.`,
        );
      } else {
        console.log("\n  Queue empty.");
      }
      break;
    }
    await new Promise((r) => setTimeout(r, POKE_GAP_MS));
  }

  console.log(`\n  ${completed} job(s) completed, ${throttled} throttled and retrying.\n`);
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

async function report() {
  const [runs, drafts] = await Promise.all([
    q("gate_runs?select=draft_id,check_key,passed,reason,model&order=created_at.desc"),
    q("drafts?select=id,framework,gate_passed"),
  ]);

  const byId = new Map(drafts.map((d) => [d.id, d]));
  const isFixture = (r) => byId.get(r.draft_id)?.framework === FIXTURE;

  const keys = [...new Set(runs.map((r) => r.check_key))];
  const stat = (rows) => ({
    total: rows.length,
    failed: rows.filter((r) => !r.passed).length,
    // A pass recorded without a model was never judged — the section it reads is empty.
    unjudged: rows.filter((r) => r.model === "none").length,
  });

  console.log("\nGATE — WHAT IT ACTUALLY REJECTS");
  console.log("Fixtures are drafts written to be generic on purpose. Their rejections are the");
  console.log("system working: acceptance test 8 needs at least 9 of 10 thrown out.\n");
  console.log("  check                real drafts        deliberately generic");
  console.log("  " + "─".repeat(64));

  for (const key of keys) {
    const rows = runs.filter((r) => r.check_key === key);
    const real = stat(rows.filter((r) => !isFixture(r)));
    const fix = stat(rows.filter(isFixture));
    console.log(
      `  ${key.padEnd(18)} ${bar(real.failed, real.total)} ${pct(real.failed, real.total)}` +
      ` (${String(real.failed).padStart(2)}/${String(real.total).padEnd(2)})   ` +
      `${bar(fix.failed, fix.total)} ${pct(fix.failed, fix.total)}` +
      ` (${fix.failed}/${fix.total})` +
      (real.unjudged + fix.unjudged > 0 ? `  ${real.unjudged + fix.unjudged} NOT JUDGED` : ""),
    );
  }

  // A check that has never rejected anything, anywhere, is the shape of the voice_guide bug: it
  // reads a library section that is not there, so every draft looks compliant.
  //
  // The first version of this flagged any check that passed every fixture, and immediately accused
  // names_cleared and identifiable — which is wrong. The fixtures are generic posts containing no
  // names at all, so passing them is the correct answer, and both checks reject real drafts
  // regularly. A warning that cries wolf is worse than none, because it trains you past the one
  // that matters.
  const silent = keys.filter((key) => {
    const all = runs.filter((r) => r.check_key === key);
    return all.length >= 8 && all.every((r) => r.passed) && !all.some((r) => r.model === "none");
  });
  if (silent.length > 0) {
    console.log(
      `\n  WARNING  ${silent.join(", ")} has never rejected anything, and is not recorded as\n` +
      `           unjudgeable. Either it is not strict enough, or it is reading a library\n` +
      `           section that is empty. Both look identical from the outside.`,
    );
  }

  const fixtures = drafts.filter((d) => d.framework === FIXTURE);
  const rejected = fixtures.filter((d) => d.gate_passed === false).length;
  const undecided = fixtures.filter((d) => d.gate_passed === null).length;
  if (fixtures.length > 0) {
    console.log(
      `\n  Acceptance test 8: ${rejected} of ${fixtures.length} fixtures rejected` +
      `${undecided > 0 ? `, ${undecided} still unjudged` : ""}. Needs 9 of 10 in one run.`,
    );
  }

  if (REASONS) {
    console.log("\n\nEVERY REJECTION, IN FULL\n");
    for (const key of keys) {
      const fails = runs.filter((r) => r.check_key === key && !r.passed);
      if (fails.length === 0) continue;
      console.log(`  ${key}  (${fails.length})`);
      for (const f of fails) {
        const tag = isFixture(f) ? "fixture" : "real   ";
        console.log(`    ${tag}  ${(f.reason ?? "").replace(/\s+/g, " ").slice(0, 150)}`);
      }
      console.log("");
    }
  } else {
    console.log("\n  Run with --reasons to read them in full.\n");
  }
}

if (RUN) await run();
await report();
