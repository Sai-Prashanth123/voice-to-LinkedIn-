#!/usr/bin/env node
/**
 * Fetch the reference writers' posts.
 *
 *   node scripts/scrape-sentinels.mjs --check              # credentials, spend nothing
 *   node scripts/scrape-sentinels.mjs --out data/josh/sentinels/scrape-2026-10-09.json
 *   node scripts/scrape-sentinels.mjs --only mattjbarker1 --out /tmp/matt.json
 *   node scripts/scrape-sentinels.mjs --via apify --out <file>   # force the fallback
 *
 * WHY THIS EXISTS
 *
 * The posts in the system were fetched through the Thought Pilot console by hand and loaded with a
 * script. Readable, correct, and not repeatable by Josh — and clause 14.3 says the system must keep
 * running unchanged if we stop work tomorrow. This is the repeatable path.
 *
 * TWO BACKENDS, AND THEY ARE NOT INTERCHANGEABLE
 *
 * | | console (default) | apify (fallback) |
 * |---|---|---|
 * | Needs | XP_API_KEY | APIFY_TOKEN |
 * | Whose infrastructure | ours | a vendor's |
 * | Line breaks in the text | STRIPPED | preserved |
 * | Measured | 44s for one profile | ~1-2 min for eight |
 *
 * The console is the default because it is already paid for and it is fast. The fallback exists
 * because a self-hosted scraper is a single point of failure in a way a vendor is not — and because
 * of the row in that table that matters.
 *
 * THE LINE BREAKS. Verified against the live API on 9 October 2026: all 14 rows of a Matt Barker
 * harvest came back as one unbroken paragraph each. That is not a glitch, it is what the endpoint
 * returns. It matters because every *shape* measurement here — paragraph count, words above the
 * fold, how a post opens and closes, whether it uses a list — is counted from line breaks.
 *
 * On 5 October a flat scrape went through unnoticed and the refresh reported seven writers changing
 * their habits. Nothing had changed but the scraper. So this script measures flatness, says so, and
 * marks the file: `shape_measurable: false` tells the loader to store the words and leave the shape
 * columns null rather than fill them with an artefact of the fetch.
 *
 * Use the console when the question is "what have they written lately". Use Apify when the question
 * is "has their structure moved". `refresh_sentinels` needs neither — it re-measures what is stored.
 *
 * WHAT IT DOES NOT DO
 *
 * Measure, judge, or write to the database. It fetches and writes one file. A script that both
 * fetched and judged would have to be trusted about what it discarded.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/*
 * The fetching and normalising live in a module because worker-engage needs the same three
 * things in Deno — fetch a profile, work out who actually wrote each row, normalise it. Two
 * copies of handleOf is the one outcome worth avoiding here: it is the function that was one
 * run away from filing a stranger's post under a reference writer's name.
 */
import {
  apifyApi,
  CONSOLE_BASE,
  consoleApi,
  fetchFromApify as harvestApify,
  fetchFromConsole as harvestConsole,
  normaliseRows,
  USER_AGENT,
} from "./lib/harvest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** Clause 8.3 names eight. Hardcoded, not an argument, so a careless run cannot widen the set. */
const SENTINELS = {
  demandjen1: "Jen Allen-Knuth",
  ryanscarlin: "Ryan Carlin",
  outboundphd: "Eric Nowoslawski",
  curtishowland: "Curtis Howland",
  "adam-treboutat": "Adam Treboutat",
  juliacarter98: "Julia Carter",
  amangrowth: "Aman Ghataura",
  mattjbarker1: "Matt Barker",
};

/*
 * CONSOLE_BASE, USER_AGENT, APIFY_ACTOR, the poll interval and both deadlines now live in
 * ./lib/harvest.mjs, imported above. The reasoning that was written here moved with them.
 */

/*
 * The default, not the ceiling. It was a hardcoded constant until 20 October, which capped every
 * Apify run at 50 posts per profile with nothing saying so — a run asked for 250 and returned 50
 * and looked like it had finished. `--max` overrides it; `--since` narrows the window instead.
 */
const POSTS_PER_PROFILE = 50;

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const has = (n) => process.argv.includes(n);

const outPath = arg("--out");
const only = arg("--only");
const checkOnly = has("--check");
const via = arg("--via") ?? null;

/*
 * How many, and how far back. Apify only — the console job input has no post-count parameter at
 * all, so passing either of these with --via console would silently do nothing, and this refuses
 * instead. `postedLimit` and `postedLimitDate` are in the actor's schema, read on 14 October, and
 * were never sent until now.
 */
const maxPosts = Number(arg("--max") ?? POSTS_PER_PROFILE);
const since = arg("--since");

if (!Number.isInteger(maxPosts) || maxPosts < 1) {
  console.error(`--max must be a whole number of posts, got "${arg("--max")}"`);
  process.exit(2);
}
if ((arg("--max") || since) && via === "console") {
  console.error("--max and --since are Apify-only. The console job input has no post-count or date parameter.");
  process.exit(2);
}
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`--since must be YYYY-MM-DD, got "${since}"`);
  process.exit(2);
}

if (!outPath && !checkOnly) {
  console.error(
    "usage: node scripts/scrape-sentinels.mjs --out <file.json> [--only <handle>] [--via console|apify]\n" +
      "                                        [--max <n>] [--since YYYY-MM-DD]   # apify only\n" +
      "       node scripts/scrape-sentinels.mjs --check",
  );
  process.exit(2);
}

/** Credentials come from .env like every other one here, checked in the three places they live. */
function env(name) {
  let text = "";
  for (const p of [join(ROOT, ".env"), join(ROOT, "mcp-server", ".env"), join(ROOT, "eval", ".env")]) {
    try {
      text += readFileSync(p, "utf8") + "\n";
    } catch { /* not every one exists */ }
  }
  return (process.env[name] ?? (text.match(new RegExp(`^${name}=(.*)$`, "m")) ?? [])[1] ?? "").trim();
}

// A comma-separated list, so the seven who still need collecting can run without paying to fetch
// the one who does not. Still validated against the eight, one name at a time.
const handles = only ? only.split(",").map((h) => h.trim()).filter(Boolean) : Object.keys(SENTINELS);
for (const h of handles) {
  if (!(h in SENTINELS)) {
    console.error(`"${h}" is not one of the eight reference writers.`);
    process.exit(2);
  }
}

/* ── The two backends, both from ./lib/harvest.mjs ──────────────────────── */

const creds = () => ({ key: env("XP_API_KEY"), base: env("XP_BASE") || CONSOLE_BASE });

/** Kept under the old names so --check below reads exactly as it did. */
const api = (method, path, body, timeoutMs) => consoleApi(creds(), method, path, body, timeoutMs);
const apify = apifyApi;

const progress = (line) => process.stdout.write(`\r  ${line}   `);
const urlsFor = (profileHandles) => profileHandles.map((h) => `https://www.linkedin.com/in/${h}/`);

async function fetchFromConsole(profileHandles) {
  const out = await harvestConsole({ profileUrls: urlsFor(profileHandles), ...creds(), log: progress });
  console.log();
  return out;
}

async function fetchFromApify(profileHandles) {
  const out = await harvestApify({
    profileUrls: urlsFor(profileHandles),
    token: env("APIFY_TOKEN"),
    maxPosts,
    since,
    log: progress,
  });
  console.log();
  return out;
}

/* ── Check ────────────────────────────────────────────────────────────────── */

if (checkOnly) {
  console.log("\n  console (primary)");
  if (!env("XP_API_KEY")) {
    console.log("    XP_API_KEY not set");
  } else {
    const h = await fetch(`${env("XP_BASE") || CONSOLE_BASE}/health`, { headers: { "User-Agent": USER_AGENT } });
    console.log(`    health: ${(await h.text()).slice(0, 80)}`);
    try {
      const jobs = await api("GET", "/jobs?limit=1");
      const n = Array.isArray(jobs) ? jobs.length : (jobs.items?.length ?? 0);
      console.log(`    key: accepted (${n} recent job${n === 1 ? "" : "s"} visible)`);
    } catch (e) {
      console.log(`    key: REJECTED — ${e.message.slice(0, 160)}`);
    }
  }

  console.log("\n  apify (fallback)");
  if (!env("APIFY_TOKEN")) {
    console.log("    APIFY_TOKEN not set — the fallback is unavailable, and with it the only");
    console.log("    backend whose text keeps its line breaks. See mcp-server/.env.example");
  } else {
    const me = await apify(`users/me?token=${env("APIFY_TOKEN")}`);
    // plan is an object on this endpoint, so the obvious interpolation printed "[object Object]".
    const plan = me.data?.plan;
    const planName = (typeof plan === "string" ? plan : plan?.id ?? plan?.name) ?? "unknown";
    console.log(`    token ok — ${me.data?.username ?? "account"}, plan ${planName}`);
  }

  console.log(`\n  would fetch ${handles.length} profile(s). Nothing was run and nothing was charged.\n`);
  process.exit(0);
}

/* ── Fetch, with the fallback it was designed around ──────────────────────── */

const want = via ?? (env("XP_API_KEY") ? "console" : "apify");
let result;

try {
  console.log(`\n  fetching ${handles.length} profile(s) via ${want}...`);
  result = want === "apify" ? await fetchFromApify(handles) : await fetchFromConsole(handles);
} catch (e) {
  console.error(`\n  ${want} failed: ${e.message}`);
  const other = want === "console" ? "apify" : "console";
  const haveOther = other === "apify" ? env("APIFY_TOKEN") : env("XP_API_KEY");
  if (via || !haveOther) {
    console.error(
      via
        ? "\n  --via was explicit, so not falling back. Drop it to allow the other backend."
        : `\n  No credentials for ${other}, so there is nothing to fall back to.`,
    );
    process.exit(1);
  }
  console.error(`\n  falling back to ${other}...`);
  result = other === "apify" ? await fetchFromApify(handles) : await fetchFromConsole(handles);
}

/* ── Normalise, from ./lib/harvest.mjs ───────────────────────────────────── */

/*
 * first(), toIso() and handleOf() moved to the module with their comments. The one change in the
 * move: handleOf takes the allowed set as an argument instead of closing over SENTINELS, so the
 * comment worker can pass Josh's creator list to the same guard. The eight are passed in here, so
 * this script behaves exactly as it did.
 *
 * It also stopped using `handle in SENTINELS`, which was true for "constructor" and "toString".
 */
const allowed = Object.fromEntries(handles.map((h) => [h, SENTINELS[h]]));
const { rows, foreign, unmapped: unmappedList } = normaliseRows(result.rows, allowed);
const unmapped = new Set(unmappedList);

/* ── Report ───────────────────────────────────────────────────────────────── */

const byHandle = new Map();
for (const r of rows) {
  const e = byHandle.get(r.author_handle) ?? { n: 0, breaks: 0 };
  e.n++;
  if (r.text.includes("\n")) e.breaks++;
  byHandle.set(r.author_handle, e);
}

console.log("\n  " + "-".repeat(62));
for (const h of handles) {
  const e = byHandle.get(h);
  console.log(
    `  ${h.padEnd(18)} ${String(e?.n ?? 0).padStart(3)} posts   ` +
      `${String(e?.breaks ?? 0).padStart(3)} with line breaks` +
      (e?.n ? "" : "   <-- nothing"),
  );
}
console.log("  " + "-".repeat(62));

if (foreign > 0) console.log(`  dropped ${foreign} post(s) by writers outside the eight`);
if (unmapped.size > 0) console.log(`  could not map: ${[...unmapped].join(", ")} on some rows`);

const withBreaks = rows.filter((r) => r.text.includes("\n")).length;
const shapeMeasurable = rows.length > 0 && withBreaks / rows.length >= 0.5;

if (!shapeMeasurable) {
  console.log(
    `\n  NOTE: ${rows.length - withBreaks} of ${rows.length} posts have no line breaks, so this file is\n` +
      `  marked shape_measurable: false. The words are intact and worth storing; the shape columns\n` +
      `  stay null rather than being filled from a corpus that cannot answer the question.\n` +
      (result.source === "console"
        ? `  Normal for the console — it always returns flat text. Use --via apify for shape.`
        : `  Unexpected from apify, which normally preserves them. Check a row in its console.`),
  );
}

writeFileSync(
  outPath,
  JSON.stringify(
    {
      fetched_at: new Date().toISOString(),
      source: result.source,
      job: result.job,
      shape_measurable: shapeMeasurable,
      posts: rows,
    },
    null,
    1,
  ),
);

console.log(`\n  wrote ${rows.length} posts to ${outPath}`);
console.log("\n  next:");
console.log(`    node scripts/load-reference-posts.mjs --posts ${outPath} --apply   # so Josh can read them`);
console.log(
  shapeMeasurable
    ? `    node scripts/sentinel-refresh.mjs    --posts ${outPath}            # what moved`
    : `    (no refresh from this file — it cannot answer a question about shape)`,
);
console.log();
