#!/usr/bin/env node
/**
 * Run the AI-tell detectors against the writers Josh chose, and publish how often they fire.
 *
 *   node scripts/calibrate-aitells.mjs
 *   node scripts/calibrate-aitells.mjs --rule 2C-17
 *
 * WHY THIS EXISTS
 *
 * Josh, 30 October: "it over-indexes on some rules where if something is repeating or it thinks is
 * repetitive, it'll try to cut it down because it doesn't want to sound repetitive… sometimes it
 * becomes too strict with repeating things."
 *
 * There was no way to answer that except by agreeing with it or disagreeing with it, because none
 * of these thresholds was ever measured. scrub.mjs says so about its own: "The thresholds are still
 * NOT corpus-derived, and 15 and 8 were nobody's measurement." 2C-5 uses a floor of 12 and a spread
 * of 5. 2C-16 uses 60 words and a quarter of the average. 2C-17 REFUSES a draft outright at four
 * bullets sharing an opening word. Each number was chosen by someone reading one bad draft.
 *
 * THE TEST THIS APPLIES
 *
 * The eight reference writers are, by Josh's own choice, examples of good writing. A detector that
 * fires on a large share of their posts is not detecting generated text — it is detecting writing.
 * That is the whole argument, and it is falsifiable: if a rule fires on 2% of their posts it is
 * well calibrated and his complaint is about something else.
 *
 * WHAT IT CANNOT TELL YOU. A rule firing often on this corpus does not prove the rule wrong — these
 * are LinkedIn posts by people who write to a formula, and some of them genuinely use the
 * constructions the library rules out. It proves the rule is not SPECIFIC, which for a rule that
 * refuses a draft is the thing that matters. Read a sample by eye before moving any number.
 *
 * This script writes nothing and changes nothing. It prints a table.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scan, RULES, HIGH_CONFIDENCE } from "../mcp-server/aitells.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONLY = (() => {
  const i = process.argv.indexOf("--rule");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const SENTINELS = new Set([
  "mattjbarker1", "demandjen1", "outboundphd", "juliacarter98",
  "ryanscarlin", "curtishowland", "amangrowth", "adam-treboutat",
  "tim-scheuer-91b005237",
]);

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  return { url: url.replace(/\/+$/, ""), key };
}

async function allPosts() {
  const { url, key } = credentials();
  const headers = { apikey: key, Authorization: "Bearer " + key };
  const out = [];
  for (let offset = 0;; offset += 1000) {
    const q = new URLSearchParams({
      select: "activity_id,handle,text",
      has_line_breaks: "is.true",
      order: "activity_id.asc",
      offset: String(offset),
      limit: "1000",
    });
    const res = await fetch(url + "/rest/v1/reference_writer_posts?" + q, { headers });
    if (!res.ok) { console.error("  read failed: " + res.status); process.exit(1); }
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out.filter((p) => SENTINELS.has(p.handle) && (p.text ?? "").trim());
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

console.log("\n  Reading the reference corpus...");
const posts = await allPosts();
console.log("  " + posts.length + " posts with line breaks, across " +
  new Set(posts.map((p) => p.handle)).size + " writers\n");

/*
 * One scan per post, then counted two ways: how many POSTS carry at least one finding for a rule,
 * and how many of those findings are BLOCKING. A blocking finding is the one that matters, because
 * prefile.mjs refuses the draft on it and nothing downstream can overrule that.
 */
const postsWithRule = new Map();
const blockingWithRule = new Map();
const byWriterRule = new Map();

for (const p of posts) {
  let findings;
  try {
    // scan() returns { findings, counts, measured } — the findings array is one field of it.
    findings = scan(p.text).findings ?? [];
  } catch (err) {
    console.error("  scan threw on " + p.activity_id + ": " + err.message);
    continue;
  }
  const seen = new Set();
  const seenBlocking = new Set();
  for (const f of findings) {
    seen.add(f.rule);
    if (f.blocking !== false && HIGH_CONFIDENCE.has(f.rule)) seenBlocking.add(f.rule);
  }
  for (const r of seen) {
    postsWithRule.set(r, (postsWithRule.get(r) ?? 0) + 1);
    const k = p.handle + "|" + r;
    byWriterRule.set(k, (byWriterRule.get(k) ?? 0) + 1);
  }
  for (const r of seenBlocking) blockingWithRule.set(r, (blockingWithRule.get(r) ?? 0) + 1);
}

const byHandle = {};
for (const p of posts) byHandle[p.handle] = (byHandle[p.handle] ?? 0) + 1;
const pct = (n, of) => (of ? ((100 * n) / of).toFixed(1) + "%" : "—");

const ranked = RULES
  .map((r) => ({
    id: r.id,
    name: r.name,
    refuses: HIGH_CONFIDENCE.has(r.id),
    posts: postsWithRule.get(r.id) ?? 0,
    blocking: blockingWithRule.get(r.id) ?? 0,
  }))
  .filter((r) => (ONLY ? r.id === ONLY : r.posts > 0))
  .sort((a, b) => b.posts - a.posts);

console.log("  HOW OFTEN EACH RULE FIRES ON THE WRITERS HE CHOSE\n");
console.log("    rule     fires on        refuses on   R  name");
for (const r of ranked) {
  console.log(
    "    " + r.id.padEnd(9) +
    (pct(r.posts, posts.length) + " (" + r.posts + ")").padEnd(16) +
    (r.blocking ? pct(r.blocking, posts.length) + " (" + r.blocking + ")" : "—").padEnd(13) +
    (r.refuses ? "x  " : "   ") +
    r.name,
  );
}

console.log("\n    R = the rule is in HIGH_CONFIDENCE, so a finding REFUSES the draft in");
console.log("        prefile.mjs rather than advising. 'refuses on' counts only blocking findings.");

/* ── The four repetition rules, per writer ────────────────────────────────── */

const REPETITION = ["2C-17", "2C-5", "2C-16", "2C-3"];
const shown = REPETITION.filter((id) => (postsWithRule.get(id) ?? 0) > 0 || !ONLY);

if (!ONLY && shown.length) {
  console.log("\n  THE FOUR REPETITION RULES, PER WRITER");
  console.log("  (Josh: \"it becomes too strict with repeating things\")\n");
  const handles = Object.keys(byHandle).sort();
  console.log("    writer            posts" + shown.map((id) => id.padStart(9)).join(""));
  for (const h of handles) {
    console.log(
      "    " + h.padEnd(18) + String(byHandle[h]).padStart(5) +
      shown.map((id) => pct(byWriterRule.get(h + "|" + id) ?? 0, byHandle[h]).padStart(9)).join(""),
    );
  }
  console.log(
    "    " + "ALL".padEnd(18) + String(posts.length).padStart(5) +
    shown.map((id) => pct(postsWithRule.get(id) ?? 0, posts.length).padStart(9)).join(""),
  );

  for (const id of shown) {
    const rule = RULES.find((r) => r.id === id);
    if (rule) {
      console.log("\n    " + id + "  " + rule.name +
        (HIGH_CONFIDENCE.has(id) ? "   [REFUSES A DRAFT]" : "   [advises only]"));
      console.log("      " + (rule.why ?? "").replace(/\s+/g, " "));
    }
  }
}

console.log(
  "\n  READ A SAMPLE BEFORE MOVING ANY NUMBER. A high rate says the rule is not specific, not\n" +
  "  that it is wrong: some of these writers do use the constructions the library rules out.\n" +
  "  The precedent is scripts/measure-structure.mjs, whose list detector read 90% on 51 posts\n" +
  "  and 83.8% when it was re-tested at scale.\n",
);
