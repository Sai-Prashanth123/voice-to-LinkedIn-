#!/usr/bin/env node
/**
 * Measure a batch of drafts the way the system would, without filing any of them.
 *
 *   node scripts/soak-measure.mjs
 *
 * WHY THIS EXISTS
 *
 * Every quality claim about this system so far rests on one or two posts read by eye. That is how
 * the 29 October failure got through: four drafts for four different moments opened on the
 * identical sentence, and nobody noticed because nobody looked at four at once.
 *
 * So this takes a hundred, runs the real checks over all of them, and reports the distribution
 * rather than an example. Every tool it calls is pure or read-only — `measure_draft`, `scrub_draft`,
 * `scan`, `selfEcho`, the shingle guard. Nothing is written to Josh's bank, which matters because
 * clause 6.3 means a test draft filed there could never be removed.
 *
 * WHAT IT CANNOT TELL YOU. The nine gate checks are model judgements and are not run here — this
 * measures what is mechanical. A post can pass everything below and still fail `anyone_else`,
 * which is the check that matters most and the one no script can stand in for.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDb } from "../mcp-server/db.mjs";
import { measureTools } from "../mcp-server/tools/measure.mjs";
import { scrubTools } from "../mcp-server/tools/scrub.mjs";
import { selfEcho, firstLine } from "../mcp-server/self-echo.mjs";
import { scan, HIGH_CONFIDENCE } from "../mcp-server/aitells.mjs";
import { shinglesOf, normaliseRun } from "../supabase/functions/_shared/shingles.ts";
import { median, sd as stdev } from "../scripts/lib/prose.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "scripts", "soak");

const env = readFileSync(join(ROOT, "eval", ".env"), "utf8");
const f = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
const creds = { url: f("SUPABASE_URL"), key: f("SUPABASE_SERVICE_ROLE_KEY") };
const db = createDb(creds);
const ctx = { db, url: creds.url };
const measure = measureTools.find((t) => t.name === "measure_draft");
const scrub = scrubTools.find((t) => t.name === "scrub_draft");

/* ── Load ─────────────────────────────────────────────────────────────────── */

const material = JSON.parse(readFileSync(join(DIR, "material.json"), "utf8"));
const byMoment = Object.fromEntries(material.map((m) => [m.moment_id, m]));

const posts = [];
for (const file of readdirSync(DIR).filter((n) => n.endsWith(".jsonl"))) {
  const lines = readFileSync(join(DIR, file), "utf8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const p = JSON.parse(line);
      if (p?.body?.trim()) posts.push({ ...p, batch: file.replace(/\.jsonl$/, "") });
    } catch {
      console.log("  unparseable line in " + file);
    }
  }
}
if (!posts.length) {
  console.error("\n  No posts found in " + DIR + ". Nothing to measure.\n");
  process.exit(1);
}

console.log("\n  " + posts.length + " posts, " + new Set(posts.map((p) => p.batch)).size +
  " batches, " + new Set(posts.map((p) => p.moment_id)).size + " moments\n");

/* ── Per post ─────────────────────────────────────────────────────────────── */

const rows = [];
for (const p of posts) {
  const m = await measure.handler({ body: p.body }, ctx);
  const s = await scrub.handler({ body: p.body }, ctx);
  const mat = byMoment[p.moment_id];

  // The one rule the system can check mechanically and absolutely: a name he has not cleared.
  const leaked = (mat?.must_not_name ?? []).filter((n) =>
    new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(p.body)
  );

  rows.push({
    ...p,
    words: m.words,
    paragraphs: m.paragraphs,
    openingWords: m.shape.opening_words,
    openingShape: m.surface.opening_shape,
    closeShape: m.surface.close_shape,
    emDashes: m.surface.em_dashes,
    semicolons: (p.body.match(/;/g) || []).length,
    sd: m.rhythm.sentence_words_sd,
    turn: m.reading_order.turn_marker_found,
    turnAt: m.reading_order.turn_at,
    foldLines: (m.fold.what_he_would_see || "").split("\n").filter(Boolean).length,
    hookAboveFold: m.fold.hook_lands_above_it,
    refuses: m.will_refuse.count || 0,
    refuseWhy: m.will_refuse.why ?? null,
    tells: m.ai_tells.total,
    blockingTells: scan(p.body).findings.filter((x) => x.blocking !== false && HIGH_CONFIDENCE.has(x.rule)).length,
    scrubFindings: s.counts?.total ?? 0,
    leakedNames: leaked,
    flags: m.flags ?? [],
  });
}

/* ── Report ───────────────────────────────────────────────────────────────── */

const n = rows.length;
const pct = (c) => ((100 * c) / n).toFixed(0) + "%";
const bad = (c) => (c === 0 ? "  ok" : "  <-- " + c);

console.log("  HARD RULES — these are not preferences\n");
console.log("    would create_draft REFUSE it   " + pct(rows.filter((r) => r.refuses > 0).length) +
  bad(rows.filter((r) => r.refuses > 0).length));
console.log("    uncleared name in the body     " + pct(rows.filter((r) => r.leakedNames.length).length) +
  bad(rows.filter((r) => r.leakedNames.length).length));
console.log("    em dash                        " + pct(rows.filter((r) => r.emDashes > 0).length) +
  bad(rows.filter((r) => r.emDashes > 0).length));
console.log("    semicolon                      " + pct(rows.filter((r) => r.semicolons > 0).length) +
  bad(rows.filter((r) => r.semicolons > 0).length));
console.log("    opens on a question            " + pct(rows.filter((r) => /\?\s*$/.test(firstLine(r.body))).length) +
  bad(rows.filter((r) => /\?\s*$/.test(firstLine(r.body))).length));

console.log("\n  CRAFT — distributions, not pass marks\n");
const sds = rows.map((r) => r.sd);
console.log("    sentence variation   median " + median(sds) +
  "   inside 7.1-18.8: " + pct(rows.filter((r) => r.sd >= 7.1 && r.sd <= 18.8).length));
console.log("    has a marked turn    " + pct(rows.filter((r) => r.turn).length) +
  "   (corpus 45%)   median position " +
  Math.round(100 * (median(rows.filter((r) => r.turnAt != null).map((r) => r.turnAt)) || 0)) + "%");
console.log("    paragraphs in 8-21   " + pct(rows.filter((r) => r.paragraphs >= 8 && r.paragraphs <= 21).length) +
  "   median " + median(rows.map((r) => r.paragraphs)));
console.log("    words in 140-400     " + pct(rows.filter((r) => r.words >= 140 && r.words <= 400).length) +
  "   median " + median(rows.map((r) => r.words)));
console.log("    first line <= 30w    " + pct(rows.filter((r) => r.openingWords <= 30).length) +
  "   median " + median(rows.map((r) => r.openingWords)));
console.log("    hook above the fold  " + pct(rows.filter((r) => r.hookAboveFold).length));
const foldTally = {};
for (const r of rows) foldTally[Math.min(r.foldLines, 4)] = (foldTally[Math.min(r.foldLines, 4)] ?? 0) + 1;
console.log("    fold lines the hook uses  " +
  [1, 2, 3, 4].map((k) => k + (k === 4 ? "+" : "") + ":" + (foldTally[k] ?? 0)).join("  "));
console.log("    AI tells   median " + median(rows.map((r) => r.tells)) +
  "   max " + Math.max(...rows.map((r) => r.tells)) +
  "   blocking: " + rows.filter((r) => r.blockingTells > 0).length);

console.log("\n  VARIETY — the 29 October failure, checked across the whole set\n");
const shapeTally = {};
for (const r of rows) shapeTally[r.openingShape] = (shapeTally[r.openingShape] ?? 0) + 1;
console.log("    opening shapes  " + Object.entries(shapeTally).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => k + " " + v).join(", "));
const closeTally = {};
for (const r of rows) closeTally[r.closeShape] = (closeTally[r.closeShape] ?? 0) + 1;
console.log("    closes          " + Object.entries(closeTally).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => k + " " + v).join(", "));

// Identical openings, across moments and within.
const byOpening = {};
for (const r of rows) {
  const key = normaliseRun(firstLine(r.body));
  (byOpening[key] ??= []).push(r);
}
const dupes = Object.values(byOpening).filter((g) => g.length > 1);
console.log("\n    identical first lines      " + dupes.length + " group(s)");
for (const g of dupes.slice(0, 6)) {
  const across = new Set(g.map((r) => r.moment_id)).size > 1;
  console.log("      x" + g.length + (across ? "  ACROSS MOMENTS " + [...new Set(g.map((r) => r.moment_id))].join(",") : "  same moment") +
    "   " + firstLine(g[0].body).slice(0, 62));
}

// Shared seven-word runs between posts of DIFFERENT moments — the self-echo check, run over the set.
let crossPairs = 0;
const shared = new Map();
const runsOf = rows.map((r) => ({ r, runs: new Set(shinglesOf(r.body)) }));
for (let i = 0; i < runsOf.length; i++) {
  for (let j = i + 1; j < runsOf.length; j++) {
    if (runsOf[i].r.moment_id === runsOf[j].r.moment_id) continue;
    let hits = 0;
    for (const run of runsOf[i].runs) if (runsOf[j].runs.has(run)) { hits++; if (hits > 2) break; }
    if (hits > 2) {
      crossPairs++;
      const k = runsOf[i].r.moment_id + " / " + runsOf[j].r.moment_id;
      shared.set(k, (shared.get(k) ?? 0) + 1);
    }
  }
}
console.log("    post pairs from DIFFERENT moments sharing 3+ seven-word runs: " + crossPairs);
for (const [k, v] of [...shared.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log("      moments " + k + "   " + v + " pair(s)");
}

console.log("\n  THE WORST OF THEM\n");
const worst = rows
  .map((r) => ({ r, score: (r.refuses > 0 ? 10 : 0) + (r.leakedNames.length ? 10 : 0) +
    (r.sd < 7.1 ? 2 : 0) + (!r.turn ? 1 : 0) + (r.foldLines >= 3 ? 1 : 0) + r.tells }))
  .sort((a, b) => b.score - a.score).slice(0, 8);
for (const { r, score } of worst) {
  const faults = [];
  if (r.refuses) faults.push("REFUSED:" + (r.refuseWhy?.[0] ?? "").slice(0, 40));
  if (r.leakedNames.length) faults.push("NAME:" + r.leakedNames.join("/"));
  if (r.sd < 7.1) faults.push("sd " + r.sd);
  if (!r.turn) faults.push("no turn");
  if (r.foldLines >= 3) faults.push("hook eats " + r.foldLines + " lines");
  if (r.tells) faults.push(r.tells + " tells");
  console.log("    m" + String(r.moment_id).padEnd(4) + "[" + r.batch + "]  " + faults.join(", "));
  console.log("        " + firstLine(r.body).slice(0, 76));
}
console.log("");
