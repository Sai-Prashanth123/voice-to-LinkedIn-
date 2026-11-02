#!/usr/bin/env node
/**
 * What the eight writers measurably do in their first line, and nothing they said.
 *
 *   node scripts/build-hook-patterns.mjs
 *   node scripts/build-hook-patterns.mjs --apply
 *
 * WHY THIS EXISTS
 *
 * Josh, 30 October: "the hooks need to be stronger… it's too long… it almost gives away what the
 * post is going to be about in the hook itself rather than leaving people wanting to click more."
 * And: "it's always picking up that the hook's not great, so let's just fix it at the ground level
 * rather than kind of waiting for it to fail, inevitably fail, and then fix it."
 *
 * His `hooks` section already answers that in 3,677 characters — it names the curiosity gap as
 * investment-then-cut and lists the three ways one fails, the first being "No gap at all. The
 * opening states its conclusion." The rules are not what is missing. What is missing is a measured
 * floor a drafter can aim at BEFORE the gate reads it, which is what this file is.
 *
 * WHY IT CARRIES NO SENTENCES, WHICH IS A PROMISE THIS FILE HAS TO KEEP
 *
 * Naga offered Josh "a swipe file with 150 to 200 posts with emphasis on the hooks". A file of real
 * openings cannot be the thing a drafter reads: `create_draft` refuses any draft sharing a
 * seven-word run with a stored reference post (clause 8.3, shingles.ts), so the better a drafter
 * followed such a file, the likelier its draft would be refused. There is precedent for the other
 * failure too — an 8,287-character Matt Barker read once shipped on every brief and became the
 * default framework Josh complained about.
 *
 * So this derives STRUCTURE over the corpus rather than quoting 150 openings, and the leak guard at
 * the bottom refuses to write if any post's text reaches the output. Same guard as
 * sentinel-refresh.mjs:522, for the same clause.
 *
 * WHAT IS HONEST ABOUT THE NUMBERS AND WHAT IS NOT
 *
 * `opening_words`, `opening_shape` and `above_fold_words` are stored columns, counted by
 * scripts/lib/prose.mjs, and are as good as anything here gets. The investment features below are
 * REGEX APPROXIMATIONS of prose judgements and are labelled as such in the output. They are
 * published with their own definitions attached so nobody downstream can mistake a word-list hit
 * for a reading. The repo's precedent for publishing an estimate's error rate is
 * scripts/measure-structure.mjs, whose list detector went from 90% to 83.8% on re-testing.
 *
 * `statement` is 44% of the corpus and is NOT a shape — it is openingShape()'s fallthrough bucket,
 * the one that matched none of the other six (prose.mjs:88). Treated as a shape it would teach a
 * drafter to aim at "none of the above". Said out loud in the output.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { measureShape } from "../supabase/functions/_shared/shape.ts";
import { words, median, openingShape, turnAt, sentences } from "./lib/prose.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "josh", "hooks");
const APPLY = process.argv.includes("--apply");

/* ── The eight he chose ───────────────────────────────────────────────────── */

const SENTINELS = new Set([
  "mattjbarker1", "demandjen1", "outboundphd", "juliacarter98",
  "ryanscarlin", "curtishowland", "amangrowth", "adam-treboutat",
]);

/* ── Credentials, same shape as sentinel-refresh ──────────────────────────── */

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
 * Paged, because PostgREST caps a response at 1,000 rows whatever limit is asked for and says
 * nothing about it. There are 1,839 posts with their line breaks intact. shape-rows.mjs exists
 * because the ninth gate check spent two weeks judging against roughly 43 of Matt Barker's 241
 * measurable posts for exactly this reason.
 */
async function allPosts() {
  const { url, key } = credentials();
  const headers = { apikey: key, Authorization: "Bearer " + key };
  const out = [];
  for (let offset = 0;; offset += 1000) {
    const q = new URLSearchParams({
      select: "activity_id,handle,text,opening_words,opening_shape,above_fold_words,paragraphs",
      has_line_breaks: "is.true",
      order: "activity_id.asc",
      offset: String(offset),
      limit: "1000",
    });
    const res = await fetch(url + "/rest/v1/reference_writer_posts?" + q, { headers });
    if (!res.ok) { console.error("  read failed: " + res.status + " " + await res.text()); process.exit(1); }
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out.filter((p) => SENTINELS.has(p.handle) && (p.text ?? "").trim());
}

/* ── The investment features ──────────────────────────────────────────────────
 *
 * The hooks section says investment comes from three things — specificity, a real emotion, clear
 * stakes — and that "a hook missing all three cannot be rescued by a better cut". It also names
 * "Name who it is for" as "the highest-value tool available". None of the four has ever been
 * measured anywhere in this system.
 *
 * These are word lists and character classes. They see FORM, never meaning: a line can name real
 * stakes in words none of these lists hold, and a line can hit "stakes" on the word "cost" while
 * meaning the price of a tool. Every rate is published with its own definition for that reason, and
 * none of them is a gate.
 */

/** A figure, a date, a currency amount, or a percentage. The most reliable of the four. */
const FIGURE = /\d/;

/**
 * A role, a team, or a direct address. Approximate by design: it cannot tell "sales" the department
 * from "sales" the noun, and it will miss any title not on this list.
 */
const READER = new RegExp(
  "\\b(sdr|sdrs|ae|aes|bdr|bdrs|rep|reps|founder|founders|ceo|cto|cmo|cro|coo|vp|vps|" +
  "head of|director|directors|manager|managers|leader|leaders|marketer|marketers|seller|sellers|" +
  "recruiter|recruiters|operator|operators|consultant|consultants|agency|agencies|team|teams|" +
  "if you|for anyone|anyone who)\\b",
  "i",
);

/**
 * Something at risk. The section calls stakes "the one most often left out and the one that does
 * the most work, because without them the reader assumes everything was fine."
 */
const STAKES = new RegExp(
  "\\b(lost|losing|lose|missed|missing|failed|failing|fail|broke|broken|wrong|cost|costs|costing|" +
  "wasted|wasting|waste|nobody|no one|stuck|behind|quota|fired|churn|churned|quit|quitting|dead|" +
  "dying|risk|risked|struggle|struggled|struggling|worst|never|hardest)\\b",
  "i",
);

/**
 * A marked feeling rather than a judgement about one. The section asks for "what it felt like, not
 * what it meant", and this is the weakest of the detectors by a distance.
 */
const EMOTION = new RegExp(
  "\\b(felt|feels|feel|embarrassed|embarrassing|proud|terrified|scared|afraid|angry|furious|" +
  "gutted|thrilled|nervous|anxious|awkward|uncomfortable|hated|hate|loved|shocks|shocked|stunned|" +
  "surprised|exhausted|tired of|sick of|fed up)\\b",
  "i",
);

/* ── Measure one post ─────────────────────────────────────────────────────── */

function measureOne(p) {
  const body = (p.text ?? "").replace(/\r/g, "");
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const line1 = lines[0] ?? "";
  const line2 = lines[1] ?? "";
  const shape = measureShape(body);

  /*
   * WHERE THE POST'S FIRST FIGURE LANDS — the closest this can get to "does the opening give the
   * post away", which is Josh's actual complaint.
   *
   * The reasoning is the one the hook rubric already uses: "Naming the METHOD while withholding the
   * FINDING passes. Naming the FINDING passes only where the post still owes the reader why it is
   * true." A post whose figures all arrive after line one has withheld something. A post whose
   * headline figure is in line one may still be fine, so this is a distribution and never a pass
   * mark.
   *
   * It is a proxy and it is wrong in two known ways: a post whose finding is not a number is
   * invisible to it, and a date in line one counts as a figure.
   */
  const anyFigure = FIGURE.test(body);
  const figureAt = !anyFigure ? "none"
    : FIGURE.test(line1) ? "line_one"
    : FIGURE.test(line2) ? "line_two"
    : "later";

  // Specificity: a figure, or a capitalised word that is not the line's first — a proper noun, a
  // place, a product. The slice(1) is what keeps the opening capital from counting as one.
  const specific = FIGURE.test(line1) || /[A-Z][a-z]{2,}/.test(line1.slice(1));
  const stakes = STAKES.test(line1);
  const emotion = EMOTION.test(line1);
  const invCount = [specific, stakes, emotion].filter(Boolean).length;

  return {
    handle: p.handle,
    shape: p.opening_shape ?? openingShape(line1),
    line1_words: typeof p.opening_words === "number" ? p.opening_words : words(line1),
    line2_words: words(line2),
    above_fold_words: shape.above_fold_words,
    hook_above_fold: shape.hook_above_fold,
    ends_on_colon: /:\s*$/.test(line1),
    names_reader: READER.test(line1),
    figure_at: figureAt,
    investment: invCount,
    specific,
    stakes,
    emotion,
    turn_at: turnAt(sentences(body)),
  };
}

/* ── Aggregate ────────────────────────────────────────────────────────────── */

const pct = (n, of) => (of ? +((n / of) * 100).toFixed(1) : 0);
const p90 = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
};

function aggregate(rows) {
  const byShape = {};
  for (const r of rows) (byShape[r.shape] ??= []).push(r);

  const shapes = Object.entries(byShape)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([shape, rs]) => {
      const l1 = rs.map((r) => r.line1_words);
      return {
        shape,
        posts: rs.length,
        share_pct: pct(rs.length, rows.length),
        line_one_words: { median: median(l1), p90: p90(l1) },
        hook_clears_the_fold_pct: pct(rs.filter((r) => r.hook_above_fold).length, rs.length),
        names_the_reader_pct: pct(rs.filter((r) => r.names_reader).length, rs.length),
        ends_on_a_colon_pct: pct(rs.filter((r) => r.ends_on_colon).length, rs.length),
        first_figure_arrives: {
          line_one: pct(rs.filter((r) => r.figure_at === "line_one").length, rs.length),
          line_two: pct(rs.filter((r) => r.figure_at === "line_two").length, rs.length),
          later: pct(rs.filter((r) => r.figure_at === "later").length, rs.length),
          no_figure: pct(rs.filter((r) => r.figure_at === "none").length, rs.length),
        },
        investment_elements_in_line_one: {
          none: pct(rs.filter((r) => r.investment === 0).length, rs.length),
          one: pct(rs.filter((r) => r.investment === 1).length, rs.length),
          two_or_more: pct(rs.filter((r) => r.investment >= 2).length, rs.length),
        },
      };
    });

  const byWriter = {};
  for (const r of rows) (byWriter[r.handle] ??= []).push(r);

  return {
    measured_at: new Date().toISOString(),
    basis: {
      posts: rows.length,
      writers: Object.keys(byWriter).length,
      means:
        "Only posts that kept their line breaks. The scraping console returns most posts as one " +
        "unbroken line, and counting those would report the scraper as a habit of the writer.",
    },
    what_these_are:
      "STRUCTURE ONLY. No sentence from any post is in this file, and the run refuses to write if " +
      "one is. Take the shape, never the words (8.3) — and create_draft refuses any draft sharing " +
      "a seven-word run with a stored reference post, so a borrowed opening would not file anyway.",
    the_statement_caveat:
      "`statement` is the largest bucket and is not a shape. It is openingShape()'s fallthrough: " +
      "the openings that matched none of the other six (scripts/lib/prose.mjs:88). Aiming at it " +
      "means aiming at none of the above, which is not an instruction.",
    approximations:
      "line_one_words, share_pct, hook_clears_the_fold_pct and first_figure_arrives rest on stored " +
      "columns counted by scripts/lib/prose.mjs. names_the_reader_pct and " +
      "investment_elements_in_line_one are REGEX APPROXIMATIONS of prose judgements: they see " +
      "form, never meaning. A line can name real stakes in words no list holds. Report them as " +
      "estimates or not at all.",
    definitions: {
      names_the_reader:
        "A job title, a team noun or a direct address in line one. The hooks section calls this " +
        "the highest-value tool available. Cannot tell a department from a noun; misses any title " +
        "not on the list.",
      investment_elements:
        "How many of specificity, stakes and emotion line one carries, by word list. The hooks " +
        "section says a hook missing all three cannot be rescued by a better cut. Specificity is a " +
        "figure or a non-initial capitalised word; the other two are word lists.",
      first_figure_arrives:
        "Where the post's first digit appears. A post whose figures all arrive after line one has " +
        "withheld something. Blind to a finding that is not a number; counts a date as a figure.",
    },
    shapes,
    all_writers: {
      line_one_words: {
        median: median(rows.map((r) => r.line1_words)),
        p90: p90(rows.map((r) => r.line1_words)),
      },
      two_or_more_investment_elements_pct: pct(rows.filter((r) => r.investment >= 2).length, rows.length),
      /*
       * THE THREE COMPONENTS, SEPARATELY, BECAUSE THE COMBINED FIGURE IS THE FINDING.
       *
       * Measured 2 November: specificity 76.7%, stakes and emotion each in the low single digits,
       * and two-or-more together 8.6%. The plan this came from proposed requiring two of three in
       * every first line. The corpus refuses that: it would fail about 91% of the posts Josh chose
       * as his own references, including most of Matt Barker's.
       *
       * The honest reading is that the hooks section's investment triad is coaching-brief prose
       * rather than a measured habit of these eight writers. It is still good advice about what
       * makes a reader care. It is not a floor, and nothing downstream may treat it as one.
       */
      investment_components_pct: {
        specificity: pct(rows.filter((r) => r.specific).length, rows.length),
        stakes: pct(rows.filter((r) => r.stakes).length, rows.length),
        emotion: pct(rows.filter((r) => r.emotion).length, rows.length),
      },
      names_the_reader_pct: pct(rows.filter((r) => r.names_reader).length, rows.length),
      hook_clears_the_fold_pct: pct(rows.filter((r) => r.hook_above_fold).length, rows.length),
      first_figure_after_line_one_pct: pct(rows.filter((r) => r.figure_at === "later").length, rows.length),
      has_a_marked_turn_pct: pct(rows.filter((r) => r.turn_at !== null).length, rows.length),
    },
    per_writer: Object.fromEntries(
      Object.entries(byWriter).sort().map(([handle, rs]) => [handle, {
        posts: rs.length,
        line_one_words_median: median(rs.map((r) => r.line1_words)),
        commonest_shape: Object.entries(
          rs.reduce((a, r) => ((a[r.shape] = (a[r.shape] ?? 0) + 1), a), {}),
        ).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        names_the_reader_pct: pct(rs.filter((r) => r.names_reader).length, rs.length),
        two_or_more_investment_elements_pct: pct(rs.filter((r) => r.investment >= 2).length, rs.length),
        has_a_marked_turn_pct: pct(rs.filter((r) => r.turn_at !== null).length, rs.length),
      }]),
    ),
  };
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

console.log("\n  Reading the reference corpus...");
const posts = await allPosts();
console.log("  " + posts.length + " posts with line breaks, across " +
  new Set(posts.map((p) => p.handle)).size + " writers");

const rows = posts.map(measureOne);
const next = aggregate(rows);

console.log("\n  LINE ONE, by opening shape:\n");
console.log("    shape             posts  median   p90  reader   2+inv  figure after L1");
for (const s of next.shapes) {
  console.log(
    "    " + s.shape.padEnd(18) +
    String(s.posts).padStart(5) +
    String(s.line_one_words.median).padStart(8) +
    String(s.line_one_words.p90).padStart(6) +
    (s.names_the_reader_pct + "%").padStart(8) +
    (s.investment_elements_in_line_one.two_or_more + "%").padStart(8) +
    (s.first_figure_arrives.later + "%").padStart(17),
  );
}
const aw = next.all_writers;
console.log("\n  across all " + next.basis.posts + " posts:");
console.log("    line one           median " + aw.line_one_words.median +
  " words, p90 " + aw.line_one_words.p90);
console.log("    names the reader   " + aw.names_the_reader_pct + "%");
console.log("    hook clears fold   " + aw.hook_clears_the_fold_pct + "%");
console.log("    marked turn        " + aw.has_a_marked_turn_pct + "%");
console.log("    investment: specificity " + aw.investment_components_pct.specificity +
  "%, stakes " + aw.investment_components_pct.stakes +
  "%, emotion " + aw.investment_components_pct.emotion +
  "%  -> two or more " + aw.two_or_more_investment_elements_pct + "%");
console.log("\n    NOTE: two-or-more at " + aw.two_or_more_investment_elements_pct +
  "% means an investment floor would fail most of the writers he chose. Reported, never enforced.");

/*
 * THE LEAK GUARD. Same test as sentinel-refresh.mjs:522, and the reason clause 8.3 is mechanical
 * here rather than aspirational. Forty characters is long enough that ordinary English does not
 * collide and short enough to catch a lifted clause.
 */
const serialized = JSON.stringify(next);
const leak = posts.find((p) => {
  const s = (p.text ?? "").trim().slice(0, 40);
  return s.length >= 40 && serialized.includes(s);
});
if (leak) {
  console.error("\n  REFUSING: post text leaked into the patterns file.");
  process.exit(1);
}
console.log("  no post text in the output");

if (!APPLY) {
  console.log("\n  Dry run. Nothing written.\n");
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
const latestPath = join(DIR, "latest.json");
// Roll the baseline forward only on --apply, so a dry run cannot consume the comparison.
if (existsSync(latestPath)) renameSync(latestPath, join(DIR, "previous.json"));
writeFileSync(latestPath, JSON.stringify(next, null, 2) + "\n");
console.log("  written: data/josh/hooks/latest.json\n");
