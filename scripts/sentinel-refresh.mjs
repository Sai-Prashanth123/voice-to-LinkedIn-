#!/usr/bin/env node
/**
 * Re-measure the sentinel accounts, and propose the change rather than making it.
 *
 *   node scripts/sentinel-refresh.mjs --posts <scraped.json>
 *   node scripts/sentinel-refresh.mjs --posts <scraped.json> --apply
 *
 * THE SHAPE OF THIS, AND WHY IT STOPS WHERE IT DOES
 *
 * Clause 12.10: the system proposes, Josh approves, and it never changes the library on its own.
 * That is enforced in four independent places — a Zod enum, a database trigger, an
 * `.eq("immutable", false)` on every apply path, and a source-grep assertion in
 * `eval/e2e/cases/s9-learn.mjs` that greps worker-learn for a section update.
 *
 * So this writes exactly one row to `library_proposals` and nothing else. It has no path to
 * `library_sections`, deliberately, and the verification step for it is a SQL count asserting zero
 * section updates.
 *
 * WHERE THE POSTS COME FROM
 *
 * The scraping console holds them; it is their store of record and they never enter Josh's
 * database. Whatever calls this fetches a fresh scrape and hands over the file — an MCP call today,
 * the console's own daily schedule once the eight handles are on the roster.
 *
 * This script deliberately does not know how to scrape. A script that both fetched and judged
 * would have to be trusted about what it discarded.
 *
 * WHY NOT worker-learn
 *
 * `ProposalsSchema.section_key` is a Zod enum of ten keys and `reference_posts` is not one of them,
 * so a sentinel finding cannot travel that path even though it is the same kind of claim. The
 * insert here is direct, and carries evidence of a different shape: handles and deltas rather than
 * `post_ids`, because these are not Josh's posts. The database only requires evidence to be a
 * non-empty object, so that is legal — but it is a difference worth knowing about.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { measurePost, median, tally } from "./lib/prose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIR = join(ROOT, "data", "josh", "sentinels");

const APPLY = process.argv.includes("--apply");
const postsPath = (() => {
  const i = process.argv.indexOf("--posts");
  return i >= 0 ? process.argv[i + 1] : null;
})();

if (!postsPath) {
  console.error("usage: node scripts/sentinel-refresh.mjs --posts <scraped.json> [--apply]");
  process.exit(2);
}

/* ── Measure ──────────────────────────────────────────────────────────────── */

function measure(posts) {
  const byHandle = new Map();
  for (const p of posts) {
    if (p.is_repost || !(p.text ?? "").trim()) continue;
    const h = p.author_handle ?? "unknown";
    if (!byHandle.has(h)) byHandle.set(h, { name: p.author_name ?? h, rows: [] });
    byHandle.get(h).rows.push({ ...measurePost(p.text), posted_at: p.posted_at });
  }

  const report = [];
  for (const [handle, { name, rows }] of [...byHandle].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dates = rows.map((r) => r.posted_at).filter(Boolean).sort();
    report.push({
      handle, name,
      posts_measured: rows.length,
      window: dates.length ? { from: dates[0].slice(0, 10), to: dates[dates.length - 1].slice(0, 10) } : null,
      median_words: median(rows.map((r) => r.words)),
      above_fold_words_median: median(rows.map((r) => r.above_fold_words)),
      opening_words_median: median(rows.map((r) => r.opening_words)),
      paragraphs_median: median(rows.map((r) => r.paragraphs)),
      opening_shapes: tally(rows.map((r) => r.opening_shape)),
      close_shapes: tally(rows.map((r) => r.close_shape)),
      list_rate: +(rows.filter((r) => r.uses_list).length / rows.length).toFixed(2),
      sd_median: median(rows.map((r) => r.sentence_words_sd)),
    });
  }

  const all = [...byHandle.values()].flatMap((v) => v.rows);
  return {
    measured_at: new Date().toISOString(),
    accounts: report.length,
    posts: all.length,
    totals: {
      opens_with_question: all.filter((r) => r.opening_shape === "question").length,
      engagement_asks: all.filter((r) => r.close_shape === "engagement_ask").length,
      direct_asks: all.filter((r) => r.close_shape === "direct_ask").length,
    },
    report,
  };
}

/* ── Diff ─────────────────────────────────────────────────────────────────── */

/**
 * What counts as a change worth telling Josh about.
 *
 * The bar is deliberately high. A proposal he does not act on teaches him to stop reading them,
 * and clause 12c's whole value is that a proposal means something. Noise is the failure mode here,
 * not missing a small move.
 */
const MATERIAL = 0.25;

function diff(prev, next) {
  if (!prev) return { first_run: true, changes: [] };
  const before = Object.fromEntries(prev.report.map((r) => [r.handle, r]));
  const changes = [];

  for (const now of next.report) {
    const was = before[now.handle];
    if (!was) { changes.push({ handle: now.handle, what: "new account", now: now.posts_measured + " posts" }); continue; }

    for (const [field, label] of [
      ["median_words", "median post length"],
      ["above_fold_words_median", "words above the fold"],
      ["paragraphs_median", "paragraphs"],
      ["sd_median", "sentence-length variation"],
    ]) {
      const a = was[field], b = now[field];
      if (!a) continue;
      const move = Math.abs(b - a) / a;
      if (move >= MATERIAL) {
        changes.push({ handle: now.handle, what: label, was: a, now: b, move: +(move * 100).toFixed(0) + "%" });
      }
    }

    const wasTop = was.opening_shapes?.[0]?.[0], nowTop = now.opening_shapes?.[0]?.[0];
    if (wasTop && nowTop && wasTop !== nowTop) {
      changes.push({ handle: now.handle, what: "commonest opening", was: wasTop, now: nowTop });
    }
    if (Math.abs(now.list_rate - was.list_rate) >= MATERIAL) {
      changes.push({ handle: now.handle, what: "how often they use a list", was: was.list_rate, now: now.list_rate });
    }
  }

  // The three counts that corroborate Josh's own rules. A move here matters more than any
  // single account's habits, because these are what the section actually claims.
  for (const [k, label] of [
    ["opens_with_question", "posts opening with a question"],
    ["engagement_asks", "posts asking for engagement"],
    ["direct_asks", "posts carrying a direct ask"],
  ]) {
    if (prev.totals?.[k] !== next.totals[k]) {
      changes.push({ handle: "(all)", what: label, was: prev.totals?.[k], now: next.totals[k] });
    }
  }

  return { first_run: false, changes };
}

/* ── The block that goes into the section ─────────────────────────────────── */

const START = "<!-- sentinel-measurements:start -->";
const END = "<!-- sentinel-measurements:end -->";

function block(m) {
  const L = [];
  L.push(START);
  L.push("");
  L.push("## The finding that matters most");
  L.push("");
  L.push(`**Almost nobody opens with a question. ${m.totals.opens_with_question} of ${m.posts} posts do.**`);
  L.push("");
  L.push("Josh's hook rule — a question may close a hook, never start one — is not a stylistic");
  L.push(`preference. It is what ${Math.round((1 - m.totals.opens_with_question / m.posts) * 100)}% of the writers he chose already do.`);
  L.push("");
  L.push("Two more that corroborate his own rules:");
  L.push("");
  L.push(`- **${m.totals.engagement_asks} of ${m.posts} posts ask for engagement.**`);
  L.push(`- **${m.totals.direct_asks} of ${m.posts} carry a direct ask** — about 1 in ` +
    `${Math.round(m.posts / Math.max(m.totals.direct_asks, 1))}.`);
  L.push("");
  L.push("## Per account");
  L.push("");
  L.push("| Account | Posts | Median words | Above fold | Paragraphs | Lists | Variation |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of m.report) {
    L.push(`| ${r.name} | ${r.posts_measured} | ${r.median_words} | ${r.above_fold_words_median} | ` +
      `${r.paragraphs_median} | ${Math.round(r.list_rate * 100)}% | ${r.sd_median} |`);
  }
  L.push("");
  L.push(`_Measured ${m.measured_at.slice(0, 10)} across ${m.accounts} accounts and ${m.posts} posts. ` +
    `Their words are not stored anywhere in this system._`);
  L.push("");
  L.push(END);
  return L.join("\n");
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

/* ── Main ─────────────────────────────────────────────────────────────────── */

const posts = JSON.parse(readFileSync(postsPath, "utf8"));
const next = measure(posts);

mkdirSync(DIR, { recursive: true });
const latestPath = join(DIR, "latest.json");
const prev = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : null;
const d = diff(prev, next);

console.log("\n  Sentinel refresh\n");
console.log("  " + "─".repeat(66));
console.log(`  ${next.accounts} accounts, ${next.posts} posts`);
console.log(`  opens with a question ${next.totals.opens_with_question} · ` +
  `engagement asks ${next.totals.engagement_asks} · direct asks ${next.totals.direct_asks}`);

if (d.first_run) {
  console.log("\n  First run — nothing to compare against. Storing the baseline.");
} else if (d.changes.length === 0) {
  console.log("\n  Nothing moved by " + MATERIAL * 100 + "% or more. No proposal.");
  console.log("  A quiet week is an honest outcome, and a proposal Josh ignores costs more than it saves.");
} else {
  console.log("\n  " + d.changes.length + " material change(s):");
  for (const c of d.changes) {
    console.log("    " + c.handle.padEnd(16) + c.what +
      (c.was !== undefined ? "  " + c.was + " -> " + c.now : "  " + (c.now ?? "")) +
      (c.move ? "  (" + c.move + ")" : ""));
  }
}

const newBlock = block(next);
const leak = posts.find((p) => {
  const s = (p.text ?? "").trim().slice(0, 40);
  return s.length >= 40 && (newBlock + JSON.stringify(next)).includes(s);
});
if (leak) {
  console.error("\n  REFUSING: post text leaked into the measurement block.");
  process.exit(1);
}
console.log("\n  no post text in the block or the stored measurements");

if (!APPLY) {
  console.log("\n  Dry run. Nothing written, no proposal inserted.\n");
  process.exit(0);
}

// Roll the baseline forward only on --apply, so a dry run cannot quietly consume the comparison
// and make the next real run look like a first run.
if (prev) renameSync(latestPath, join(DIR, "previous.json"));
writeFileSync(latestPath, JSON.stringify(next, null, 2) + "\n");
console.log("  written: data/josh/sentinels/latest.json");

if (d.first_run || d.changes.length === 0) {
  console.log("\n  No proposal to make.\n");
  process.exit(0);
}

const { url, key } = credentials();
const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

const [section] = await (await fetch(
  url + "/rest/v1/library_sections?select=key,body&key=eq.reference_posts", { headers },
)).json();

if (!section?.body?.includes(START)) {
  console.error("\n  reference_posts has no measurement markers. Refusing to guess where to put this.");
  console.error("  Run: node scripts/load-josh-library.mjs --apply\n");
  process.exit(1);
}

const proposedBody =
  section.body.slice(0, section.body.indexOf(START)) +
  newBlock +
  section.body.slice(section.body.indexOf(END) + END.length);

const res = await fetch(url + "/rest/v1/library_proposals", {
  method: "POST",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({
    section_key: "reference_posts",
    claim: d.changes.length + " sentinel measurement(s) moved by " + MATERIAL * 100 + "% or more: " +
      d.changes.slice(0, 3).map((c) => c.handle + " " + c.what).join("; ") +
      (d.changes.length > 3 ? "; and " + (d.changes.length - 3) + " more" : ""),
    // Not post_ids. These are not Josh's posts, and pretending otherwise would put a claim in the
    // audit trail that no post could support.
    evidence: {
      kind: "sentinel_measurement",
      handles: next.report.map((r) => r.handle),
      posts_measured: next.posts,
      measured_at: next.measured_at,
      changes: d.changes,
    },
    proposed_body: proposedBody,
    status: "open",
  }),
});

if (!res.ok) {
  console.error("\n  proposal failed: " + res.status + " " + (await res.text()).slice(0, 300));
  process.exit(1);
}
const [row] = await res.json();
console.log("\n  proposal #" + row.id + " opened against reference_posts");
console.log("  Nothing has changed in the library. It waits for Josh (12.10).\n");
