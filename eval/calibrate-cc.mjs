#!/usr/bin/env node
/**
 * Calibration harness for the Claude Code filter (4.4.2, 4.4.3).
 *
 * The high bar cannot be guessed at — it has to be set against a real corpus. Run this on Josh's
 * machine before trusting the default threshold:
 *
 *   node eval/calibrate-cc.mjs
 *
 * It reports how many sessions clear each stage, so the threshold is chosen from data rather than
 * assumed. Target roughly 1-3 candidates a week. Ten a day is worse than nothing.
 */

import { assess, DECISION_MARKERS, findSessions, readSession } from "../cc-agent/index.mjs";
import os from "node:os";
import path from "node:path";
import fsSync from "node:fs";

const dir = path.join(os.homedir(), ".claude", "projects");
const files = findSessions(dir);

// How long this corpus actually covers. The weekly rate used to be hard-coded at ~160 sessions a
// week, which is roughly right for Josh and wrong for anyone else — on the machine this was first
// run on it overstated every rate sixteenfold. A calibration harness that reports a confident wrong
// number is worse than one that reports nothing.
const times = files.map((f) => fsSync.statSync(f).mtimeMs).sort((a, b) => a - b);
const spanWeeks = times.length > 1
  ? Math.max((times[times.length - 1] - times[0]) / (7 * 86_400_000), 1 / 7)
  : 1;
const perWeek = files.length / spanWeeks;

console.log(
  `Corpus: ${files.length} sessions over ${spanWeeks.toFixed(1)} weeks ` +
    `(${perWeek.toFixed(1)} a week)\n`,
);

let parsed = 0, enoughTurns = 0, hasVoice = 0, hasReflection = 0;
const scores = [];
const markerHits = new Map();

for (const f of files) {
  let s;
  try {
    s = await readSession(f);
  } catch {
    continue;
  }
  parsed++;
  if (s.turns >= 4) enoughTurns++;
  if (s.userMessages.length >= 3) hasVoice++;

  const text = s.userMessages.join(" ").toLowerCase();
  const hits = DECISION_MARKERS.filter((m) => text.includes(m));
  if (hits.length > 0) hasReflection++;
  for (const h of hits) markerHits.set(h, (markerHits.get(h) ?? 0) + 1);

  const v = assess(s);
  scores.push({ file: path.basename(f, ".jsonl"), score: v.score ?? 0 });
}

const pct = (n) => `${((n / parsed) * 100).toFixed(1)}%`;
console.log("Funnel:");
console.log(`  parsed                       ${parsed}`);
console.log(`  >= 4 turns                   ${enoughTurns} (${pct(enoughTurns)})`);
console.log(`  >= 3 of Josh's own messages  ${hasVoice} (${pct(hasVoice)})`);
console.log(`  any reflective language      ${hasReflection} (${pct(hasReflection)})   <-- necessary condition`);

console.log("\nMost common reflection markers:");
for (const [m, n] of [...markerHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${m}`);
}

const nonZero = scores.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
console.log(`\nScored above zero: ${nonZero.length} of ${parsed} (${pct(nonZero.length)})`);
console.log(
  `\nThreshold options, against this corpus's measured rate of ${perWeek.toFixed(1)}/week:`,
);
for (const t of [6, 9, 12, 15, 18, 21, 25]) {
  const n = nonZero.filter((s) => s.score >= t).length;
  const weekly = parsed > 0 ? ((n / parsed) * perWeek).toFixed(2) : "0";
  console.log(`  >=${String(t).padStart(3)}  ${String(n).padStart(4)} sessions (${pct(n)})  ~${weekly}/week`);
}

// A corpus this thin cannot choose a threshold, and saying so is the whole job. 4.4.3 makes the
// cost asymmetric — too many candidates and Josh stops reading them, which kills the input outright
// — so a table built on three data points is worse than no table at all.
if (nonZero.length < 10 || parsed < 100) {
  console.log(
    "\nNOT ENOUGH TO CALIBRATE ON.\n" +
      `  ${parsed} sessions, ${nonZero.length} scoring above zero. The options above are a handful\n` +
      "  of data points wearing a table: every threshold from 6 to 12 selects the same single\n" +
      "  session, which tells you nothing about where the bar belongs.\n" +
      "  Run this on the machine that does the real work, over a few hundred sessions, before\n" +
      "  trusting CC_MIN_SCORE.",
  );
}

console.log("\nTop 10 by score:");
for (const s of nonZero.slice(0, 10)) console.log(`  ${String(s.score).padStart(4)}  ${s.file}`);
