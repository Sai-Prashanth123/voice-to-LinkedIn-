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
/*
 * ONE COMPOSER OF THE BLOCK, SHARED WITH THE EDGE FUNCTION.
 *
 * `block()` lived here and a hand-copy of it lived in `supabase/functions/cc-submit/maintenance.ts`,
 * and the two had already drifted on the one thing a reader cannot check: the denominator. This file
 * reported the three corroborating fractions over `m.posts` — every stored post, 1,899 — and the
 * copy reported the identical sentence over `totals.of`, the 1,839 that kept their line breaks. The
 * live row said "147 of 1899 posts do", which is how we know this script wrote it last; running
 * `refresh_sentinels` next would have made the same claim read 1,839, with nothing anywhere
 * recording that it had changed.
 *
 * Node strips the types and reads it verbatim, the way measure.mjs reads _shared/shape.ts.
 */
import {
  describeRefusals,
  END,
  measurementSpan,
  referencePostsBody,
  refusals,
  removeWriterReads,
  SECTION_BUDGET,
  spliceSpan,
  START,
} from "../supabase/functions/_shared/library-spans.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIR = join(ROOT, "data", "josh", "sentinels");

const APPLY = process.argv.includes("--apply");
const REPROPOSE = process.argv.includes("--re-propose");
const postsPath = (() => {
  const i = process.argv.indexOf("--posts");
  return i >= 0 ? process.argv[i + 1] : null;
})();

if (!postsPath && !REPROPOSE) {
  console.error("usage: node scripts/sentinel-refresh.mjs --posts <scraped.json> [--apply]");
  console.error("       node scripts/sentinel-refresh.mjs --re-propose [--apply]");
  process.exit(2);
}

/* ── Measure ──────────────────────────────────────────────────────────────── */

/**
 * THE EIGHT HANDLES, AND NOTHING ELSE THAT IS IN THE FILE.
 *
 * A profile scrape returns the subject's FEED, not only their own posts: reposts, and other people's
 * posts the subject engaged with. Grouping by author alone turns those into accounts of their own —
 * the 5 October scrape would have measured a DM-setter, a dog rescue page and a billboard
 * appreciation post, and reported each to Josh as "new account". Clause 8.3 names eight writers.
 * Nobody else gets measured.
 */
const SENTINELS = new Set([
  "demandjen1", "ryanscarlin", "outboundphd", "curtishowland",
  "adam-treboutat", "juliacarter98", "amangrowth", "mattjbarker1",
]);

function measure(posts) {
  const byHandle = new Map();
  let foreign = 0;
  for (const p of posts) {
    if (p.is_repost || !(p.text ?? "").trim()) continue;
    const h = p.author_handle ?? "unknown";
    if (!SENTINELS.has(h)) { foreign++; continue; }
    if (!byHandle.has(h)) byHandle.set(h, { name: p.author_name ?? h, rows: [] });
    byHandle.get(h).rows.push({
      ...measurePost(p.text),
      posted_at: p.posted_at,
      /*
       * WHETHER THIS POST'S SHAPE CAN BE MEASURED AT ALL.
       *
       * `paragraphs` and `above_fold_words` are counted from line breaks. The 5 October scrape
       * returned every post as one unbroken line, so both collapsed to one — and the diff would have
       * reported an 85% drop in paragraph counts across all seven writers as a finding about their
       * writing. It was a finding about the scraper.
       *
       * A post with no line break is still measured for length, rhythm and shape, and is left out of
       * the two measures that need the breaks. Reported, never guessed.
       */
      has_breaks: p.text.includes("\n"),
    });
  }

  const report = [];
  for (const [handle, { name, rows }] of [...byHandle].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dates = rows.map((r) => r.posted_at).filter(Boolean).sort();
    const shaped = rows.filter((r) => r.has_breaks);
    report.push({
      handle, name,
      posts_measured: rows.length,
      window: dates.length ? { from: dates[0].slice(0, 10), to: dates[dates.length - 1].slice(0, 10) } : null,
      // Length and rhythm survive a scrape that lost the line breaks. Everything below the next
      // comment does not, so it is measured over `shaped` alone.
      median_words: median(rows.map((r) => r.words)),
      sd_median: median(rows.map((r) => r.sentence_words_sd)),
      /*
       * EVERY MEASURE BELOW IS DERIVED FROM LINES, SO ALL OF THEM NEED THE BREAKS.
       *
       * Without them a post is one single line, and each of these reads the WHOLE POST where it
       * means to read one line: openingShape matched "number_claim" on 4 of 7 writers because
       * somewhere in 200 words there is a digit and the word "I"; closeShape matched "direct_ask"
       * because somewhere there is the word "comment"; uses_list went false on a writer who bullets
       * nearly every post. The 5 October run reported all of that as writers changing their habits.
       */
      above_fold_words_median: shaped.length ? median(shaped.map((r) => r.above_fold_words)) : null,
      opening_words_median: shaped.length ? median(shaped.map((r) => r.opening_words)) : null,
      paragraphs_median: shaped.length ? median(shaped.map((r) => r.paragraphs)) : null,
      opening_shapes: shaped.length ? tally(shaped.map((r) => r.opening_shape)) : null,
      close_shapes: shaped.length ? tally(shaped.map((r) => r.close_shape)) : null,
      list_rate: shaped.length
        ? +(shaped.filter((r) => r.uses_list).length / shaped.length).toFixed(2)
        : null,
      /** How many of this writer's posts the shape measures above actually rest on. */
      shape_basis: shaped.length,
    });
  }

  const all = [...byHandle.values()].flatMap((v) => v.rows);
  const shapedAll = all.filter((r) => r.has_breaks);
  return {
    measured_at: new Date().toISOString(),
    accounts: report.length,
    posts: all.length,
    /** How many of those posts still had their line breaks, and so could be measured for shape. */
    shape_basis: shapedAll.length,
    /** Feed noise the eight-handle filter dropped. A big number means the scrape, not the writers. */
    skipped_not_a_sentinel: foreign,
    /*
     * THESE THREE ARE FRACTIONS, AND THE DENOMINATOR IS shape_basis.
     *
     * They are the counts that corroborate Josh's own rules, and the section states them as "4 of
     * 59". A later run over a different number of posts makes the raw count incomparable — 2 of 59
     * and 13 of 112 are nearly the same rate and look like a sixfold rise — so the denominator
     * travels with them and the diff compares rates.
     */
    totals: {
      of: shapedAll.length,
      opens_with_question: shapedAll.filter((r) => r.opening_shape === "question").length,
      engagement_asks: shapedAll.filter((r) => r.close_shape === "engagement_ask").length,
      direct_asks: shapedAll.filter((r) => r.close_shape === "direct_ask").length,
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
      // A null means this run could not measure it, which is not a change in how anyone writes.
      if (!a || b == null) continue;
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
    ["opens_with_question", "share of posts opening with a question"],
    ["engagement_asks", "share asking for engagement"],
    ["direct_asks", "share carrying a direct ask"],
  ]) {
    // Rates, because the corpus is a different size every run. `of` is absent from a measurement
    // taken before this was understood, and the post count is the right denominator for those.
    const wasOf = prev.totals?.of ?? prev.shape_basis ?? prev.posts;
    const nowOf = next.totals.of || next.posts;
    if (!wasOf || !nowOf || prev.totals?.[k] == null) continue;
    const a = prev.totals[k] / wasOf, b = next.totals[k] / nowOf;
    const pct = (x) => Math.round(x * 100) + "%";
    if (Math.abs(b - a) >= 0.1) {
      changes.push({
        handle: "(all)",
        what: label,
        was: `${prev.totals[k]} of ${wasOf} (${pct(a)})`,
        now: `${next.totals[k]} of ${nowOf} (${pct(b)})`,
      });
    }
  }

  return { first_run: false, changes };
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

/* ── Re-propose the span from the measurement already stored ──────────────── */

/**
 * WHY THIS PATH EXISTS, AND WHY IT MEASURES NOTHING.
 *
 * On 28 October the section's PROSE had to be corrected and the measurement had not changed. There
 * was no way to do that:
 *
 *   `--posts <file> --apply` re-measures. The 1,899-post scrape of 20 October is not on disk — the
 *   only files left are 112 posts and a 70-post one whose line breaks the scrape had stripped — so
 *   it would have measured a smaller corpus, written it over `latest.json` as the new baseline, and
 *   then found no material change and opened no proposal at all. Worse than nothing twice over.
 *
 *   `refresh_sentinels` measures from the stored corpus and would have worked, and it is an edge
 *   function: it reaches Josh only once it is deployed, which is a separate decision.
 *
 *   The seeder writes `library_sections` directly, and it seeds at v1.0 — four of his sections have
 *   moved past it, so `--apply` there reverts four to correct one.
 *
 * So: compose the span from the stored measurement, propose it, and touch neither the measurement
 * nor the library. It re-measures nothing, writes no file, and cannot change a number — by
 * construction, because it never sees a post. Clause 12.10 is where it always was: this writes one
 * row to `library_proposals` and the section waits for Josh.
 */
if (REPROPOSE) {
  const latestPath = join(DIR, "latest.json");
  if (!existsSync(latestPath)) {
    console.error("\n  No stored measurement. Run with --posts <scrape.json> --apply first.\n");
    process.exit(2);
  }
  const stored = JSON.parse(readFileSync(latestPath, "utf8"));
  const span = measurementSpan(stored);

  const { url, key } = credentials();
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

  const [section] = await (await fetch(
    url + "/rest/v1/library_sections?select=key,body,version&key=eq.reference_posts", { headers },
  )).json();
  if (!section) { console.error("\n  No reference_posts section.\n"); process.exit(1); }

  let body = removeWriterReads(spliceSpan(section.body, span));
  let rebuilt = false;
  if (refusals(body).length) {
    body = referencePostsBody(span);
    rebuilt = true;
  }

  const found = refusals(body);
  if (found.length) {
    console.error("\n  REFUSING to propose this body:\n");
    console.error(describeRefusals(found));
    console.error("");
    process.exit(1);
  }
  if (body.length > SECTION_BUDGET) {
    console.error(`\n  REFUSING: ${body.length} characters, over the ${SECTION_BUDGET} budget.\n`);
    process.exit(1);
  }

  console.log("\n  Re-propose reference_posts from the stored measurement\n");
  console.log("  " + "─".repeat(66));
  console.log(`  measured ${String(stored.measured_at).slice(0, 10)} — not re-measured here`);
  console.log(`  v${section.version}: ${section.body.length} chars -> ${body.length} chars` +
    `${rebuilt ? " (prose rebuilt, it still carried a count outside the markers)" : ""}`);
  console.log(`  within the ${SECTION_BUDGET} budget, nothing addressed to Josh, no changelog`);

  if (!APPLY) {
    console.log("\n" + body + "\n");
    console.log("  Dry run. No proposal opened.\n");
    process.exit(0);
  }

  /*
   * THE CLAIM LEADS WITH THE FACT THAT HE ALREADY REPORTED TWO OF THESE.
   *
   * His own approval note on version 8, 21 October: "Approved knowing three errors are outstanding
   * and going to Naga: the 9% ask figure leaves out pitches in a P.S., 'second fewest above the
   * fold' is wrong (he is fifth), and the intro still says Adam Treboutat returned no posts."
   *
   * Two of those were still live eight days later. He told us, we wrote down that he told us, and
   * the section did not change — because the sentences were above the marker and no refresh could
   * reach them. That is the honest framing and it is the strongest thing in this proposal: not "we
   * found some stale text" but "you reported this and it sat there". It goes first.
   */
  const claim =
    "You reported two of these yourself. Your note approving version 8 on 21 October said " +
    "'second fewest above the fold' is wrong (he is fifth)' and 'the intro still says Adam " +
    "Treboutat returned no posts'. Both were still live eight days later, because those sentences " +
    "sat ABOVE the measurement marker and both refreshers preserve everything above it as yours — " +
    "so no refresh could reach them however many times it ran. That is the defect; the stale " +
    "sentences were the symptom. " +
    "A factual correction, not a change to any rule of yours. The section contradicted itself " +
    "inside one row: the prose said 59 posts across 7 accounts collected on 7 September and that " +
    `adam-treboutat had returned nothing, four lines above a table of ${stored.posts} posts ` +
    `across ${stored.accounts} accounts with 250 of his measured — and compare_to_references has ` +
    "been ranking him on those 250 all along, so the tool was right and the prose was stale. The " +
    "marker has moved up, so every count is now derived at refresh time and no sentence stating a " +
    "quantity is left where a refresh cannot reach it. Also corrected: the Ryan Carlin figures in " +
    "the scene/cut split (6/28/19, measured 8/23/21), the three cut writers that are now four, and " +
    "the three corroborating fractions, which were counted over the 1,839 posts that kept their " +
    "line breaks and printed over all 1,899. " +
    "RESTORED, NOT CHANGED: four passages of your own reasoning were destroyed rather than " +
    "removed — 'There is no house length', 'Sentence-length variation', 'Two structural modes' " +
    "and 'The closest structural match'. All four were inside the measurement markers when the " +
    "20 October refresh rewrote that span, so a mechanism built to replace numbers replaced " +
    "argument, and nobody decided to. Two of them were load-bearing. 'Do not let a target length " +
    "near the drafter' is the sentence that stops a drafter aiming at a median. And the " +
    "sentence-length passage carried your 9-12 range for sentence variation, which we grepped the " +
    "whole system for: it exists in NO other copy anywhere — not the library, not a script, not a " +
    "comment, not data/josh. One record of what a draft of yours should aim at, deleted by a " +
    "refresh, eight days before three of six drafters were handed the measured band with nothing " +
    "about whether to hit it. You are approving the restoration of a number nothing else holds. " +
    "All four are back as prose that states no corpus count, with their figures read off the " +
    "table instead of typed — except 9-12 itself, which is kept verbatim because it is your " +
    "judgement about your own voice rather than a measurement: the measured figures move on every " +
    "refresh and your preference does not move with them. Nobody deleted any of this and you are " +
    "approving a restoration, not a new rule. " +
    "The 8,287-character Matt Barker read moves to its own section that no drafting brief reads — " +
    "it was shipping on every brief whichever writer was named, and on one with no writer named at " +
    "all. That is proposal 22. No rule of yours is touched by either.";

  /*
   * One open proposal per section, the rule maintenance.ts already applies and for the reason its
   * own comment gives: "a proposal he does not act on teaches him to stop reading them". An
   * existing open one is refreshed rather than stacked.
   */
  const open = await (await fetch(
    url + "/rest/v1/library_proposals?section_key=eq.reference_posts&status=eq.open" +
      "&order=id.asc&limit=1", { headers },
  )).json();

  const evidence = {
    kind: "section_prose_correction",
    measured_at: stored.measured_at,
    posts: stored.posts,
    accounts: stored.accounts,
    shape_basis: stored.shape_basis,
    // Named in Josh's own note approving version 8 on 2026-10-21, and still live on 2026-10-28.
    he_reported_these_himself: [
      "'second fewest above the fold' is wrong (he is fifth)",
      "the intro still says Adam Treboutat returned no posts",
    ],
    corrected: [
      "59 posts across 7 accounts, 7 September 2026 -> derived from the stored measurement",
      "adam-treboutat returned zero posts -> 250 measured, 249 with line breaks",
      "Ryan Carlin 6 words / 28 above fold / 19 paragraphs -> 8 / 23 / 21",
      "three cut writers -> four, adam-treboutat joined them",
      "Matt Barker 'second fewest above the fold' -> fifth, now a derived rank",
      "opens_with_question printed over posts (1899) -> over totals.of (1839), which is what it counts",
      "'92% of the writers he chose' -> 92% of those posts; it was a share of posts, not of writers",
      "Matt Barker read (8,287 chars) -> section reference_writer_reads, in no view",
    ],
    // Destroyed by the 20 October refresh rather than removed by anyone: they were inside the
    // markers, so the span that replaces numbers replaced argument.
    restored: [
      "There is no house length — 'do not let a target length near the drafter'",
      "Sentence-length variation — his 9-12 target range, which existed in no other copy anywhere " +
        "in the system; the only record of it, deleted by the 20 October refresh",
      "Two structural modes, and they do not mix — now derived, four cut writers not three",
      "The closest structural match, and the furthest",
    ],
    // Grepped 2026-10-28 across the library, scripts, comments and data/josh: no second copy.
    restored_and_held_nowhere_else: ["9-12, the sentence-length variation target"],
    re_measured: false,
  };

  const res = open.length
    ? await fetch(url + `/rest/v1/library_proposals?id=eq.${open[0].id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ claim, evidence, proposed_body: body }),
    })
    : await fetch(url + "/rest/v1/library_proposals", {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        section_key: "reference_posts",
        claim,
        evidence,
        proposed_body: body,
        status: "open",
      }),
    });

  if (!res.ok) {
    console.error("\n  proposal failed: " + res.status + " " + (await res.text()).slice(0, 300));
    process.exit(1);
  }
  const [row] = await res.json();
  console.log(`\n  proposal #${row.id} ${open.length ? "refreshed" : "opened"} against ` +
    "reference_posts");
  console.log("  Nothing has changed in the library. It waits for Josh (12.10).\n");
  process.exit(0);
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

/*
 * Three shapes, because three things produce this file and only one of them was ever fed to this
 * script. `scrape-sentinels.mjs` writes `{fetched_at, source, shape_measurable, posts}`; a raw Apify
 * dump is `{items}`; the hand-exported 5 October seed is a bare array. Passing the first of those
 * threw `posts is not iterable` on the first attempt, 20 October — the two scripts are printed as
 * consecutive steps in each other's "next:" output and had never been run in that order.
 */
const raw = JSON.parse(readFileSync(postsPath, "utf8"));
const posts = Array.isArray(raw) ? raw : (raw.posts ?? raw.items ?? null);
if (!Array.isArray(posts)) {
  console.error(`  ${postsPath} holds no post array (looked for a bare array, .posts and .items).`);
  process.exit(2);
}
if (raw.shape_measurable === false) {
  console.error("  That scrape came back with its line breaks stripped, so every paragraph-wise");
  console.error("  measurement in it would be an artefact of the scraper. Refusing to measure it.");
  process.exit(2);
}
const next = measure(posts);

mkdirSync(DIR, { recursive: true });
const latestPath = join(DIR, "latest.json");
const prev = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : null;
const d = diff(prev, next);

console.log("\n  Sentinel refresh\n");
console.log("  " + "─".repeat(66));
console.log(`  ${next.accounts} accounts, ${next.posts} posts`);
if (next.shape_basis < next.posts) {
  console.log(`  shape measured on ${next.shape_basis} of them — ${next.posts - next.shape_basis} ` +
    `arrived with their line breaks stripped, so opening, close, paragraph, above-fold and list`);
  console.log(`  figures leave those out rather than reading the whole post as one line`);
}
if (next.skipped_not_a_sentinel) {
  console.log(`  ${next.skipped_not_a_sentinel} feed items by other authors ignored (8.3: eight handles)`);
}
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

const newBlock = measurementSpan(next);
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

/*
 * THREE THINGS HAPPEN HERE, AND THE ORDER MATTERS.
 *
 * The span is spliced — unchanged behaviour, now through one shared function so the edge function
 * cannot splice a differently-composed block into the same markers.
 *
 * Then one writer's structural read is cut out. 8,287 of version 8's 10,924 characters were Matt
 * Barker's shape, spliced in BELOW the span on 20 October by matt-barker-structure.mjs, where no
 * refresh could reach it — and shipped on every drafting brief whichever handle was passed. A
 * control run with no handle read it as its shape target, which is Josh's complaint that "the
 * default framework gets used anyway" arriving as the mechanism rather than the symptom. It moves to
 * its own section, which is in no view; nothing load-bearing is lost, because a named writer's shape
 * reaches a drafter through writerShapeBlock and his one exclusion is hardcoded beside it.
 *
 * Then the refusals, on the body as it would be STORED rather than on the block alone — because
 * every failure this closes was in the prose around the block, not in the block.
 */
/*
 * SPLICE WHERE THE PROSE IS SOUND, REBUILD IT WHERE IT IS NOT.
 *
 * Splicing the span and preserving everything around it is the right default and is the 20 October
 * behaviour: the prose outside the markers is Josh's to write. It is also exactly how this section
 * came to contradict itself, because the prose outside the markers was carrying counts no splice
 * could reach.
 *
 * So the refusals decide. If the body as spliced still states a quantity outside the markers then
 * the prose is the stale half, and preserving it is the bug rather than the courtesy — so the
 * invariant prose is rebuilt from the one definition in `_shared/library-spans.ts`. If it does not,
 * nothing outside the span is touched.
 *
 * It cannot be done by reseeding instead. `scripts/load-josh-library.mjs` seeds the library at
 * v1.0 and four of Josh's sections have moved past it — audience v7, closes v6, gate_rules v5,
 * formatting v4 — so `--apply` there would revert four sections in order to correct one.
 */
let proposedBody = removeWriterReads(spliceSpan(section.body, newBlock));
let rebuilt = false;

if (refusals(proposedBody).length) {
  proposedBody = referencePostsBody(newBlock);
  rebuilt = true;
  console.log("\n  The prose outside the markers still states a count, so it is the stale half.");
  console.log("  Rebuilding it from the one definition rather than preserving it.");
}

const found = refusals(proposedBody);
if (found.length) {
  console.error("\n  REFUSING to propose this body:\n");
  console.error(describeRefusals(found));
  console.error("");
  process.exit(1);
}
if (proposedBody.length > SECTION_BUDGET) {
  console.error(`\n  REFUSING: ${proposedBody.length} characters, over the ${SECTION_BUDGET} ` +
    `budget for a section that ships on every drafting brief.\n`);
  process.exit(1);
}
console.log(`  ${proposedBody.length} characters, within the ${SECTION_BUDGET} budget, ` +
  `no count outside the markers${rebuilt ? ", prose rebuilt" : ""}`);

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
