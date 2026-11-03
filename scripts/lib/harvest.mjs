/**
 * Fetching LinkedIn posts for a set of profiles, and turning either backend's rows into one shape.
 *
 * WHY THIS IS A MODULE AND NOT PART OF THE SCRIPT ANY MORE
 *
 * All of this lived in `scripts/scrape-sentinels.mjs`, which is a Node script. `worker-engage` runs
 * in Deno in the cloud and needs the same three things — fetch a profile, work out who actually
 * wrote each row, normalise it. Copying them would have put TWO copies of `handleOf` in the
 * repository, and `handleOf` is the function that was "one run away from doing the one thing this
 * script exists to prevent": attributing a stranger's post to one of the writers whose page it
 * happened to appear on.
 *
 * So it is extracted once and imported twice. Deno can load a dependency-light `.mjs` — `cc-submit`
 * already statically imports `mcp-server/build-stamp.mjs` — which is why there is nothing from
 * `node:` in here, no `process`, and no `console`. Progress goes to an injected `log`.
 *
 * WHAT CHANGED IN THE EXTRACTION
 *
 * One thing: `handleOf` took the hardcoded eight from its enclosing scope and now takes an `allowed`
 * argument. The sentinel script passes its eight and behaves exactly as before; the comment worker
 * passes Josh's creator list. The guard itself is untouched.
 */

export const CONSOLE_BASE = "https://scraping.thought-pilot.co/api";

/*
 * Cloudflare fronts the console and answers a default Node or urllib User-Agent with 403
 * "error code 1010". Any descriptive UA gets through; an absent one does not.
 */
export const USER_AGENT = "voice-to-content/1.0 (+reference-writer refresh)";

export const APIFY_ACTOR = "harvestapi~linkedin-profile-posts";

export const POLL_EVERY_MS = 10_000;
export const CONSOLE_DEADLINE_MS = 10 * 60_000;
export const APIFY_DEADLINE_MS = 15 * 60_000;

/** Terminal console job states, upper or lower case. */
const TERMINAL = ["succeeded", "completed", "success", "failed", "error", "cancelled", "canceled"];
const WON = ["succeeded", "completed", "success"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

/* ── The console ──────────────────────────────────────────────────────────── */

/** One console call. Throws with the status and the first of the body on anything but 2xx. */
export async function consoleApi(creds, method, path, body, timeoutMs = 60_000) {
  const res = await fetch(`${creds.base || CONSOLE_BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": creds.key,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * Start a profile harvest, wait for it, and page the rows out.
 *
 * `profileUrls` are full LinkedIn profile URLs. Returns `{ rows, source, job }` with rows exactly as
 * the backend sent them — normalising is a separate step so the raw shape can be inspected.
 *
 * NO `since`, EVER. The console accepts it, echoes it back, and returns ZERO ROWS: probed
 * 3 November 2026 against a profile that had posted that morning, `since` gave 0 rows in 7.8s where
 * the same job unfiltered gave 11 in 33.8s. A poller that passed it would report "nobody posted"
 * forever. `scrape-sentinels.mjs` refuses the combination at the command line for this reason and
 * this function does not offer it at all.
 */
export async function fetchFromConsole({ profileUrls, key, base, log = noop }) {
  if (!key) throw new Error("no console key");

  /*
   * ttl_seconds 0 forces a fresh read. The default is 86400, which would serve yesterday's answer to
   * a question asked today — right for a daily harvest, wrong for "what have they posted lately".
   */
  const job = await consoleApi({ key, base }, "POST", "/jobs", {
    actor: "linkedin-harvest",
    input: { urls: profileUrls, entity_type: "profile", ttl_seconds: 0 },
  });
  if (!job?.id) throw new Error(`no job id: ${JSON.stringify(job).slice(0, 200)}`);
  log(`console job ${job.id}, ${profileUrls.length} profile(s)`);

  const startedAt = Date.now();
  let state = job;
  while (!TERMINAL.includes(String(state.status).toLowerCase())) {
    if (Date.now() - startedAt > CONSOLE_DEADLINE_MS) {
      throw new Error(`job ${job.id} still ${state.status} after 10 minutes`);
    }
    await sleep(POLL_EVERY_MS);
    state = await consoleApi({ key, base }, "GET", `/jobs/${job.id}`);
    log(`${state.status}, ${Math.round((Date.now() - startedAt) / 1000)}s`);
  }

  if (!WON.includes(String(state.status).toLowerCase())) {
    throw new Error(`job ${job.id} ${state.status}: ${state.error ?? "no reason given"}`);
  }

  /*
   * Judge the run by the rows it returns, not by its own counters.
   *
   * Measured 9 October and again on 3 November: a job that returned 11 real posts reported
   * `items_scraped: 0` and `coverage: "unknown"`. Those counters belong to the actors that fill
   * them. Reading them here would throw away a perfectly good harvest, or — worse, for a poller —
   * report an empty result on every single run.
   */
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await consoleApi(
      { key, base },
      "GET",
      `/jobs/${job.id}/linkedin-posts?limit=100&offset=${offset}`,
      undefined,
      90_000,
    );
    const batch = Array.isArray(page) ? page : (page.items ?? []);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  if (rows.length === 0) {
    throw new Error(
      `job ${job.id} succeeded but returned no posts. ` +
        `That is distinct from "they have not posted": the scraper returned without reading the ` +
        `page, usually because LinkedIn is blocking the egress IP.`,
    );
  }
  return { rows, source: "console", job: job.id };
}

/* ── Apify, the fallback ──────────────────────────────────────────────────── */

export async function apifyApi(path, init = {}) {
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
}

/**
 * The same fetch through Apify, which keeps the paragraph breaks the console strips.
 *
 * `targetUrls`, not `profileUrls` — the actor has no such key, and Apify ignores an unknown input
 * key rather than refusing it, so a wrong name starts a run with no URLs and comes back empty,
 * which reads exactly like "LinkedIn blocked us".
 *
 * The three flags are set explicitly rather than left to default. A repost is not their writing, and
 * reactions and comments are somebody else's words that cost money to fetch.
 */
export async function fetchFromApify({ profileUrls, token, maxPosts = 50, since = null, log = noop }) {
  if (!token) throw new Error("APIFY_TOKEN not set — see mcp-server/.env.example");

  const started = await apifyApi(`acts/${APIFY_ACTOR}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrls: profileUrls,
      maxPosts,
      ...(since ? { postedLimitDate: since } : {}),
      includeReposts: false,
      scrapeReactions: false,
      scrapeComments: false,
    }),
  });
  const runId = started.data?.id;
  if (!runId) throw new Error(`no run id: ${JSON.stringify(started).slice(0, 200)}`);
  log(`apify run ${runId} — https://console.apify.com/actors/runs/${runId}`);

  const startedAt = Date.now();
  let status = started.data?.status ?? "RUNNING";
  let datasetId = started.data?.defaultDatasetId ?? null;
  while (["READY", "RUNNING"].includes(status)) {
    if (Date.now() - startedAt > APIFY_DEADLINE_MS) {
      throw new Error(`run ${runId} still ${status} after 15 minutes`);
    }
    await sleep(POLL_EVERY_MS);
    const run = await apifyApi(`actor-runs/${runId}?token=${token}`);
    status = run.data?.status;
    datasetId = run.data?.defaultDatasetId ?? datasetId;
    log(`${status}, ${Math.round((Date.now() - startedAt) / 1000)}s`);
  }
  if (status !== "SUCCEEDED") throw new Error(`apify run finished as ${status}`);

  const items = await apifyApi(`datasets/${datasetId}/items?token=${token}&clean=true&limit=2000`);
  return { rows: Array.isArray(items) ? items : [], source: "apify", job: runId };
}

/* ── Normalising ──────────────────────────────────────────────────────────── */

/** The first of these paths that holds something. Dotted names reach into a nested object. */
export const first = (row, ...names) => {
  for (const n of names) {
    const v = n.split(".").reduce((o, k) => (o == null ? o : o[k]), row);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

/**
 * A posted-at value from either backend, as an ISO string or null.
 *
 * The console sends a string. Apify sends `{ timestamp, date, postedAgoShort, postedAgoText }`.
 * Returning null rather than guessing matters: `posted_at` orders every window and every "oldest
 * post" claim, and a wrong date is worse than a missing one because nothing downstream questions it.
 */
export const toIso = (v) => {
  if (v == null) return null;
  if (typeof v === "string") return Number.isNaN(Date.parse(v)) ? null : new Date(v).toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "object") return toIso(v.date ?? v.timestamp ?? v.iso ?? null);
  return null;
};

/**
 * Who wrote this row — or null, if it was not anyone on `allowed`.
 *
 * `allowed` is `{ handle: displayName }`. Anything not in it returns null and the caller drops the
 * row. That is not caution about the argument list, it is what the data contains: measured
 * 9 October, a harvest of one profile returned 14 rows of which 8 were that person's; measured again
 * 3 November, 11 rows of which 8 were. A profile page carries other people's posts, and the row says
 * so in two fields — `author_handle` wrote it, `subject_handle` is whose page it came from.
 *
 * AUTHOR URLS ONLY. `inputUrl` IS NOT ONE.
 *
 * It was in this list, and it is the profile we ASKED for — the subject page, not whoever wrote the
 * post. So any row without an author field was attributed to the page it came from. Nothing had been
 * filed wrongly, because the console flattens `author_handle` onto every row and the fallback never
 * ran. It would have run on the first Apify harvest, where the author is nested — so a path that had
 * never executed was one run away from doing the one thing this exists to prevent.
 */
export const handleOf = (row, allowed) => {
  const has = (h) => Boolean(h) && Object.prototype.hasOwnProperty.call(allowed, h);

  const direct = first(
    row,
    "author_handle",
    "authorHandle",
    "username",
    // Apify's shape. The console flattens the author onto the row; harvestapi nests it, so these
    // were never reached and every row would have fallen through to the URL match below.
    "author.publicIdentifier",
    "author.username",
  );
  if (has(direct)) return direct;

  const url = String(
    first(row, "authorUrl", "author.url", "author.linkedinUrl", "authorProfileUrl", "profileUrl") ?? "",
  );
  const slug = url.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1];
  return has(slug) ? slug : null;
};

/**
 * Every row either backend returned, as one shape, with anyone not on `allowed` dropped.
 *
 * Returns `{ rows, foreign, unmapped }`: `foreign` counts rows written by someone else (expected and
 * healthy — see handleOf), `unmapped` names the fields that were missing. Reporting both is the
 * point: a run that silently dropped everything and a run where nobody posted look identical
 * otherwise.
 */
export function normaliseRows(rawRows, allowed) {
  const unmapped = new Set();
  const rows = [];
  let foreign = 0;

  for (const row of rawRows) {
    const handle = handleOf(row, allowed);
    if (!handle) {
      foreign++;
      continue;
    }

    const text = String(first(row, "text", "content", "postText", "description") ?? "").trim();
    if (!text) {
      unmapped.add("text");
      continue;
    }

    /*
     * Apify returns postedAt as an OBJECT, not a date:
     *   { timestamp: 1791806316736, date: "2026-10-12T11:58:36.736Z", postedAgoShort: "1w", ... }
     *
     * Interpolated into the activity_id fallback it becomes the literal string "[object Object]",
     * which is stable across every post and would collapse a whole profile onto one primary key;
     * written to posted_at it is a timestamptz the database refuses.
     */
    const postedAt = toIso(first(row, "posted_at", "postedAt", "date", "publishedAt", "postedAtISO"));
    if (!postedAt) unmapped.add("posted_at");

    rows.push({
      activity_id: String(
        first(row, "activity_id", "activityId", "postId", "urn", "id") ??
          `${handle}:${postedAt ?? ""}:${text.slice(0, 40)}`,
      ),
      author_handle: handle,
      author_name: first(row, "author_name", "authorName", "author.name", "fullName") ?? allowed[handle],
      url: first(row, "url", "postUrl", "link"),
      posted_at: postedAt,
      text,
      headline: first(row, "headline"),
      /*
       * Apify nests these: `engagement: { likes, comments, shares, reactions: [...] }`. None of the
       * four flat names below it match, and `first()` returns null for a name it cannot find rather
       * than complaining — so the 20 October load wrote null over the reaction and comment counts of
       * all 1,900 rows, and the upsert made that permanent. One row of 1,900 survived.
       *
       * The nested names go FIRST, because they are the ones that backend actually sends. The flat
       * ones stay for the console, which does send them.
       */
      reaction_count: first(
        row,
        "engagement.likes",
        "engagement.reactionCount",
        "reaction_count",
        "reactionsCount",
        "likesCount",
        "numLikes",
      ),
      comment_count: first(
        row,
        "engagement.comments",
        "engagement.commentCount",
        "comment_count",
        "commentsCount",
        "numComments",
      ),
      is_repost: Boolean(first(row, "is_repost", "isRepost", "reshared")),
    });
  }

  return { rows, foreign, unmapped: [...unmapped] };
}
