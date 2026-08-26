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

const dir = path.join(os.homedir(), ".claude", "projects");
const files = findSessions(dir);
console.log(`Corpus: ${files.length} sessions\n`);

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
console.log("\nThreshold options (weekly rate assumes ~160 sessions/week):");
for (const t of [6, 9, 12, 15, 18, 21, 25]) {
  const n = nonZero.filter((s) => s.score >= t).length;
  const weekly = parsed > 0 ? ((n / parsed) * 160).toFixed(1) : "0";
  console.log(`  >=${String(t).padStart(3)}  ${String(n).padStart(4)} sessions (${pct(n)})  ~${weekly}/week`);
}

console.log("\nTop 10 by score:");
for (const s of nonZero.slice(0, 10)) console.log(`  ${String(s.score).padStart(4)}  ${s.file}`);
