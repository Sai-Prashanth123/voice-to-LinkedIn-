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
import { closeShape, openingShape, turnAt, words } from "./lib/prose.mjs";

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
 * WHERE THE TURN LANDS — now imported, not defined here.
 *
 * This was the only turn detector in the repo and it lived in a CLI that measures the writers and
 * writes nothing, so it had never been applied to a draft of Josh's. It moved to scripts/lib/prose.mjs,
 * whose header exists precisely so two readers of one definition cannot disagree. Asserted by a
 * guard, because a second copy here would make every comparison an artefact of which one ran.
 */

/*
 * DOES THE POST ENUMERATE — ANSWERED WITHOUT LINE BREAKS.
 *
 * `uses_list` is null for 105 of 156 posts, and proposal 13 says enumeration is unmeasurable for
 * that reason. It is not quite true. The scrape collapses whitespace; it does not delete
 * characters. A post that read
 *
 *     I bought:
 *     - A calendar scheduling tool.
 *
 * arrives as "I bought: -A calendar scheduling tool." The newline became a space and the space
 * after the dash was eaten, but THE DASH IS STILL THERE. So are "1.", "2.", bullets and the arrow
 * and tick glyphs these writers use. A marker followed by a capital is a list item wherever the
 * line breaks went.
 *
 * CALIBRATED, NOT ASSUMED
 *
 * Checked against the 51 posts whose line breaks survived, where `uses_list` is ground truth:
 * 20 true positives, 26 true negatives, 4 false positives, 1 false negative. 46 of 51, so 90%
 * agreement, recall 20 of 21, precision 20 of 24. The false positives are hyphenated asides and a
 * date range; the false negative is a list with no marker at all, which only a line break reveals.
 *
 * That error is reported with the number rather than hidden behind it. A 90% detector stated as
 * 90% is a measurement; the same detector stated as a fact is the artefact `load-reference-posts`
 * refuses to store, and this does not store it either.
 */
const LIST_MARKER = /[-•▪✅✔→👉]\s*[A-Z]/;
const NUMBERED = /\s[0-9]+[.)]\s+[A-Z]/;

function enumerates(text) {
  const t = String(text ?? "");
  return LIST_MARKER.test(t) || NUMBERED.test(t);
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

/*
 * Paged, because a fixed limit here does not fail — it narrows the corpus and reports the narrower
 * number as the finding. On 20 October the limit of 1000 ordered by handle returned four of the
 * eight writers and printed "1000 posts, 4 writer(s)" as though that were the whole of it. Ordering
 * by handle made it worse than a random slice: it dropped the last four alphabetically, every time.
 */
async function fetchPosts() {
  const { url, key } = credentials();
  const PAGE = 1000;
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({
      select: "handle,author_name,text,has_line_breaks,words,uses_list",
      order: "handle,activity_id",
      limit: String(PAGE),
      offset: String(offset),
    });
    if (only) q.set("handle", `eq.${only}`);
    const res = await fetch(`${url}/rest/v1/reference_writer_posts?${q}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.error(`  Could not read the corpus: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE) return all;
  }
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
    enumerates: enumerates(p.text),
    // Counted at load time from the line breaks themselves, null where there were none.
    uses_list: p.uses_list,
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

console.log(`\n    median sentences per post:   ${median(rows.map((r) => r.sentences))}`);

/*
 * GROUND TRUTH WHERE IT EXISTS, THE DETECTOR ONLY WHERE IT DOES NOT.
 *
 * The marker detector was written when 105 of 156 posts arrived flat and `uses_list` was null for
 * two thirds of the corpus. After the Apify backend first ran on 20 October that is inverted: 1,839
 * of 1,900 posts kept their line breaks, so `uses_list` is counted rather than inferred for 97% of
 * them and the detector is needed for the remaining 61.
 *
 * Recalibrating it against all 1,839 also showed the original figure was flattering. Measured on 51
 * posts it read 90%; measured on 1,839 it is 83.8% — recall 94.3%, precision 81.4%, so it finds
 * nearly every list and calls 236 things lists that are not.
 *
 * The error is not a constant offset. Across the whole corpus the inferred rate runs above the
 * counted one; for Matt Barker it runs 11 points BELOW it (54% against 65%), because his lists are
 * often plain line-broken clauses with no dash or digit for a marker to find. So the two numbers
 * must never be swapped for one another, and the counted one is the one to publish.
 */
const enumerated = rows.filter((r) => r.enumerates).length;
const truth = rows.filter((r) => r.uses_list === true || r.uses_list === false);
const truthLists = truth.filter((r) => r.uses_list === true).length;

console.log(`\n  DOES IT ENUMERATE\n`);
if (truth.length) {
  console.log(`    counted, line breaks intact   ${truthLists}  ${pct(truthLists, truth.length)}   (${truth.length} posts)`);
}
console.log(`    inferred from markers, all    ${enumerated}  ${pct(enumerated, rows.length)}   (${rows.length} posts)`);
console.log(`    the detector agrees with the count on 83.8% of the corpus — recall 94.3%, precision 81.4%.`);
console.log(`    It disagrees in both directions and by different amounts per writer, so the two rates`);
console.log(`    above are not interchangeable. Quote the counted one; the inferred one covers the rest.\n`);

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
        ` turn ${t.length ? median(t).toFixed(2) : "  — "} (${t.length}/${rs.length})` +
        `  lists ${pct(rs.filter((r) => r.enumerates).length, rs.length).padStart(4)}`,
    );
  }
  console.log("");
}
