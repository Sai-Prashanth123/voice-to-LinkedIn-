/**
 * What the run says, and what it writes down.
 *
 * The report is the deliverable. A run that says "100 passed" and shows nothing is worth about as
 * much as the voice_guide check that passed eighteen drafts — so every line carries its clause, and
 * anything not passing carries the reason and what was actually observed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = resolve(HERE, "..", "results");

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (on, off) => (s) => (enabled ? `[${on}m${s}[${off}m` : s);
const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  green: wrap(32, 39),
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  grey: wrap(90, 39),
};

const unicode = enabled && (process.platform !== "win32" || Boolean(process.env.WT_SESSION));
const MARK = {
  pass: c.green(unicode ? "✓" : "PASS"),
  fail: c.red(unicode ? "✗" : "FAIL"),
  skipped: c.yellow(unicode ? "–" : "SKIP"),
  blocked: c.yellow(unicode ? "·" : "BLOK"),
};

const STAGES = {
  0: "Wiring and deployment",
  1: "Inputs",
  2: "Interview",
  3: "Idea bank",
  4: "Selection",
  5: "Drafting",
  6: "The gate",
  7: "Calendar",
  8: "Review and publish",
  9: "Learning",
  X: "Cross-reader consistency",
  M: "Model-driven",
};

export function printResults(records, { verbose = false } = {}) {
  const byStage = new Map();
  for (const r of records) {
    if (!byStage.has(r.stage)) byStage.set(r.stage, []);
    byStage.get(r.stage).push(r);
  }

  for (const [stage, rows] of byStage) {
    const failed = rows.filter((r) => r.verdict === "fail").length;
    const head = `${String(stage).padStart(2)} · ${STAGES[stage] ?? "?"}`;
    console.log(`\n  ${c.bold(head)}  ${c.grey(`${rows.length} case(s)`)}${failed ? c.red(`  ${failed} failing`) : ""}`);

    for (const r of rows) {
      console.log(`    ${MARK[r.verdict]} ${c.grey(r.id.padEnd(7))} ${r.name}`);
      if (r.verdict !== "pass") {
        console.log(`         ${c.grey(r.clause.padEnd(6))} ${c.yellow(r.reason ?? "")}`);
      }
      if (verbose && r.evidence?.checks?.length) {
        for (const check of r.evidence.checks) {
          console.log(`         ${c.dim("·")} ${c.dim(check.what)}`);
        }
      }
    }
  }
}

/**
 * The summary.
 *
 * Skipped and blocked are printed separately and never folded into a pass count. A skip means a
 * case could not find what it needed and therefore proved nothing — reporting it as green is the
 * exact failure this harness was built to stop.
 */
export function printSummary(records, { started }) {
  const n = (v) => records.filter((r) => r.verdict === v).length;
  const pass = n("pass");
  const fail = n("fail");
  const skipped = n("skipped");
  const blocked = n("blocked");
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n  ${"─".repeat(58)}`);
  console.log(
    `  ${c.bold(`${pass} passed`)}` +
      (fail ? c.red(`, ${fail} failed`) : ", 0 failed") +
      (skipped ? c.yellow(`, ${skipped} skipped`) : "") +
      (blocked ? c.yellow(`, ${blocked} blocked`) : "") +
      c.grey(`  ${secs}s`),
  );

  if (skipped) {
    console.log(`\n  ${c.yellow("Skipped — these proved nothing:")}`);
    for (const r of records.filter((x) => x.verdict === "skipped")) {
      console.log(`    ${c.grey(r.id)}  ${r.name}\n         ${c.dim(r.reason)}`);
    }
  }
  if (blocked) {
    console.log(`\n  ${c.yellow("Blocked — waiting on something outside the code:")}`);
    for (const r of records.filter((x) => x.verdict === "blocked")) {
      console.log(`    ${c.grey(r.id)}  ${r.name}\n         ${c.dim(r.reason)}`);
    }
  }
  if (fail) {
    console.log(`\n  ${c.red("Failed:")}`);
    for (const r of records.filter((x) => x.verdict === "fail")) {
      console.log(`    ${c.grey(r.id)}  ${r.name}\n         ${c.red(r.reason)}`);
    }
  }
  console.log("");
  return fail;
}

/** The provenance file. Written every run, whatever the outcome. */
export function writeProvenance(records, environment) {
  mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(RESULTS, `e2e-${stamp}.json`);
  const body = {
    at: new Date().toISOString(),
    environment,
    totals: {
      pass: records.filter((r) => r.verdict === "pass").length,
      fail: records.filter((r) => r.verdict === "fail").length,
      skipped: records.filter((r) => r.verdict === "skipped").length,
      blocked: records.filter((r) => r.verdict === "blocked").length,
    },
    cases: records,
  };
  writeFileSync(path, JSON.stringify(body, null, 2));
  return path;
}
