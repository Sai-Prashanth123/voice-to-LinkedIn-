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

const CONSOLE_BASE = "https://scraping.thought-pilot.co/api";

/*
 * Cloudflare fronts the console and answers a default Node or urllib User-Agent with 403 "error code
 * 1010". GETs happened to pass while POST /jobs did not, so it looked like a permissions problem on
 * one endpoint rather than a UA filter. Identifying the client honestly is the right thing anyway.
 */
const USER_AGENT = "voice-to-content/1.0 (+reference-writer refresh)";

const APIFY_ACTOR = "harvestapi~linkedin-profile-posts";
const POSTS_PER_PROFILE = 50;
const POLL_EVERY_MS = 10_000;
const CONSOLE_DEADLINE_MS = 10 * 60_000;
const APIFY_DEADLINE_MS = 15 * 60_000;

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const has = (n) => process.argv.includes(n);

const outPath = arg("--out");
const only = arg("--only");
const checkOnly = has("--check");
const via = arg("--via") ?? null;

if (!outPath && !checkOnly) {
  console.error(
    "usage: node scripts/scrape-sentinels.mjs --out <file.json> [--only <handle>] [--via console|apify]\n" +
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

const handles = only ? [only] : Object.keys(SENTINELS);
for (const h of handles) {
  if (!(h in SENTINELS)) {
    console.error(`"${h}" is not one of the eight reference writers.`);
    process.exit(2);
  }
}

/* ── The console ──────────────────────────────────────────────────────────── */

const api = async (method, path, body, timeoutMs = 60_000) => {
  const res = await fetch(`${env("XP_BASE") || CONSOLE_BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": env("XP_API_KEY"),
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

async function fetchFromConsole(profileHandles) {
  const urls = profileHandles.map((h) => `https://www.linkedin.com/in/${h}/`);

  // ttl_seconds 0 forces a fresh read. The default is 86400, which would serve yesterday's answer to
  // a question asked today — right for a daily harvest, wrong for "what have they posted lately".
  const job = await api("POST", "/jobs", {
    actor: "linkedin-harvest",
    input: { urls, entity_type: "profile", ttl_seconds: 0 },
  });
  if (!job?.id) throw new Error(`no job id: ${JSON.stringify(job).slice(0, 200)}`);
  console.log(`  console job ${job.id}, ${urls.length} profile(s)`);

  const TERMINAL = ["succeeded", "completed", "success", "failed", "error", "cancelled", "canceled"];
  const startedAt = Date.now();
  let state = job;
  while (!TERMINAL.includes(String(state.status).toLowerCase())) {
    if (Date.now() - startedAt > CONSOLE_DEADLINE_MS) {
      throw new Error(`job ${job.id} still ${state.status} after 10 minutes`);
    }
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    state = await api("GET", `/jobs/${job.id}`);
    process.stdout.write(`\r  ${state.status}, ${Math.round((Date.now() - startedAt) / 1000)}s   `);
  }
  console.log();

  if (!["succeeded", "completed", "success"].includes(String(state.status).toLowerCase())) {
    throw new Error(`job ${job.id} ${state.status}: ${state.error ?? "no reason given"}`);
  }

  /*
   * Judge the run by the rows it returns, not by its own counters.
   *
   * Measured 9 October: a job that returned 14 real posts reported `items_scraped: 0` and
   * `coverage: "unknown"`. The older Python client against this API raised on exactly that
   * combination, which here would throw away a perfectly good harvest. Those counters belong to the
   * actors that fill them.
   */
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api("GET", `/jobs/${job.id}/linkedin-posts?limit=100&offset=${offset}`, undefined, 90_000);
    const batch = Array.isArray(page) ? page : (page.items ?? []);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  if (rows.length === 0) {
    throw new Error(
      `job ${job.id} succeeded but returned no posts.\n` +
        `  That is distinct from "they have not posted": the scraper returned without reading the\n` +
        `  page, usually because LinkedIn is blocking the egress IP. Try --via apify.`,
    );
  }
  return { rows, source: "console", job: job.id };
}

/* ── Apify, the fallback ──────────────────────────────────────────────────── */

const apify = async (path, init = {}) => {
  const res = await fetch(`https://api.apify.com/v2/${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) throw new Error(`apify ${path.split("?")[0]}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

async function fetchFromApify(profileHandles) {
  const token = env("APIFY_TOKEN");
  if (!token) throw new Error("APIFY_TOKEN not set — see mcp-server/.env.example");

  const started = await apify(`acts/${APIFY_ACTOR}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileUrls: profileHandles.map((h) => `https://www.linkedin.com/in/${h}/`),
      maxPosts: POSTS_PER_PROFILE,
    }),
  });
  const runId = started.data?.id;
  if (!runId) throw new Error(`no run id: ${JSON.stringify(started).slice(0, 200)}`);
  console.log(`  apify run ${runId} — https://console.apify.com/actors/runs/${runId}`);

  const startedAt = Date.now();
  let status = started.data?.status ?? "RUNNING";
  let datasetId = started.data?.defaultDatasetId ?? null;
  while (["READY", "RUNNING"].includes(status)) {
    if (Date.now() - startedAt > APIFY_DEADLINE_MS) throw new Error(`run ${runId} still ${status} after 15 minutes`);
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    const run = await apify(`actor-runs/${runId}?token=${token}`);
    status = run.data?.status;
    datasetId = run.data?.defaultDatasetId ?? datasetId;
    process.stdout.write(`\r  ${status}, ${Math.round((Date.now() - startedAt) / 1000)}s   `);
  }
  console.log();
  if (status !== "SUCCEEDED") throw new Error(`apify run finished as ${status}`);

  const items = await apify(`datasets/${datasetId}/items?token=${token}&clean=true&limit=2000`);
  return { rows: Array.isArray(items) ? items : [], source: "apify", job: runId };
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
    console.log(`    token ok — ${me.data?.username ?? "account"}, plan ${me.data?.plan ?? "unknown"}`);
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

/* ── Normalise ────────────────────────────────────────────────────────────── */

const first = (row, ...names) => {
  for (const n of names) {
    const v = n.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

const handleOf = (row) => {
  const direct = first(row, "author_handle", "authorHandle", "username");
  if (direct && direct in SENTINELS) return direct;
  const url = String(first(row, "authorUrl", "author.url", "profileUrl", "inputUrl") ?? "");
  const slug = url.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1];
  return slug && slug in SENTINELS ? slug : null;
};

const unmapped = new Set();
let foreign = 0;
const rows = [];

for (const row of result.rows) {
  const handle = handleOf(row);

  /*
   * Drop anyone who is not one of the eight. Not paranoia about the argument list — it is what the
   * data actually contains. Measured 9 October: a harvest of Matt Barker's profile returned 14 rows
   * of which 8 were his. A profile page carries other people's posts, and the row says so in two
   * fields: `author_handle` wrote it, `subject_handle` is whose page it came from. Reading the
   * second as the author would file six strangers' posts under Matt's name.
   */
  if (!handle) {
    foreign++;
    continue;
  }

  const text = String(first(row, "text", "content", "postText", "description") ?? "").trim();
  if (!text) {
    unmapped.add("text");
    continue;
  }
  const postedAt = first(row, "posted_at", "postedAt", "date", "publishedAt", "postedAtISO");
  if (!postedAt) unmapped.add("posted_at");

  rows.push({
    activity_id: String(
      first(row, "activity_id", "activityId", "postId", "urn", "id") ??
        `${handle}:${postedAt ?? ""}:${text.slice(0, 40)}`,
    ),
    author_handle: handle,
    author_name: first(row, "author_name", "authorName", "author.name", "fullName") ?? SENTINELS[handle],
    url: first(row, "url", "postUrl", "link"),
    posted_at: postedAt,
    text,
    headline: first(row, "headline"),
    reaction_count: first(row, "reaction_count", "reactionsCount", "likesCount", "numLikes"),
    comment_count: first(row, "comment_count", "commentsCount", "numComments"),
    is_repost: Boolean(first(row, "is_repost", "isRepost", "reshared")),
  });
}

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
