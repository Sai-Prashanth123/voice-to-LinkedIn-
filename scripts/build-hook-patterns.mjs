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

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { measureShape } from "../supabase/functions/_shared/shape.ts";
import { words, median, openingShape, turnAt, sentences } from "./lib/prose.mjs";
// His own standard, not a second opinion about what slop is. See rejectReason below.
import { scan, HIGH_CONFIDENCE } from "../mcp-server/aitells.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "josh", "hooks");
const APPLY = process.argv.includes("--apply");

/*
 * `--dump-openings [path]` — every opening this read, as text, for a human to check by eye.
 *
 * SEPARATE FROM THE LAW SET, ON PURPOSE, AND IT MUST STAY THAT WAY.
 *
 * `data/josh/hooks/latest.json` carries structure and no post text, enforced by the leak guard at
 * the foot of this file: 8.3 is "take the shape, never the words", and a law set holding the words
 * is a law set a draft can be written out of. That guard is not relaxed by this flag. The dump is
 * written to its own path, defaults OUTSIDE data/josh/, and nothing in the system loads it.
 *
 * It exists because every number this file publishes is derived from 3,261 opening lines that
 * nobody has ever read in one place. A rate is checkable only against the sample it came from, and
 * "0 found across 114 drafts" and "nothing to compare against" are different answers.
 *
 * The same hazard as docs/to-josh/hook-swipe-file.md applies and the dump says so in its header:
 * the content_agent and console_store openings are NOT in `reference_shingles`, so a draft that
 * lifted one would not be refused. Josh's eight ARE in it, so those are the safe ones to read.
 */
const DUMP_FLAG = process.argv.indexOf("--dump-openings");
const DUMP = DUMP_FLAG === -1
  ? null
  : (process.argv[DUMP_FLAG + 1] && !process.argv[DUMP_FLAG + 1].startsWith("--")
    ? process.argv[DUMP_FLAG + 1]
    : join(ROOT, "docs", "verify", "all-openings.md"));

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
      select: "activity_id,handle,text,opening_words,opening_shape,above_fold_words,paragraphs,reaction_count",
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
  return out
    .filter((p) => SENTINELS.has(p.handle) && (p.text ?? "").trim())
    .map((p) => ({ ...p, source: "josh_eight", reactions: p.reaction_count ?? null }));
}

/*
 * SOURCE B — the content-agent clients, read off disk.
 *
 * WHY A SECOND READER RATHER THAN A WIDER FILTER. The SENTINELS gate above is correct and stays:
 * clause 8.3 names eight, and `scrape-sentinels.mjs` says the same about its own copy — "hardcoded,
 * not an argument, so a careless run cannot widen the set". These are not Josh's writers and must
 * never be counted as them, so they arrive through their own door and carry their own label.
 *
 * WHY THEY ARE NOT WRITTEN TO `reference_writer_posts`, WHICH WOULD HAVE BEEN EASIER. Three reads
 * of that table have no handle filter, and each would absorb them silently:
 *
 *   - `build-reference-shingles.mjs` builds the borrowed-run index from the whole table. Every
 *     seven-word run of fourteen other people's clients would become a refusal surface for Josh's
 *     drafts — and migration 0051 revoked DELETE, so it could not be taken back without a
 *     migration.
 *   - `shape-rows.mjs` and `handlers/gate.ts` feed the ninth gate check's target band.
 *   - `corpusShapeBlock` would go on calling itself "the eight together".
 *
 * So this is a derived artefact and nothing else. Measured 2 November: 993 LinkedIn posts cached,
 * 873 with real line breaks, 14 clients, and 872 of the 873 carrying a reaction count — which is
 * the mirror image of Josh's corpus, where seven of eight writers have none at all.
 */
function contentAgentPosts() {
  const roots = [
    join(ROOT, "..", "..", "content-agent", "content-agent", "data", "clients"),
    "D:/content-agent/content-agent/data/clients",
  ];
  const dir = roots.find((d) => existsSync(d));
  if (!dir) return [];

  const out = [];
  for (const slug of readdirSync(dir)) {
    const file = join(dir, slug, "cache", "scrape.json");
    if (!existsSync(file)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // a half-written cache is not a reason to fail the whole run
    }
    for (const post of parsed?.posts?.linkedin ?? []) {
      const text = String(post?.text ?? "").replace(/\r/g, "");
      if (!text.trim() || post?.is_reshare) continue;
      out.push({
        activity_id: post.url ?? `${slug}:${post.date ?? ""}`,
        handle: slug,
        text,
        source: "content_agent",
        reactions: typeof post.reactions === "number" ? post.reactions : null,
        posted_at: post.date ?? null,
      });
    }
  }
  return out;
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

/*
 * SOURCE C — the scraping console's harvest store, for HOOKS ONLY. `--console` to include it.
 *
 * WHY IT CAN BE USED FOR HOOKS AND NOT FOR SHAPE, which is the whole point of it being separate.
 *
 * The console's LinkedIn parser stopped preserving line breaks around 28 September 2026. Verified
 * against the live API on 2 November: 200 consecutive harvest rows, ZERO newlines. That makes the
 * store useless for every shape measurement this repo takes — paragraph count, words above the
 * fold, list detection — because all of them are counted from line breaks, and a flat scrape once
 * made seven writers appear to change their habits overnight (5 October). It is filed as bug 5 in
 * docs/to-console/2026-10-19-platform-bugs.md and is still open.
 *
 * But a HOOK is line one, and the store carries `headline` on every row — 200 of 200, and a prefix
 * of the body text in 196 of them. So the one measurement that survives a flattened body is the one
 * this file is about. That is why hook collection can move off Apify now while shape collection
 * waits for the fix.
 *
 * `headline` IS THE FIRST SENTENCE, NOT THE FIRST LINE. On posts that do keep their breaks the two
 * agree about 70% of the time; on a flat post there is no first line to disagree with. Rows from
 * here are labelled so no reader mistakes one for the other.
 *
 * THE LONG TAIL IS DROPPED. The store is a feed scrape, not a reference library: 933 handles across
 * 2,042 posts, and 721 of those handles contribute exactly one post — conference check-ins and
 * team-pride posts with no structure to learn from. MIN_POSTS keeps only accounts that post enough
 * to have a habit.
 */
const MIN_POSTS_PER_HANDLE = 8;

async function consoleHarvestPosts() {
  const file = ["../.env", "../mcp-server/.env", "../eval/.env"]
    .map((p) => {
      try {
        return readFileSync(join(ROOT, p.replace("../", "")), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const base = field("XP_BASE");
  const key = field("XP_API_KEY");
  if (!base || !key) {
    console.log("  source C — console           : no XP_API_KEY on disk, skipped");
    return [];
  }

  const out = [];
  for (let offset = 0;; offset += 200) {
    const res = await fetch(
      base.replace(/\/+$/, "") + `/harvest/posts?limit=200&offset=${offset}`,
      { headers: { "X-API-Key": key } },
    );
    if (!res.ok) {
      console.log("  source C — console           : " + res.status + ", skipped");
      return [];
    }
    const body = await res.json();
    const items = body.items ?? body.posts ?? [];
    out.push(...items);
    if (items.length < 200 || offset > 5000) break;
  }

  const counts = {};
  for (const p of out) counts[p.author_handle] = (counts[p.author_handle] ?? 0) + 1;

  return out
    .filter((p) =>
      !p.is_repost &&
      String(p.headline ?? "").trim() &&
      (counts[p.author_handle] ?? 0) >= MIN_POSTS_PER_HANDLE
    )
    .map((p) => ({
      activity_id: p.activity_id,
      handle: p.author_handle,
      // The headline IS the line, deliberately. A flat body has no first line to take.
      text: String(p.headline).trim(),
      source: "console_store",
      reactions: typeof p.reaction_count === "number" ? p.reaction_count : null,
      posted_at: p.posted_at ?? null,
    }));
}

/* ── His own standard, applied before anything enters the corpus ──────────────
 *
 * WHY A FILTER AT ALL. The widest-reaching opening in the content-agent store is a bait-and-switch:
 * a marathon time, a promise of three business lessons, then "No, I'm joking haha." Josh's hooks
 * section has exactly two nevers, and one of them is **No bait** — "Deliberately provoking a
 * reaction to lift reach is effective and unwanted." Ranking 2,000 openings by engagement and
 * learning from the top would teach the drafter the one move his own rules forbid outright.
 *
 * WHY IT IS HIS RULES AND NOT A NEW DETECTOR. `scan()` already encodes the constructions his
 * library rules out, it is already calibrated against the writers he chose, and a second opinion
 * about what counts as slop is the failure this repository keeps finding. The only thing added here
 * is the question-opening rule, which is his and is about openings specifically.
 *
 * WHAT IS REPORTED. The count and a sample, in the artefact. A filter nobody has read is a filter
 * nobody can argue with, and on 2 November reading the sample is what showed the bullet rule was
 * still refusing numbered tiers.
 */
function rejectReason(line1) {
  if (!line1.trim()) return { why: "empty first line", matched: "" };
  // His rule, and the only one that is about the opening rather than the prose.
  if (/\?\s*$/.test(line1.trim())) {
    return { why: "opens on a question (his rule, hooks section)", matched: "?" };
  }

  const blocking = scan(line1).findings.filter(
    (f) => f.blocking !== false && HIGH_CONFIDENCE.has(f.rule),
  );
  if (blocking.length) {
    /*
     * The MATCHED STRING travels with the reason, and it has to.
     *
     * The first version returned the rule name alone, so the printed sample read "2C-8: formulaic
     * reveal" beside a line whose first 76 characters contained nothing of the sort — the trigger
     * was further along a first line that ran to 55 words. A sample you cannot check is a count
     * wearing a sample's clothes, which is the thing reading it was supposed to prevent.
     */
    return {
      why: `${blocking[0].rule}: ${blocking[0].name.toLowerCase()}`,
      matched: String(blocking[0].matched ?? ""),
    };
  }
  return null;
}

/* ── What a `statement` opening is actually doing ─────────────────────────────
 *
 * `statement` is over half the corpus and is not a shape — it is openingShape()'s fallthrough, the
 * openings that matched none of the other six. So for the majority of first lines the artefact
 * could tell a drafter nothing at all, which is the single biggest gap in what it can say.
 *
 * These seven came from READING 478 statement openings on 2 November, not from theory. They are
 * ordered, earliest match wins, same as openingShape.
 *
 * DELIBERATELY NOT IN scripts/lib/prose.mjs. `openingShape` writes `opening_shape` on 1,900 stored
 * rows and feeds the corpus distribution the drafting brief quotes; changing it would re-point
 * numbers that are already in briefs and in Josh's library. This is a second, finer reading layered
 * on top, and it lives with the artefact that uses it.
 */
function statementKind(line) {
  const t = (line ?? "").trim();
  if (!t) return "empty";
  // Opens on somebody's words. Checked first: a quote can contain anything.
  if (/^["“']|^[A-Z][a-z]+:\s*["“']/.test(t)) return "quote";
  // Addresses the reader's situation directly — the closest thing in the bucket to naming who it
  // is for, which his hooks section calls the highest-value tool available.
  if (/^(if|when|for)\s+(you|your|anyone|every|most|a |an |the )/i.test(t)) return "conditional";
  // A before and after, which is the contrast tool without the second line.
  if (/\b(used to|no longer|has changed|changed a lot|not any ?more|these days|back then)\b/i.test(t)) {
    return "used_to";
  }
  // An event: a date, a launch, an announcement, somebody else's news.
  if (/\b(announc\w+|launch\w+|dropped|released|today|last (week|month|friday|year)|big news|just )\b/i.test(t)) {
    return "news";
  }
  // Tells the reader to do something.
  if (/^(stop|start|do not|don'?t|never|always|connect|build|use|try|read|check|ask)\b/i.test(t)) {
    return "imperative";
  }
  // Something that happened, with a marker of occasion or person.
  if (/\b(i|we|my|our|me)\b/i.test(t) && /\b(was|were|had|got|came|went|found|saw|met|told|sent)\b/i.test(t)) {
    return "scene";
  }
  // What is left: a claim about how the world works. The commonest and the most generic.
  return "assertion";
}

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
  /*
   * EMOTION IS COMPUTED AND NO LONGER PUBLISHED — validated 2 November and cut.
   *
   * scripts/validate-investment.mjs scored it against 20 hand-labelled openings: 22% recall, 100%
   * precision. It finds two of every nine openings that genuinely carry an emotion, and misses
   * "I nearly quit in my second year", "My best client fired us on a Tuesday" and "Our pipeline
   * dried up in three weeks and I did not see it coming" — because it matches named feelings and
   * real openings carry implied ones.
   *
   * The 2.9% it reported across 3,261 openings was therefore a fact about the word list, not about
   * writers, and it was sitting beside measurements that are real. A labelled figure that is wrong
   * is worse than an absent one, because the label makes it credible.
   *
   * Kept in the row so a better detector can be scored against the same corpus without a rebuild,
   * and excluded from every published figure below.
   */
  const emotion = EMOTION.test(line1);
  // Two of the three required specificity, stakes and emotion. With emotion cut it is two of two,
  // which is a different and much weaker claim — see investment_elements in the output.
  const invCount = [specific, stakes].filter(Boolean).length;

  /*
   * HOW MUCH OF THE FOLD THE HOOK ITSELF EATS — the measurement nothing in this system had.
   *
   * A reader sees about three lines before "see more". `above_fold_words` counts the first three
   * lines AS WRITTEN; `hook_above_fold` asks whether the first SENTENCE fits. Neither answers the
   * thing Josh actually complained about, which is that the opening leaves nothing visible after
   * it: "it's just a wall of text… there's nothing here."
   *
   * So: render line one on its own and count the lines it draws. One or two leaves room for
   * something else above the cut; three fills it; four or more means the hook does not fit above
   * the fold at all.
   *
   * INHERITS THE UNCALIBRATED CONSTANTS, and the output says so. FOLD_CHARS_PER_LINE is 42 and
   * FOLD_LINES is 3, both flagged PROVISIONAL in shape.ts and never fitted against a real phone.
   * The direction is worth acting on; the number is not a measurement.
   */
  const foldLinesUsed = measureShape(line1).rendered_lines;

  return {
    handle: p.handle,
    source: p.source ?? "josh_eight",
    reactions: typeof p.reactions === "number" ? p.reactions : null,
    shape: p.opening_shape ?? openingShape(line1),
    // Only meaningful for the fallthrough bucket; null everywhere else keeps the two readings apart.
    statement_kind: (p.opening_shape ?? openingShape(line1)) === "statement" ? statementKind(line1) : null,
    line1,
    line1_words: typeof p.opening_words === "number" ? p.opening_words : words(line1),
    line2_words: words(line2),
    // Does line two answer line one, or add to it? His hooks section calls the second of those
    // "two stacked gaps" and nothing has ever measured it.
    line2_resolves: line2 ? FIGURE.test(line2) && !FIGURE.test(line1) : null,
    line2_present: Boolean(line2),
    above_fold_words: shape.above_fold_words,
    hook_above_fold: shape.hook_above_fold,
    fold_lines_used: foldLinesUsed,
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

/**
 * How many of the three fold lines the hook uses, as a distribution.
 *
 * `fills_or_overflows` is the headline: the share of openings that leave nothing visible above the
 * cut. Measured 2 November across the content-agent corpus it was 35%.
 */
function foldUse(rows) {
  const b = { one: 0, two: 0, three: 0, four_or_more: 0 };
  for (const r of rows) {
    if (r.fold_lines_used <= 1) b.one++;
    else if (r.fold_lines_used === 2) b.two++;
    else if (r.fold_lines_used === 3) b.three++;
    else b.four_or_more++;
  }
  const n = rows.length;
  return {
    lines_the_hook_uses: {
      one: pct(b.one, n),
      two: pct(b.two, n),
      three: pct(b.three, n),
      four_or_more: pct(b.four_or_more, n),
    },
    leaves_room_pct: pct(b.one + b.two, n),
    fills_or_overflows_pct: pct(b.three + b.four_or_more, n),
  };
}

/**
 * Reactions by fold-use bucket, each post scored against its OWN author's median.
 *
 * Normalised within author because follower counts differ by two orders of magnitude across these
 * accounts, and an un-normalised median would simply rank the biggest account's habits first.
 * Authors with fewer than 15 measured posts are dropped: a median of six posts is not one.
 *
 * REPORTED, NEVER TURNED INTO A RULE. Migration 0004 is explicit about why — "A system optimising
 * freely against LinkedIn engagement finds its way to engagement bait, because that is what the
 * metric rewards." This ranks a swipe file for a human to read and goes no further.
 */
function engagementByFoldUse(rows) {
  const byAuthor = {};
  for (const r of rows) {
    if (typeof r.reactions !== "number" || r.reactions <= 0) continue;
    (byAuthor[r.handle] ??= []).push(r);
  }
  const buckets = {};
  let authors = 0;
  for (const rs of Object.values(byAuthor)) {
    if (rs.length < 15) continue;
    authors++;
    const med = median(rs.map((r) => r.reactions)) || 1;
    for (const r of rs) {
      const k = r.fold_lines_used <= 1 ? "one"
        : r.fold_lines_used === 2 ? "two"
        : r.fold_lines_used === 3 ? "three"
        : "four_or_more";
      (buckets[k] ??= []).push(r.reactions / med);
    }
  }
  if (!authors) return null;
  const out = { authors, means: "1.00 is that author's own median post." };
  for (const k of ["one", "two", "three", "four_or_more"]) {
    if (buckets[k]?.length) {
      out[k] = { posts: buckets[k].length, relative_reactions: +median(buckets[k]).toFixed(2) };
    }
  }
  out.how_much_to_trust_it =
    "SUGGESTIVE, NOT A MEASUREMENT. The buckets rest on FOLD_CHARS_PER_LINE = 42 and FOLD_LINES = " +
    "3, both flagged PROVISIONAL in shape.ts and never fitted against a real phone. The spread is " +
    "about 20% and the direction is worth acting on; the figure is not something to quote at Josh " +
    "as a finding.";
  return out;
}
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
        // What the hook costs of the three lines a reader sees. New on 2 November.
        fold: foldUse(rs),
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
      /*
       * TWO CORPORA, AND THEY ARE NOT THE SAME THING.
       *
       * `josh_eight` are the writers Josh chose for their storytelling structure. `content_agent`
       * are fourteen other people's clients, read from a sibling repo — a different population,
       * some of it agency personal-brand content, and NOT his roster. Every figure below that is
       * split says which it came from, because a number labelled "the writers he chose" that
       * silently includes fourteen strangers is the standard changing without him.
       */
      by_source: Object.fromEntries(
        ["josh_eight", "content_agent", "console_store"].map((s) => {
          const rs = rows.filter((r) => r.source === s);
          return [s, {
            posts: rs.length,
            accounts: new Set(rs.map((r) => r.handle)).size,
            with_reactions: rs.filter((r) => typeof r.reactions === "number" && r.reactions > 0).length,
          }];
        }),
      ),
      whose_they_are: {
        josh_eight:
          "The eight Josh chose, for their storytelling structure. THIS IS THE STANDARD. Where the " +
          "two corpora disagree about what a good opening looks like, these win. Engagement exists " +
          "for mattjbarker1 only.",
        content_agent:
          "Clients of the sibling content-agent project, read from its on-disk caches. Not Josh's " +
          "writers and never to be reported as them. Their value is volume, fourteen more voices, " +
          "and engagement on almost every post — which his own corpus does not have.",
        console_store:
          "The scraping console's harvest store, headlines only, accounts with eight or more posts. " +
          "Widest and weakest: nobody chose these accounts and the bodies are flat. Present for " +
          "first-line volume and engagement, and for nothing else. See source_c_caveat.",
      },
      /*
       * WHAT SOURCE B IS NOT GOOD FOR, found by reading it rather than counting it.
       *
       * These are working B2B creators, not a reference library chosen for structure, and some of
       * what they post is personal-brand marketing: listicle-and-arrow openings, hiring ads run as
       * content, lifestyle posts. His rules catch the constructions they name — a question opening,
       * a throat-clear, a formulaic reveal — and they do NOT catch "If you run GTM, this one is for
       * you" with an arrow after it, because nothing in his library bans that shape.
       *
       * Deliberately not fixed by writing a bait detector. His library is the standard and a second
       * opinion about what slop is would be two standards. The honest handling is to say so here,
       * keep the corpora separable, and let the brief lean on source A for what good looks like.
       */
      source_c_caveat:
        "HOOKS ONLY, and its line one is a first SENTENCE rather than a first line. The scraping " +
        "console stopped preserving line breaks around 28 September 2026 — verified 2 November, " +
        "200 consecutive rows with zero newlines — so its bodies cannot be measured for shape at " +
        "all. What survives is the `headline` field, present on every row and a prefix of the body " +
        "in 98% of them, which is enough for a hook and nothing else. Accounts with fewer than " +
        "eight posts are dropped: the store is a feed scrape and most of its handles contribute " +
        "one conference check-in. Opt in with --console; it is not in a default build.",
      source_b_caveat:
        "Working creators, not a structure reference. Some of it is personal-brand marketing that " +
        "his rules do not name and therefore do not exclude. Use source B for volume, for the fold " +
        "distribution and for engagement evidence; use source A for what a good opening is.",
    },
    what_these_are:
      "STRUCTURE ONLY. No sentence from any post is in this file, and the run refuses to write if " +
      "one is. Take the shape, never the words (8.3) — and create_draft refuses any draft sharing " +
      "a seven-word run with a stored reference post, so a borrowed opening would not file anyway.",
    the_number_claim_caveat:
      "`number_claim` means a number ABOUT THE WRITER, not any number. openingShape requires a " +
      "figure AND a first-person pronoun in the same line (scripts/lib/prose.mjs), so \"3,941 " +
      "practices, read one at a time off a vendor's booking page\" classifies as `statement` " +
      "despite leading on a figure. Found 2 November by running candidate hooks through the " +
      "classifier. It is not a bug — the distinction is real and useful — but a drafter aiming at " +
      "`number_claim` has to put himself in the line, and nothing said so before.",
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
        emotion_withdrawn:
          "Cut on 2 November after validation. 22% recall against 20 hand-labelled openings — it " +
          "found two of every nine that genuinely carry an emotion. The 2.9% it used to report " +
          "was a fact about a word list, not about writers. scripts/validate-investment.mjs.",
      },
      /*
       * THE ERROR ON THE FIGURES ABOVE, measured rather than asserted. The precedent is
       * scripts/measure-structure.mjs, which published its list detector's confusion matrix and
       * was right to: re-tested at scale, 90% became 83.8%.
       */
      investment_detector_accuracy: {
        basis: "20 openings labelled by hand, scripts/validate-investment.mjs --score",
        stakes: { recall_pct: 67, precision_pct: 60 },
        specificity: "not scored — a figure or a proper noun is a mechanical test, not a reading",
        means:
          "Stakes finds about two thirds of the openings that carry them and is right about three " +
          "in five of the ones it flags, missing implied risk and firing on 'cost' and 'dead' used " +
          "in another sense. Use it as an indication and never as a count.",
      },
      names_the_reader_pct: pct(rows.filter((r) => r.names_reader).length, rows.length),
      /*
       * WHAT THE BIGGEST BUCKET IS ACTUALLY DOING.
       *
       * `statement` is over half the corpus and is openingShape's fallthrough, so without this the
       * artefact says nothing about the majority of first lines. The seven kinds came from reading
       * 478 of them on 2 November — see statementKind.
       */
      statement_is_really: (() => {
        const st = rows.filter((r) => r.statement_kind);
        const tally = {};
        for (const r of st) tally[r.statement_kind] = (tally[r.statement_kind] ?? 0) + 1;
        return {
          of: st.length,
          means:
            "Shares of the statement bucket, not of the whole corpus. Aiming at `statement` is " +
            "aiming at none of the other six shapes; these say which move the line actually makes.",
          kinds: Object.entries(tally).sort((a, b) => b[1] - a[1])
            .map(([k, n]) => [k, pct(n, st.length)]),
        };
      })(),
      /*
       * LINE TWO, which his own toolkit names and nothing had ever measured.
       *
       * His hooks section lists "two stacked gaps" as a tool: "Line two refuses to answer line one
       * and adds a second question instead of resolving the first." Every measurement in this file
       * was about line one, so the one move his section describes in terms of the SECOND line was
       * invisible.
       *
       * `resolves` is a proxy and a narrow one: it asks whether a figure arrives in line two that
       * was withheld in line one. That catches the commonest resolution — the number — and misses
       * every resolution that is not a number. Reported with its own limit attached rather than
       * dressed up as a reading of what line two does.
       */
      line_two: (() => {
        const withSecond = rows.filter((r) => r.line2_present);
        return {
          posts_with_a_second_line: withSecond.length,
          median_words: median(withSecond.map((r) => r.line2_words)),
          resolves_with_a_figure_pct: pct(
            withSecond.filter((r) => r.line2_resolves).length,
            withSecond.length,
          ),
          means:
            "A low share means these writers mostly do NOT answer line one in line two — which is " +
            "the stacked-gap move his hooks section describes. It counts figures only, so a line " +
            "that resolves in words is invisible to it.",
        };
      })(),
      /*
       * THE HEADLINE FINDING, and the reason this corpus was widened at all.
       *
       * Josh, 30 October, pasting a draft into a preview tool: "it's just a wall of text… there's
       * nothing here." Nothing in this system measured how much of the fold the OPENING consumes —
       * `above_fold_words` counts the first three lines as written, `hook_above_fold` asks whether
       * the first sentence fits, and neither says whether anything is left visible after it.
       *
       * Measured across the content-agent corpus on 2 November: 35% of openings fill the three
       * lines or overflow them, so a third of posts show their reader the hook and nothing else.
       */
      fold: foldUse(rows),
      reactions_by_fold_use: engagementByFoldUse(rows),
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
const joshEight = await allPosts();
console.log("  source A — the eight he chose: " + joshEight.length + " posts, " +
  new Set(joshEight.map((p) => p.handle)).size + " writers");

const contentAgent = contentAgentPosts();
const caShaped = contentAgent.filter((p) => p.text.includes("\n"));
console.log("  source B — content-agent     : " + caShaped.length + " posts with line breaks, " +
  new Set(caShaped.map((p) => p.handle)).size + " clients" +
  (contentAgent.length === 0 ? "  (cache not found — source A only)" : ""));

/*
 * Source C is opt-in with --console, because it changes what the corpus IS. A and B are measured
 * first lines; C is a first sentence taken from a flattened body. Mixing them silently would make
 * the shape distribution a fact about two different kinds of reading.
 */
const consoleRows = process.argv.includes("--console") ? await consoleHarvestPosts() : [];
if (consoleRows.length) {
  console.log("  source C — console store     : " + consoleRows.length + " headlines, " +
    new Set(consoleRows.map((p) => p.handle)).size + " accounts with " +
    MIN_POSTS_PER_HANDLE + "+ posts  (hooks only — bodies are flat)");
}

/*
 * Only posts that kept their line breaks, for A and B and the same reason: a post that arrived as
 * one unbroken line would report the scraper's behaviour as a habit of the writer. Source C is
 * exempt because it carries no body at all — only the headline, which is the line.
 */
const posts = [...joshEight, ...caShaped, ...consoleRows];

/*
 * HIS OWN STANDARD, BEFORE ANYTHING IS COUNTED. See rejectReason. Both the count and a sample go
 * into the artefact, so the line being drawn can be read rather than trusted.
 */
const rejected = [];
const kept = [];
for (const p of posts) {
  const line1 = (p.text ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  const verdict = rejectReason(line1);
  if (verdict) {
    rejected.push({ source: p.source, handle: p.handle, why: verdict.why, matched: verdict.matched, line1 });
  } else kept.push(p);
}
console.log("  excluded by his own rules    : " + rejected.length +
  " of " + posts.length + " (" + ((100 * rejected.length) / posts.length).toFixed(1) + "%)");

const rows = kept.map(measureOne);
const next = aggregate(rows);

/*
 * THE DUMP. Written here because `rows` is the measured set and `rejected` is what his own rules
 * threw out, and a verification file that showed only the survivors would hide the line being
 * drawn — which is the half most worth checking.
 */
if (DUMP) {
  const bySource = { josh_eight: [], content_agent: [], console_store: [] };
  for (const r of rows) (bySource[r.source] ??= []).push(r);

  const LABEL = {
    josh_eight: "SOURCE A — the eight Josh chose. THE STANDARD. These ARE in reference_shingles, " +
      "so a draft that lifted one of these lines would be refused.",
    content_agent: "SOURCE B — clients of the sibling content-agent project, read from its " +
      "on-disk caches. NOT Josh's writers and never to be reported as them. NOT in " +
      "reference_shingles: a draft lifting one of these would not be refused.",
    console_store: "SOURCE C — the scraping console's harvest store. HEADLINES ONLY: the console " +
      "strips line breaks, so these have no body and no line two. NOT in reference_shingles.",
  };

  const out = [];
  out.push("# Every opening the hook corpus learned from");
  out.push("");
  out.push("**Generated " + new Date().toISOString().slice(0, 10) + " by " +
    "`scripts/build-hook-patterns.mjs --dump-openings`.** Regenerate rather than edit: nothing " +
    "reads this file, and a hand-edited copy would disagree with the measurements silently.");
  out.push("");
  out.push("`" + rows.length + "` openings kept across `" + Object.keys(next.per_writer).length +
    "` accounts, plus `" + rejected.length + "` his own rules excluded, out of `" + posts.length +
    "` posts read.");
  out.push("");
  out.push("## Read this first");
  out.push("");
  out.push("**This file is for checking the corpus, not for drafting from.** `create_draft` " +
    "refuses a draft sharing a seven-word run with Josh's eight reference writers, and that guard " +
    "is what makes clause 8.3 real. Sources B and C are **not** in that index, so a lifted line " +
    "from them would not be caught. Take the shape. Never the sentence.");
  out.push("");
  out.push("Columns are `fold · words · shape` and, where the author has reactions recorded, " +
    "`×n` against that author's own median post so a large account and a small one compare. " +
    "The fold is simulated at 42 characters a line and **has never been calibrated against a " +
    "real phone**, so treat it as a direction and not a measurement.");
  out.push("");

  const bar = (n) => "▮".repeat(Math.min(n, 3)) + "▯".repeat(Math.max(0, 3 - n)) + (n > 3 ? "+" : "");

  for (const source of ["josh_eight", "content_agent", "console_store"]) {
    const group = bySource[source] ?? [];
    if (!group.length) continue;
    out.push("---");
    out.push("");
    out.push("# " + source + "  (" + group.length + " openings)");
    out.push("");
    out.push(LABEL[source]);
    out.push("");

    const byHandle = {};
    for (const r of group) (byHandle[r.handle] ??= []).push(r);

    for (const handle of Object.keys(byHandle).sort()) {
      const mine = byHandle[handle];
      // Within an author, so follower count cannot order the file.
      const med = median(mine.map((r) => r.reactions).filter((n) => typeof n === "number")) || 0;
      mine.sort((a, b) => (b.reactions ?? -1) - (a.reactions ?? -1));
      out.push("## " + handle + "  (" + mine.length + ")");
      out.push("");
      for (const r of mine) {
        const mult = typeof r.reactions === "number" && med > 0
          ? "  ×" + (r.reactions / med).toFixed(1)
          : "";
        out.push("- `" + bar(r.fold_lines_used ?? measureShape(r.line1).rendered_lines) + "` · " +
          String(r.line1_words).padStart(2) + "w · " + r.shape + mult + "  — " + r.line1);
      }
      out.push("");
    }
  }

  out.push("---");
  out.push("");
  out.push("# Excluded by his own rules  (" + rejected.length + ")");
  out.push("");
  out.push("Not failures of the writers. These are openings his library forbids him, so they are " +
    "excluded before anything is counted — which is why the rates above are about writing he " +
    "would accept rather than about LinkedIn.");
  out.push("");
  const byWhy = {};
  for (const r of rejected) (byWhy[r.why] ??= []).push(r);
  for (const why of Object.keys(byWhy).sort((a, b) => byWhy[b].length - byWhy[a].length)) {
    out.push("## " + why + "  (" + byWhy[why].length + ")");
    out.push("");
    for (const r of byWhy[why]) {
      out.push("- [" + r.source + " · " + r.handle + "] " + r.line1);
    }
    out.push("");
  }

  mkdirSync(dirname(DUMP), { recursive: true });
  writeFileSync(DUMP, out.join("\n") + "\n");
  console.log("  dumped " + rows.length + " openings + " + rejected.length +
    " excluded -> " + DUMP.replace(ROOT, "."));
}
next.excluded_by_his_rules = {
  count: rejected.length,
  of: posts.length,
  why_a_filter:
    "His hooks section has two nevers and one of them is No bait. The widest-reaching opening in " +
    "the content-agent store is a bait-and-switch — a marathon time, three promised business " +
    "lessons, then \"No, I'm joking haha.\" Ranking by engagement and learning from the top would " +
    "teach the drafter the one move his rules forbid outright.",
  what_judged_it:
    "scan() from mcp-server/aitells.mjs, which encodes the constructions his library rules out, " +
    "plus his rule against opening on a question. Not a second opinion about what slop is.",
  by_reason: Object.entries(
    rejected.reduce((a, r) => ((a[r.why] = (a[r.why] ?? 0) + 1), a), {}),
  ).sort((a, b) => b[1] - a[1]),
};

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
  "%  (emotion cut — 22% recall)  -> both " + aw.two_or_more_investment_elements_pct + "%");
console.log("    stakes detector: 67% recall, 60% precision against 20 hand-labelled openings");
const f = aw.fold;
console.log("\n  WHAT THE HOOK COSTS OF THE FOLD — the measurement nothing had:");
console.log("    the hook alone uses  1 line " + f.lines_the_hook_uses.one +
  "%  2 lines " + f.lines_the_hook_uses.two +
  "%  3 lines " + f.lines_the_hook_uses.three +
  "%  4+ " + f.lines_the_hook_uses.four_or_more + "%");
console.log("    leaves room for something else above the cut: " + f.leaves_room_pct + "%");
console.log("    FILLS OR OVERFLOWS the three lines         : " + f.fills_or_overflows_pct +
  "%   <- his \"wall of text\", measured");
if (aw.reactions_by_fold_use) {
  const r = aw.reactions_by_fold_use;
  console.log("    reactions vs that, within author (" + r.authors + " authors, 1.00 = their median):");
  console.log("      " + ["one", "two", "three", "four_or_more"]
    .filter((k) => r[k])
    .map((k) => k.replace("_or_more", "+") + " " + r[k].relative_reactions)
    .join("   ") + "   SUGGESTIVE ONLY — uncalibrated fold constants");
}

console.log("\n    NOTE: two-or-more at " + aw.two_or_more_investment_elements_pct +
  "% means an investment floor would fail most of the writers he chose. Reported, never enforced.");

/*
 * A SAMPLE OF WHAT HIS RULES EXCLUDED, printed and never written.
 *
 * The plan says to read the sample by eye, and on 2 November reading one is what showed the bullet
 * rule was still refusing numbered tiers. But these are real openings by real people: putting them
 * in the artefact would be the swipe file this file exists to refuse, and the leak guard below
 * would stop it anyway. So they go to the terminal for whoever ran the script.
 */
if (rejected.length) {
  console.log("\n  A SAMPLE OF WHAT HIS RULES EXCLUDED — read it, do not just count it:\n");
  // Up to two per REASON rather than every nth row: an even sample of 190 rejections is eight
  // examples of whichever reason is commonest, which tells you nothing about the other reasons.
  const seen = {};
  for (const r of rejected) {
    seen[r.why] ??= [];
    if (seen[r.why].length < 2) seen[r.why].push(r);
  }
  for (const [why, items] of Object.entries(seen)) {
    console.log("    " + why + "  (" + next.excluded_by_his_rules.by_reason
      .find(([w]) => w === why)?.[1] + " in all)");
    for (const r of items) {
      console.log("      matched " + JSON.stringify(r.matched));
      console.log("        " + r.line1.slice(0, 84).replace(/\s+/g, " "));
    }
  }
}

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
