#!/usr/bin/env node
/**
 * Measure the structural moves of the reference writers, at SENTENCE level.
 *
 *   node scripts/measure-structure.mjs
 *   node scripts/measure-structure.mjs --handle mattjbarker1
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE EXISTING COLUMNS
 *
 * `reference_writer_posts` already stores `opening_shape` and `close_shape`, and both are null for
 * 105 of 156 posts. That is deliberate and right: `load-reference-posts.mjs` nulls every shape
 * column when a post arrives without line breaks, because `lines[0]` is then the entire post and
 * `openingShape` would be classifying a whole essay as its own opening line. Storing that would be
 * an artefact dressed as a measurement.
 *
 * But an opening is a SENTENCE, not a paragraph, and so is a close. Sentence boundaries survive the
 * scrape even when paragraph boundaries do not. So the same two classifiers, fed the first and last
 * sentence instead of the first and last line, work on all 156 posts.
 *
 * ONE METHOD, ALL POSTS — WHICH IS THE WHOLE POINT
 *
 * This does NOT fill in the nulls and it does not write to the database. Mixing a paragraph-wise
 * reading of 51 posts with a sentence-wise reading of 105 would produce a distribution that means
 * nothing, because the two methods disagree in a known direction: `short_landing` fires at eight
 * words or fewer, and a last sentence clears that bar far more often than a last paragraph does.
 *
 * So every number here is sentence-wise across every post, and is reported as its own series. It is
 * comparable with itself. It is NOT comparable with the stored columns, and the two must never be
 * averaged together.
 *
 * WHAT IT IS FOR
 *
 * Josh's `frameworks` library section is 664 characters — the thinnest section he has, against 3,677
 * for hooks and 8,341 for voice — and it is the one that governs the structure he complained about
 * on 14 October. This produces the evidence for a replacement he can approve: measured off the eight
 * writers he chose, quoting the number, which is the only kind of structural claim this build
 * accepts. Clause 8.3: the shape, never the words.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { openingShape, closeShape, words } from "./lib/prose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const argv = process.argv.slice(2);
const only = (() => {
  const i = argv.indexOf("--handle");
  return i >= 0 ? argv[i + 1] : null;
})();

/* ── Sentences ────────────────────────────────────────────────────────────── */

/*
 * Split on sentence-ending punctuation followed by whitespace. Deliberately simple: the alternative
 * is a tokeniser, and the only decisions downstream are "first", "last" and "which third", none of
 * which a missed abbreviation changes. An emoji-only or marker-only fragment is dropped, because a
 * post that ends on a bare "👇" would otherwise be measured as its own close.
 */
function sentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /[a-z0-9]/i.test(s));
}

/*
 * WHERE THE TURN LANDS.
 *
 * The one structural fact Josh named that nothing in this system has ever measured: "the underlying
 * framework, the underlying structures". A turn is where a post stops describing and reverses — and
 * in practice it is marked, because a writer who reverses without a marker loses the reader.
 *
 * Reported as a fraction through the post by sentence index, so 0.6 means the turn lands three
 * fifths of the way in. A post with no marker is counted separately rather than scored as 1.0:
 * "no turn" is a real shape and averaging it in as "a turn at the very end" would be a lie.
 */
const TURN = /^(but|and yet|yet|then|turns out|it turned out|except|until|instead|the problem|here is|here's|what i found|what actually|so i|that is when|that's when|two weeks later|a month later)\b/i;

function turnAt(sents) {
  for (let i = 0; i < sents.length; i++) {
    if (TURN.test(sents[i])) return sents.length > 1 ? i / (sents.length - 1) : 0;
  }
  return null;
}

/* ── Tally helpers ────────────────────────────────────────────────────────── */

function tally(rows, fn) {
  const out = new Map();
  for (const r of rows) {
    const k = fn(r);
    if (k == null) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

function median(ns) {
  const s = ns.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(n, of) {
  return of === 0 ? "—" : `${Math.round((n / of) * 100)}%`;
}

function table(pairs, of) {
  const w = Math.max(...pairs.map(([k]) => k.length), 14);
  return pairs
    .map(([k, n]) => `    ${k.padEnd(w)}  ${String(n).padStart(3)}  ${pct(n, of).padStart(4)}`)
    .join("\n");
}

/* ── Database ─────────────────────────────────────────────────────────────── */

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  return { url: url.replace(/\/+$/, ""), key };
}

async function fetchPosts() {
  const { url, key } = credentials();
  const q = new URLSearchParams({
    select: "handle,author_name,text,has_line_breaks,words",
    order: "handle",
    limit: "1000",
  });
  if (only) q.set("handle", `eq.${only}`);
  const res = await fetch(`${url}/rest/v1/reference_writer_posts?${q}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`  Could not read the corpus: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const posts = await fetchPosts();
if (posts.length === 0) { console.error("  No posts matched."); process.exit(1); }

const rows = posts.map((p) => {
  const s = sentences(p.text);
  return {
    handle: p.handle,
    author: p.author_name,
    has_breaks: p.has_line_breaks === true,
    sentences: s.length,
    opening: s.length ? openingShape(s[0]) : null,
    close: s.length ? closeShape(s[s.length - 1]) : null,
    close_words: s.length ? words(s[s.length - 1]) : null,
    turn: turnAt(s),
  };
});

const withBreaks = rows.filter((r) => r.has_breaks).length;
const turns = rows.map((r) => r.turn).filter((t) => t != null);

console.log(`\n  Structure of the reference writers — sentence-wise\n`);
console.log(`  ${rows.length} posts, ${new Set(rows.map((r) => r.handle)).size} writer(s).`);
console.log(`  ${withBreaks} of ${rows.length} have line breaks (${pct(withBreaks, rows.length)}).`);
console.log(`  Every number below is measured from sentences, so the scrape's missing line breaks`);
console.log(`  do not affect it. Not comparable with the stored opening_shape/close_shape columns.\n`);

console.log(`  HOW THEY OPEN  (first sentence)\n`);
console.log(table(tally(rows, (r) => r.opening), rows.length));

console.log(`\n  HOW THEY CLOSE  (last sentence)\n`);
console.log(table(tally(rows, (r) => r.close), rows.length));
console.log(`\n    median closing sentence: ${median(rows.map((r) => r.close_words))} words`);

console.log(`\n  WHERE THE TURN LANDS  (fraction through, by sentence)\n`);
console.log(`    posts with a marked turn      ${turns.length}  ${pct(turns.length, rows.length)}`);
console.log(`    median position               ${turns.length ? median(turns).toFixed(2) : "—"}`);
const band = (lo, hi) => turns.filter((t) => t >= lo && t < hi).length;
console.log(`    first third   (0.00–0.33)    ${band(0, 0.33)}`);
console.log(`    middle third  (0.33–0.66)    ${band(0.33, 0.66)}`);
console.log(`    last third    (0.66–1.00)    ${band(0.66, 1.01)}`);

console.log(`\n    median sentences per post:   ${median(rows.map((r) => r.sentences))}\n`);

if (!only) {
  console.log(`  PER WRITER\n`);
  const byHandle = new Map();
  for (const r of rows) {
    if (!byHandle.has(r.handle)) byHandle.set(r.handle, []);
    byHandle.get(r.handle).push(r);
  }
  for (const [h, rs] of [...byHandle].sort((a, b) => b[1].length - a[1].length)) {
    const t = rs.map((r) => r.turn).filter((x) => x != null);
    const op = tally(rs, (r) => r.opening)[0];
    const cl = tally(rs, (r) => r.close)[0];
    console.log(
      `    ${(rs[0].author ?? h).slice(0, 22).padEnd(23)} ${String(rs.length).padStart(3)} posts` +
        `  opens ${(op?.[0] ?? "—").padEnd(16)} closes ${(cl?.[0] ?? "—").padEnd(14)}` +
        ` turn ${t.length ? median(t).toFixed(2) : "  — "} (${t.length}/${rs.length})`,
    );
  }
  console.log("");
}
