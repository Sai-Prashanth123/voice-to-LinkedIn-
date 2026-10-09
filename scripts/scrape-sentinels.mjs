#!/usr/bin/env node
/**
 * Fetch the reference writers' posts on Josh's own key.
 *
 *   node scripts/scrape-sentinels.mjs --out data/josh/sentinels/scrape-$(date +%F).json
 *   node scripts/scrape-sentinels.mjs --check          # validate the token, spend nothing
 *   node scripts/scrape-sentinels.mjs --only mattjbarker1 --out /tmp/matt.json
 *
 * WHY THIS EXISTS
 *
 * The 138 posts currently in the system were fetched through Thought Pilot's scraping console and
 * loaded by hand. That console is an MCP server inside our Claude session: nothing in this repository
 * and nothing in the Supabase project can reach it. So until this script existed, refreshing the
 * reference writers was something only we could do — and the continuity test in clause 14.3 says the
 * system has to keep running unchanged if we stop work tomorrow.
 *
 * Apify because Josh named it himself, unprompted, at the kickoff call: "I think you can just
 * actually, we can just scrape that through apify." It is self-serve, pay per run, and a token is one
 * page in his account.
 *
 * WHAT IT DOES NOT DO
 *
 * Measure, judge, or write to the database. It fetches and it writes one file. `sentinel-refresh.mjs`
 * measures that file and `load-reference-posts.mjs` stores it — and the separation is deliberate:
 * a script that both fetched and judged would have to be trusted about what it discarded.
 *
 * UNTESTED AGAINST A LIVE TOKEN
 *
 * Written without an Apify account to run it against, so the request shape follows Apify's documented
 * API and the field mapping is defensive: it tries the names their LinkedIn actors are known to use
 * and reports, per post, anything it could not map rather than silently writing nulls. Run `--check`
 * first; it validates the token and the actor without starting a run.
 */

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/**
 * Clause 8.3 names eight writers. Hardcoded rather than taken from an argument, so a careless run
 * cannot widen the set — the same reason `sentinel-refresh.mjs` filters to these on the way in.
 */
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

/**
 * The actor. `harvestapi/linkedin-profile-posts` runs entirely on Apify's infrastructure and needs no
 * LinkedIn cookie, which matters: a cookie-based scraper puts an account at risk, and it would have to
 * be somebody's account.
 */
const ACTOR = "harvestapi~linkedin-profile-posts";
const POSTS_PER_PROFILE = 50;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const has = (name) => process.argv.includes(name);

const outPath = arg("--out");
const only = arg("--only");
const checkOnly = has("--check");
const acceptFlat = has("--accept-flat");

if (!outPath && !checkOnly) {
  console.error("usage: node scripts/scrape-sentinels.mjs --out <file.json> [--only <handle>] [--check]");
  process.exit(2);
}

function token() {
  let file = "";
  for (const p of [join(ROOT, ".env"), join(ROOT, "mcp-server", ".env"), join(ROOT, "eval", ".env")]) {
    try {
      file += readFileSync(p, "utf8") + "\n";
    } catch { /* not every one exists */ }
  }
  const value = process.env.APIFY_TOKEN ??
    (file.match(/^APIFY_TOKEN=(.*)$/m) ?? [])[1]?.trim();

  if (!value) {
    console.error(
      "No APIFY_TOKEN.\n\n" +
        "  1. Sign in at https://console.apify.com and copy a token from Settings → Integrations\n" +
        "  2. Add it to .env as:  APIFY_TOKEN=apify_api_...\n\n" +
        "It is charged per run, and this script fetches eight profiles.",
    );
    process.exit(2);
  }
  return value;
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.apify.com/v2/${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    throw new Error(`apify ${path.split("?")[0]}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
};

/* ── Check ────────────────────────────────────────────────────────────────── */

if (checkOnly) {
  const t = token();
  const me = await api(`users/me?token=${t}`);
  console.log(`token ok — ${me.data?.username ?? "account"}, plan ${me.data?.plan ?? "unknown"}`);

  const actor = await api(`acts/${ACTOR}?token=${t}`);
  console.log(`actor ok — ${actor.data?.name ?? ACTOR}`);
  console.log(`\nwould fetch ${Object.keys(SENTINELS).length} profiles, up to ${POSTS_PER_PROFILE} posts each`);
  console.log("nothing was run and nothing was charged");
  process.exit(0);
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */

const t = token();
const handles = only ? [only] : Object.keys(SENTINELS);

for (const h of handles) {
  if (!(h in SENTINELS)) {
    console.error(`"${h}" is not one of the eight reference writers.`);
    process.exit(2);
  }
}

/*
 * The slug form matters and has bitten this before: LinkedIn profile URLs must use www and the
 * hyphenated vanity name. `adam-treboutat` is the one in this set with a hyphen, and it is also the
 * handle that returned nothing on every run for a month — the window was wrong rather than the slug,
 * but it is the one to watch if a run comes back empty.
 */
const profileUrls = handles.map((h) => `https://www.linkedin.com/in/${h}/`);

console.log(`\n  Starting a run for ${handles.length} profile(s)...`);

const started = await api(`acts/${ACTOR}/runs?token=${t}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    profileUrls,
    maxPosts: POSTS_PER_PROFILE,
  }),
});

const runId = started.data?.id;
if (!runId) throw new Error(`no run id came back: ${JSON.stringify(started).slice(0, 300)}`);
console.log(`  run ${runId} — https://console.apify.com/actors/runs/${runId}`);

// Poll. Apify runs of this size take a minute or two; the ceiling stops a hung run from hanging this.
const DEADLINE_MS = 15 * 60_000;
const startedAt = Date.now();
let status = started.data?.status ?? "RUNNING";
let datasetId = started.data?.defaultDatasetId ?? null;

while (["READY", "RUNNING"].includes(status)) {
  if (Date.now() - startedAt > DEADLINE_MS) {
    console.error(`\n  still ${status} after 15 minutes. Check the run in the Apify console.`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 10_000));
  const run = await api(`actor-runs/${runId}?token=${t}`);
  status = run.data?.status;
  datasetId = run.data?.defaultDatasetId ?? datasetId;
  process.stdout.write(`\r  ${status}, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed   `);
}
console.log();

if (status !== "SUCCEEDED") {
  console.error(`  run finished as ${status}. Nothing written.`);
  process.exit(1);
}

const items = await api(`datasets/${datasetId}/items?token=${t}&clean=true&limit=2000`);

/* ── Normalise ────────────────────────────────────────────────────────────── */

/**
 * Map an actor's row onto the four fields the rest of the pipeline reads.
 *
 * Defensive on purpose: LinkedIn actors disagree about field names, and this was written without a
 * token to confirm which this one uses. Anything unmapped is reported rather than written as null,
 * because a silent null here becomes a measurement of nothing two scripts later.
 */
const first = (row, ...names) => {
  for (const n of names) {
    const v = n.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

const handleFrom = (row) => {
  const direct = first(row, "authorHandle", "author_handle", "profileHandle", "username");
  if (direct && direct in SENTINELS) return direct;

  // Fall back to the profile URL the row came from.
  const url = first(row, "authorUrl", "author.url", "profileUrl", "inputUrl") ?? "";
  const slug = String(url).match(/linkedin\.com\/in\/([^/?#]+)/)?.[1];
  return slug && slug in SENTINELS ? slug : null;
};

const unmapped = new Set();
const rows = [];

for (const row of Array.isArray(items) ? items : []) {
  const handle = handleFrom(row);
  if (!handle) {
    unmapped.add("author");
    continue;
  }

  const text = String(first(row, "text", "content", "postText", "description") ?? "").trim();
  if (!text) {
    unmapped.add("text");
    continue;
  }

  const postedAt = first(row, "postedAt", "posted_at", "date", "publishedAt", "postedAtISO");
  if (!postedAt) unmapped.add("posted_at");

  rows.push({
    activity_id: String(
      first(row, "activityId", "activity_id", "postId", "urn", "id") ??
        `${handle}:${postedAt ?? ""}:${text.slice(0, 40)}`,
    ),
    author_handle: handle,
    author_name: first(row, "authorName", "author.name", "fullName") ?? SENTINELS[handle],
    url: first(row, "url", "postUrl", "link"),
    posted_at: postedAt,
    text,
    reaction_count: first(row, "reactionsCount", "likesCount", "numLikes", "reaction_count"),
    comment_count: first(row, "commentsCount", "numComments", "comment_count"),
    is_repost: Boolean(first(row, "isRepost", "is_repost", "reshared")),
  });
}

/* ── Report, and refuse a corpus that cannot be measured ──────────────────── */

const byHandle = new Map();
for (const r of rows) {
  const e = byHandle.get(r.author_handle) ?? { n: 0, breaks: 0 };
  e.n++;
  if (r.text.includes("\n")) e.breaks++;
  byHandle.set(r.author_handle, e);
}

console.log("\n  " + "─".repeat(60));
for (const h of handles) {
  const e = byHandle.get(h);
  console.log(
    `  ${h.padEnd(16)} ${String(e?.n ?? 0).padStart(3)} posts   ` +
      `${String(e?.breaks ?? 0).padStart(3)} with line breaks`,
  );
}
console.log("  " + "─".repeat(60));

if (unmapped.size > 0) {
  console.log(`\n  could not map: ${[...unmapped].join(", ")} on some rows`);
  console.log("  the actor's field names may have changed — check one row in the Apify console");
}

const flat = rows.filter((r) => !r.text.includes("\n")).length;
const flatShare = rows.length > 0 ? flat / rows.length : 0;

/*
 * THE GUARD THAT COST A DAY ON 5 OCTOBER.
 *
 * A scrape came back with every post as one unbroken line. Paragraph counts collapsed to one,
 * the opening test read the whole post instead of the first line, and a writer who bullets nearly
 * every post measured as using no lists. The refresh reported it as seven writers changing their
 * habits. Nothing had changed but the scraper.
 *
 * Catching it here is better than downstream: the posts are still worth storing — they are the
 * writer's words either way — but a corpus this flat cannot answer a question about shape, and
 * whoever runs this should know before the measurements do.
 */
if (flatShare > 0.5 && !acceptFlat) {
  console.error(
    `\n  REFUSING: ${flat} of ${rows.length} posts came back with no line breaks.\n\n` +
      `  Shape measurements — paragraphs, words above the fold, opening and closing style, list use —\n` +
      `  are all counted from line breaks, so this corpus cannot answer any of them. The words are\n` +
      `  intact and the text is still worth storing.\n\n` +
      `  Pass --accept-flat to write it anyway. load-reference-posts.mjs will store the posts and\n` +
      `  leave the shape columns null rather than filling them with an artefact of the scrape.`,
  );
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(rows, null, 1));
console.log(`\n  wrote ${rows.length} posts to ${outPath}\n`);
console.log("  next:");
console.log(`    node scripts/load-reference-posts.mjs --posts ${outPath} --apply   # so Josh can read them`);
console.log(`    node scripts/sentinel-refresh.mjs    --posts ${outPath}            # what moved`);
console.log();
