/**
 * The creator poll's logic, so it can be tested without starting a server.
 *
 * `worker-engage/index.ts` is a Deno.serve shell over this, for the same reason the job handlers
 * live in `_shared/handlers/`: a module with Deno.serve at the top cannot be imported by a test
 * without binding a port, so logic left in a worker is logic nothing can exercise. This repository
 * has shipped a value nothing reads about twenty times, and "it typechecked" was true every time.
 *
 * Josh, 30 October: "I know I should spend more time commenting, but I already feel like I spend
 * enough time on LinkedIn as is... I'd be open to it for sure."
 *
 * He names creators. `cron.schedule('creator-poll', '0 7,15 * * 1-5', ...)` runs this twice on a
 * weekday. It fetches their recent posts, stores the ones it has not seen, drafts comment options
 * for the newest few, and leaves one notice so he hears about it when he next opens a session.
 *
 * WHAT THIS IS NOT
 *
 * It does not post, and nothing downstream of it can. There is no LinkedIn write anywhere in this
 * file and a `comment_options` row cannot become a `posts` row — R3 is untouched. He reads an
 * option and pastes it himself, exactly as he does today when he pastes a post into a session.
 *
 * It does not choose WHO. The `josh-comment` skill attributes that to him in as many words: "a
 * judgement about his market that he has and this does not". So the only input is `creators`, which
 * is written from his own instruction and never by this worker.
 *
 * THE OFF STATE IS AN EMPTY TABLE
 *
 * There is no enabled flag. With no creators this returns having fetched nothing and spent nothing,
 * which is why the schedule could go on unconditionally — 0013's header and worker-select both
 * argue that a cron change is invisible from a session and there is then nothing to remember to put
 * back.
 *
 * WHY THE CAP IS THE MOST IMPORTANT NUMBER HERE
 *
 * `cc-agent/index.mjs` learned it first, about a different input: "A version of this that surfaces
 * ten candidates a day is worse than no version at all, because Josh will stop reading them."
 * Posts above the cap are stored and left undrafted, and the next run takes them oldest first. The
 * queue drains; it does not pile up in front of him.
 *
 * AND NOTHING CHECKS A COMMENT
 *
 * The claim ledger, the nine gate checks and the shingle guard all read drafts, and a comment is
 * none of those. In a session the writer is the check. Here there is no writer, so `review()` runs
 * four deterministic checks and records what they find on the row. They are a FLOOR, not a gate.
 *
 * The fourth was added on 19 November because this comment used to say the checks "cannot catch an
 * invented number", and the first run after the feature was switched on produced one: a drafted
 * comment citing "a 15-20% drop in accuracy on mobile numbers within 60 days", a figure that
 * appears nowhere in any raw input, material field or receipt, labelled by the model as his. It is
 * checked now. What none of these can still catch is the composite that actually identifies a
 * company — a figure plus a niche plus a date. No string search will ever find that.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets, secret } from "../_shared/secrets.ts";
import { json, withBudget } from "../_shared/jobs.ts";
import { notice } from "../_shared/notices.ts";
import { callStructured, MODELS } from "../_shared/llm.ts";
import { loadLibrary } from "../_shared/library.ts";
import { COMMENT_SYSTEM, COMMENT_USER, PROMPT_VERSION } from "../_shared/prompts.ts";
import { CommentOptionsSchema } from "../_shared/schemas.ts";
import { borrowedRuns, hashRun, shinglesOf } from "../_shared/shingles.ts";
// The ledger’s own number extractor, reused rather than re-written: it canonicalises written-out
// numerals, so "fifteen percent" and "15%" are the same figure to both readers.
import { extractNumbers } from "../_shared/claims.ts";
import { SOURCE_FIELDS } from "../_shared/entry.ts";
import { isRealName } from "../_shared/names.ts";

/*
 * The fetch and the author guard come from the script's module rather than being reimplemented.
 * `handleOf` in there is the function that was one run away from filing a stranger's post under a
 * reference writer's name, and two copies of it is the outcome worth avoiding above all others
 * here. Deno loads a dependency-light .mjs the same way cc-submit loads build-stamp.mjs.
 */
import {
  fetchFromApify,
  fetchFromConsole,
  normaliseRows,
} from "../../../scripts/lib/harvest.mjs";

/**
 * How long a detached harvest may take before it reports giving up.
 *
 * MEASURED, AND THE FIRST VALUE WAS WRONG.
 *
 * This was 110s, chosen to sit inside what the runtime holds after the response has gone. It was
 * set while the only timed successful harvest in the record — the corpus refresh of 18 November,
 * corpus_started 15:34:53 to corpus_refreshed 15:37:20 — had taken 147 SECONDS. The number was
 * picked without checking the measurement that was already there.
 *
 * The first scheduled run proved it: 19 November, corpus_started 06:00:09, corpus_failed 06:01:59,
 * killed at 110s by this constant. A path that worked when run by hand failed on every schedule,
 * and the budget built to make failures legible is what made it fail.
 *
 * THEN IT WENT TO 240s, WHICH COULD NEVER FIRE, AND THAT WAS WORSE.
 *
 * Measured from the edge runtime's own logs on 19 November: **every execution of every worker on
 * this project is shut down at 150.0 seconds with `reason: WallClockTime`.** Dozens of them, all
 * within a tenth of a second of each other. `waitUntil` extends the isolate past the response and
 * not past that ceiling.
 *
 * So a 240s budget is unreachable code. The isolate is destroyed 90 seconds before the timer can
 * fire, which takes the timer and the catch block with it — and that is exactly what happened:
 * creator_poll_started at 10:50:33, booted 10:50:32.492, shut down 10:53:02.511 on WallClockTime,
 * with no outcome filed. Raising 110s to 240s traded a premature kill for a SILENT death. The 110s
 * budget at least reported.
 *
 * 140s: the largest value that still leaves the run ten seconds to write its own failure. The
 * ceiling is a fact about the platform, so this cannot be raised to fit a slow harvest — work that
 * needs longer has to get smaller instead, which is what POLL_BATCH below does.
 *
 * And the 147s "success" that justified 240s was three seconds inside the kill. It was luck, not
 * headroom, and it is not a target to protect.
 *
 * `cpu_time_used` on that killed run was 159 MILLISECONDS against 150 seconds of wall clock. The
 * time is spent waiting on the scraping backend, not computing, so the number of profiles is not
 * the variable that decides whether a run fits — nine took 147s and three exceeded 150s.
 */
const HARVEST_BUDGET_MS = 140_000;

/**
 * How many creators one run harvests.
 *
 * Three, because the only two data points are: two profiles completed (18 November, 15:02) and six
 * profiles did not, twice. Three is the larger number that is still under the one measured success
 * plus a margin — not a guess at where the isolate dies, which nothing here can measure, but a size
 * small enough that being wrong about it costs one run rather than the whole list.
 *
 * Raising it is the wrong lever if runs start vanishing again; the right one is lowering it.
 */
export const POLL_BATCH = 3;

/** Sentence-count band from the skill: "Two to five sentences is the band that gets read". */
const MIN_SENTENCES = 2;
const MAX_SENTENCES = 5;

/** A ceiling on one run regardless of settings, so a mis-set row cannot empty the token budget. */
const HARD_POST_CEILING = 10;

interface Creator {
  handle: string;
  display_name: string | null;
  profile_url: string;
}

/** A row as `creator_posts` holds it. */
interface StoredPost {
  activity_id: string;
  handle: string;
  author_name: string | null;
  url: string | null;
  posted_at: string | null;
  text: string;
}

/**
 * A row as `normaliseRows` returns it. `author_handle` is WHO WROTE IT, which is not the profile
 * the row came from — a profile fetch returns that person's feed, and 3 of 11 rows on 3 November
 * were by other people. Keeping the two names apart is what stops the second being read as the
 * first.
 */
interface HarvestedPost {
  activity_id: string;
  author_handle: string;
  author_name: string | null;
  url: string | null;
  posted_at: string | null;
  text: string;
}



/**
 * Answer the caller at once, then do the harvest.
 *
 * WHY, MEASURED
 *
 * `invoke_worker` (migration 0007) calls every worker through `net.http_post` with
 * `timeout_milliseconds => 30000`. A console harvest cannot fit in that: it starts a job on the
 * backend and polls it to completion, measured at 44 seconds for a single profile, against its own
 * ten-minute deadline (`scripts/lib/harvest.mjs`, `scripts/scrape-sentinels.mjs`). So this worker
 * was structurally unable to return inside the budget it is called with.
 *
 * It looked fine for fifteen days and 18 runs, because every one of those runs hit the off state
 * below and returned in milliseconds. The timeout could only appear on the first run that had
 * somebody to fetch. On 18 November Josh asked for the feature to be switched on, two creators
 * were added, the poll was run, and `net._http_response` held exactly one failure among 458 calls
 * that day:
 *
 *   id 157905  status_code NULL  "Timeout of 30000 ms reached. Total time: 30001.265000 ms"
 *
 * and nothing else anywhere. No `creator_posts`, no `comment_options`, no event, `last_polled_at`
 * still null, and no line in the edge logs at all, because the function never sent a response.
 *
 * THE EVENT LOG IS NOW THE ONLY RECORD, SO EVERY PATH MUST LEAVE ONE. Once the caller stops
 * waiting, the HTTP status says only that the run began. `poll` files `creator_poll_idle`,
 * `creator_poll_ran` or `creator_poll_backend_failed`; the catch here files `creator_poll_failed`;
 * and `creator_poll_started` goes in first so that a run torn down mid-flight leaves a start with
 * no finish beside it, rather than no trace at all. A worker that reports success and does nothing
 * is the defect this repository keeps paying for, and detaching the work is exactly how one gets
 * written by accident.
 *
 * `write` is passed through so a test can drive the whole path without a model call.
 */
export async function pollDetached(
  db: SupabaseClient,
  write: OptionWriter = optionsFor,
): Promise<Response> {
  await logEvent(db, "creator_poll_started", "info", {
    means: "The response goes out before the harvest finishes, because the harvest does not fit " +
      "in the 30 second budget invoke_worker allows. A start with no finish beside it is a run " +
      "that was torn down part-way.",
  }).catch(() => {});

  /*
   * The start is filed BEFORE the work begins, not alongside it.
   *
   * It was the other way round until a test caught it: the work promise starts
   * executing the moment it is created, and the first thing it does is load secrets, which
   * files an event of its own on failure. So the first event of a run could be a secrets
   * failure with no start above it — which is precisely the unreadable state this event was
   * added to prevent.
   */
  const work = (async () => {
    try {
      await loadSecrets(db);
      // Under a deadline this runtime can hold. The harvest allows itself ten minutes, which is
      // longer than the isolate survives — see withBudget for the run that proved it.
      await withBudget(poll(db, write), HARVEST_BUDGET_MS, "the creator poll");
    } catch (err) {
      // 13.2: failures surface rather than being swallowed, and this worker has no job row to
      // carry `last_error`. This event is the only place the failure can now appear.
      const message = err instanceof Error ? err.message : String(err);
      await logEvent(db, "creator_poll_failed", "error", { error: message.slice(0, 500) })
        .catch(() => {});
    }
  })();

  try {
    // The same hold used by `nudge` in jobs.ts: it keeps the isolate alive past the response on
    // Supabase's runtime, and is simply absent anywhere else.
    // deno-lint-ignore no-explicit-any
    const edge = (globalThis as any).EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(work);
    else await work;
  } catch {
    // Not on Supabase's runtime, so finish the work here rather than dropping it.
    await work;
  }

  return json({
    ok: true,
    started: true,
    next: "The harvest runs on past this response. What happened is in the event log: " +
      "creator_poll_ran with the counts, creator_poll_idle if nobody is being watched, " +
      "creator_poll_backend_failed if the fetch could not answer, or creator_poll_failed. A " +
      "creator_poll_started with none of those beside it means the run did not reach the end.",
  });
}

/**
 * Which creators this run harvests, and how many are being watched in total.
 *
 * LONGEST-UNPOLLED FIRST, AND ONLY A FEW OF THEM.
 *
 * The read this replaces was every active creator ordered by handle, and the whole list went into
 * one harvest call. That is all-or-nothing: `last_polled_at` is stamped only after the harvest
 * returns, so a run torn down mid-fetch stores nothing, stamps nobody and leaves no trace of having
 * tried.
 *
 * It is not hypothetical. Josh named two creators on 18 November and the 15:02 run completed. Four
 * more were added at 15:24, and every run since — 15:39, then 07:00 the next morning — vanished
 * without filing an outcome. Measured on 19 November: FOUR OF THE SIX HAD NEVER BEEN POLLED ONCE.
 * The feature looked switched on and two thirds of his list had never been read.
 *
 * The budget cannot be raised to fix that. `withBudget` is already 240s and the isolate is torn
 * down before it fires, which is why nothing reported — code inside a process cannot report that
 * the process stopped existing. So the run gets smaller instead, and each one makes durable
 * progress: oldest first, nulls before everything, and the next run continues where this stopped.
 *
 * Separated from `poll` so it can be tested without a network: everything past this point in `poll`
 * reaches a scraping backend, which is why the only `poll` test for a long time was the empty list.
 */
export async function creatorsDueForPoll(
  db: SupabaseClient,
  batch: number = POLL_BATCH,
): Promise<{ list: Creator[]; activeTotal: number }> {
  const { data: creators, error } = await db
    .from("creators")
    .select("handle, display_name, profile_url")
    .eq("active", true)
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(batch);
  if (error) throw new Error(`could not read creators: ${error.message}`);

  const { count } = await db
    .from("creators")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  const list = (creators ?? []) as Creator[];
  return { list, activeTotal: count ?? list.length };
}

export async function poll(db: SupabaseClient, write: OptionWriter = optionsFor): Promise<Response> {
  const { list, activeTotal } = await creatorsDueForPoll(db);

  /*
   * THE OFF STATE. No fetch, no model call, no notice — and an event, because "it ran and there was
   * nobody to poll" and "it did not run" are different facts and only one of them is fine.
   */
  if (list.length === 0) {
    await logEvent(db, "creator_poll_idle", "info", {
      means: "No creators are being watched, so nothing was fetched and nothing was spent. This " +
        "is the off state: the schedule runs regardless and does nothing until Josh names someone.",
    });
    return json({
      ok: true,
      creators: 0,
      means: "Nobody is being watched. Josh adds someone with watch_creator.",
    });
  }

  const harvest = await harvestFor(list, db);

  // Every creator polled gets a timestamp whether or not they posted, or "the poll stopped" and
  // "nobody posted" become the same observation.
  const polledAt = new Date().toISOString();
  for (const c of list) {
    await db.from("creators").update({ last_polled_at: polledAt }).eq("handle", c.handle);
  }

  const allowed = Object.fromEntries(list.map((c) => [c.handle, c.display_name ?? c.handle]));
  const { rows, foreign, unmapped } = normaliseRows(harvest.rows, allowed) as
    { rows: HarvestedPost[]; foreign: number; unmapped: string[] };

  const stored = await store(db, rows);
  const drafted = await draftWaiting(db, write);

  await logEvent(db, "creator_poll_ran", "info", {
    creators: list.length,
    // Both numbers, because "polled 3" alone cannot be read as either "that is everyone" or "there
    // are nine more waiting". A run that covered part of the list has to say so.
    active_total: activeTotal,
    creators_left_for_next_run: Math.max(0, activeTotal - list.length),
    source: harvest.source,
    rows_returned: harvest.rows.length,
    theirs: rows.length,
    dropped_not_on_the_list: foreign,
    unmapped,
    newly_stored: stored.inserted,
    posts_drafted: drafted.posts,
    options_written: drafted.options,
    still_waiting: drafted.remaining,
  });

  if (drafted.options > 0) await announce(db, drafted);

  return json({
    ok: true,
    source: harvest.source,
    creators: list.length,
    newly_stored: stored.inserted,
    drafted: drafted.posts,
    options: drafted.options,
    still_waiting: drafted.remaining,
    means: drafted.options > 0
      ? `${drafted.options} comment option(s) are waiting for Josh.`
      : stored.inserted > 0
      ? "New posts were stored but nothing was worth a comment."
      : "Nobody on his list has posted anything new.",
  });
}

/* ── Fetching ─────────────────────────────────────────────────────────────── */

/**
 * The console first, Apify if it cannot answer.
 *
 * THE FALLBACK IS NOT OPTIONAL. Three profile jobs on 3 November 2026 returned 11 rows, 11 rows,
 * and then ZERO while reporting `status: succeeded` — the console flaps, and `fetchFromConsole`
 * throws on an empty result precisely so that a run like the third one hands over instead of
 * reporting that nobody posted. Without this, a flap is indistinguishable from a quiet day.
 */
async function harvestFor(
  list: Creator[],
  db: SupabaseClient,
): Promise<{ rows: unknown[]; source: string }> {
  const profileUrls = list.map((c) => c.profile_url);
  const consoleKey = secret("XP_API_KEY");
  const apifyToken = secret("APIFY_TOKEN");

  if (!consoleKey && !apifyToken) {
    throw new Error(
      "neither XP_API_KEY nor APIFY_TOKEN is in the vault, so there is no way to fetch a post. " +
        "Set one with select vault.create_secret(...).",
    );
  }

  const attempts: Array<{ name: string; run: () => Promise<{ rows: unknown[]; source: string }> }> = [];
  if (consoleKey) {
    attempts.push({
      name: "console",
      run: () =>
        fetchFromConsole({ profileUrls, key: consoleKey, base: secret("XP_BASE") ?? undefined }),
    });
  }
  if (apifyToken) {
    attempts.push({
      name: "apify",
      // One page of recent posts per profile is all a poll needs. The corpus-building runs that
      // want 250 are a different job on a laptop.
      run: () => fetchFromApify({ profileUrls, token: apifyToken, maxPosts: 20 }),
    });
  }

  let last = "";
  for (const attempt of attempts) {
    try {
      return await attempt.run();
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      await logEvent(db, "creator_poll_backend_failed", "warn", {
        backend: attempt.name,
        error: last.slice(0, 400),
        means: attempts.length > 1
          ? "Trying the other backend. Unconfirmed, not confirmed bad."
          : "There is no other backend configured, so this run found nothing.",
      });
    }
  }
  throw new Error(`every backend failed. Last: ${last}`);
}

/* ── Storing ──────────────────────────────────────────────────────────────── */

/**
 * Upsert on `activity_id`, which is what makes a non-incremental poll safe to run twice a day.
 *
 * `drafted_at` and `seen_at` are never in the payload. Sending `drafted_at` would reset the queue
 * marker on every poll and the same post would be drafted again twice a day forever; sending
 * `seen_at` would make "new to us" unanswerable.
 *
 * And an empty value is deleted from the payload rather than written. `load-reference-posts.mjs`
 * learned this the expensive way: a merge that wrote null over the reaction and comment counts of
 * 1,900 reference rows, made permanent by the upsert, with one row of 1,900 surviving.
 */
export async function store(db: SupabaseClient, rows: HarvestedPost[]): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };

  const ids = rows.map((r) => r.activity_id);
  const { data: existing } = await db
    .from("creator_posts")
    .select("activity_id")
    .in("activity_id", ids);
  const known = new Set((existing ?? []).map((r) => r.activity_id as string));

  const payload = rows.map((r) => {
    const row: Record<string, unknown> = {
      activity_id: r.activity_id,
      handle: r.author_handle,
      text: r.text,
    };
    for (const [k, v] of Object.entries({
      author_name: r.author_name,
      url: r.url,
      posted_at: r.posted_at,
    })) {
      if (v !== null && v !== undefined && v !== "") row[k] = v;
    }
    return row;
  });

  const { error } = await db.from("creator_posts").upsert(payload, { onConflict: "activity_id" });
  if (error) throw new Error(`could not store posts: ${error.message}`);

  // Newest post per creator, for the staleness reading on his list.
  const newest = new Map<string, string>();
  for (const r of rows) {
    if (!r.posted_at) continue;
    const h = r.author_handle;
    if (!newest.has(h) || r.posted_at > (newest.get(h) as string)) newest.set(h, r.posted_at);
  }
  for (const [handle, posted] of newest) {
    await db.from("creators").update({ last_seen_posted_at: posted }).eq("handle", handle);
  }

  return { inserted: ids.filter((id) => !known.has(id)).length };
}

/* ── Drafting ─────────────────────────────────────────────────────────────── */

interface Drafted {
  posts: number;
  options: number;
  remaining: number;
  flagged: number;
  headlines: string[];
}

/**
 * Writes one post's options. The default asks a model; a test passes its own.
 *
 * The seam exists because everything AROUND the model call is what can be wrong and what nothing
 * else would exercise — the cap, the ordering, the stamping, whether a flag blocks. Leaving those
 * untestable because one line in the middle needs a network is how a cap that silently drafts
 * everything ships green.
 */
export type OptionWriter = (
  db: SupabaseClient,
  library: string,
  post: StoredPost,
  wanted: number,
) => Promise<Array<{ body: string; why: string; angle?: string }>>;

export async function draftWaiting(
  db: SupabaseClient,
  write: OptionWriter = optionsFor,
): Promise<Drafted> {
  const configured = Number(await getSetting(db, "comment_posts_per_run", 3));
  const cap = Math.max(0, Math.min(configured, HARD_POST_CEILING));
  const wanted = Math.max(1, Number(await getSetting(db, "comment_options_per_post", 3)));

  const out: Drafted = { posts: 0, options: 0, remaining: 0, flagged: 0, headlines: [] };
  if (cap === 0) return out;

  /*
   * Oldest first. Both worker-metrics and worker-publish call this out: unordered, or newest-first,
   * a backlog means the same head is re-read on every run and the oldest item never goes out at
   * all. `posted_at` nulls sort last here, which is the right end for a post whose date we could
   * not read.
   */
  const { data: waiting, error } = await db
    .from("creator_posts")
    .select("activity_id, handle, author_name, url, posted_at, text")
    .is("drafted_at", null)
    .order("posted_at", { ascending: true, nullsFirst: false })
    .limit(cap);
  if (error) throw new Error(`could not read the queue: ${error.message}`);

  const queue = (waiting ?? []) as StoredPost[];
  if (queue.length === 0) return out;

  const { count } = await db
    .from("creator_posts")
    .select("activity_id", { count: "exact", head: true })
    .is("drafted_at", null);

  // One library read for the whole run, not one per post. 8.6 says a change reaches the very next
  // draft; a change mid-run reaching three of four comments would be worse than either.
  const library = await loadLibrary(db, "commenting");
  const banned = await uncleared(db);
  // One read for the whole run, same as the name screen above it.
  const figures = await hisFigures(db);

  for (const post of queue) {
    try {
      const options = await write(db, library.prompt, post, wanted);
      const kept: Record<string, unknown>[] = [];

      for (const o of options) {
        const flags = review(o.body, post.text, banned, figures);
        if (flags.some((f) => f.flag === "empty")) continue;
        kept.push({
          activity_id: post.activity_id,
          body: o.body,
          why: `${o.why}${o.angle ? ` [${o.angle}]` : ""}`,
          flags,
        });
        if (flags.length > 0) out.flagged++;
      }

      if (kept.length > 0) {
        const { error: insertError } = await db.from("comment_options").insert(kept);
        if (insertError) throw new Error(`could not file options: ${insertError.message}`);
        out.options += kept.length;
        out.headlines.push(
          `${post.author_name ?? post.handle}: ${kept.length} option(s)` +
            (post.url ? `\n  ${post.url}` : ""),
        );
      }

      /*
       * Stamped whether or not anything was written. "Nothing worth saying about this one" is a
       * correct outcome the skill names explicitly, and a post left unstamped would be re-drafted
       * on every run for the same money and the same answer.
       */
      await db
        .from("creator_posts")
        .update({ drafted_at: new Date().toISOString() })
        .eq("activity_id", post.activity_id);
      out.posts++;
    } catch (err) {
      /*
       * One bad post does not take the run down, and it is NOT stamped — so it is retried next
       * time rather than silently skipped forever.
       */
      await logEvent(db, "comment_draft_failed", "warn", {
        activity_id: post.activity_id,
        handle: post.handle,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 400),
      });
    }
  }

  out.remaining = Math.max(0, (count ?? queue.length) - out.posts);
  return out;
}

export async function optionsFor(
  db: SupabaseClient,
  library: string,
  post: StoredPost,
  wanted: number,
): Promise<Array<{ body: string; why: string; angle?: string }>> {
  const reply = await callStructured(
    CommentOptionsSchema,
    {
      // MID, not STRONG. A comment is two to five sentences against a post that is already in the
      // prompt; the gate and the drafter are where the strong model earns its cost.
      model: MODELS.SONNET,
      system: COMMENT_SYSTEM(library),
      messages: [{
        role: "user",
        content: COMMENT_USER({
          authorName: post.author_name ?? post.handle,
          authorHandle: post.handle,
          postText: post.text,
          postedAt: post.posted_at,
          wanted,
        }),
      }],
      maxTokens: 1200,
      effort: "medium",
      purpose: "comment_options",
      promptVersion: PROMPT_VERSION,
    },
    { db },
  );

  if (!reply.options?.length) {
    await logEvent(db, "comment_nothing_to_add", "info", {
      activity_id: post.activity_id,
      handle: post.handle,
      reason: (reply.nothing_to_add ?? "").slice(0, 300),
      means: "Not a failure. The skill says to say so rather than write something: a comment he " +
        "has to think about before deciding not to leave it has cost him more than it saved.",
    });
    return [];
  }
  return reply.options.slice(0, wanted);
}

/* ── The three checks ─────────────────────────────────────────────────────── */

export interface Flag {
  flag: string;
  detail: string;
}

/**
 * Every name the system holds that Josh has NOT cleared, as lower-case words to look for.
 *
 * `moment_names` is per-moment and a comment has no moment, so clearance cannot be read the way
 * `handlers/draft.ts` reads it. What carries over is the useful half: a name on file and uncleared
 * is a name nobody has given permission to use, and a comment is the most exposed place it could
 * appear. `isRealName` is reused so the three role words that got recorded as names — "CFO" twice
 * and "Josh" once — do not flag every comment he could ever leave.
 */
export async function uncleared(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("moment_names").select("name, cleared").eq("cleared", false);
  if (error) {
    // Reported, not thrown. A comment with no name screen is worse than no comment only if nobody
    // is told, and this is advisory anyway.
    await logEvent(db, "comment_name_screen_unavailable", "warn", {
      error: error.message.slice(0, 300),
      means: "THE NAME SCREEN DID NOT RUN. Options from this run carry no named_someone flag, " +
        "which is not the same as carrying a clean one.",
    });
    return [];
  }
  const names = new Map<string, string>();
  for (const r of data ?? []) {
    const name = String(r.name ?? "").trim();
    // Deduplicated case-insensitively, but the spelling that is KEPT is his. The same name can be
    // on file against several moments.
    if (name && isRealName(name) && !names.has(name.toLowerCase())) {
      names.set(name.toLowerCase(), name);
    }
  }
  return [...names.values()];
}

/** Sentences, counted the blunt way. Good enough to catch a comment the length of a post. */
export function sentenceCount(text: string): number {
  return (text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 1).length;
}

/**
 * What the deterministic checks found. ADVISORY: a flag is a prompt for him, not a verdict, and an
 * empty list must never be read as "safe to post".
 *
 * Three checks, and the reason there are only three. The first two are exact and a model cannot be
 * trusted to do them; the third is a number the skill states. Banned phrases are deliberately NOT
 * here — that section is in the `commenting` library view, so the writer has been told them, and
 * clause 8.7 forbids copying a rule out of the library into code where Josh cannot see or change
 * it. The thing none of these can catch is the composite that actually identifies a company: a
 * figure plus a niche plus a date. No string search will ever find that.
 */
export function review(
  body: string,
  postText: string,
  bannedNames: string[],
  hisFigures: Set<string> | null = null,
): Flag[] {
  const flags: Flag[] = [];
  const text = (body ?? "").trim();

  if (!text) return [{ flag: "empty", detail: "The model returned a comment with no text." }];

  /* 1 — a name nobody cleared. */
  // Matched case-insensitively against the body as written. Not against a lowercased copy: a
  // second representation of the same string is one more thing that can disagree with itself.
  const named = bannedNames.filter((n) => new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(text));
  if (named.length > 0) {
    flags.push({
      flag: "named_someone",
      detail: `Names nobody has cleared: ${named.join(", ")}. A comment sits under someone else's ` +
        `post, often in the same niche being discussed.`,
    });
  }

  /* 2 — the poster's own words, handed back to them. */
  const index = new Set(shinglesOf(postText).map(hashRun));
  const mirrored = borrowedRuns(text, index);
  if (mirrored.length > 0) {
    const longest = mirrored.reduce((a, b) => (b.length > a.length ? b : a));
    flags.push({
      flag: "mirrors_the_post",
      detail: `Reuses the post's own wording: "${longest.slice(0, 120)}". Take the shape, never ` +
        `the words — it applies to the person he is replying to as well.`,
    });
  }

  /* 3 — the length band. */
  const sentences = sentenceCount(text);
  if (sentences > MAX_SENTENCES) {
    flags.push({
      flag: "too_long",
      detail: `${sentences} sentences against a band of ${MIN_SENTENCES}-${MAX_SENTENCES}. A ` +
        `comment the length of a post reads as an attempt to hijack the thread.`,
    });
  } else if (sentences < MIN_SENTENCES) {
    flags.push({
      flag: "too_short",
      detail: `${sentences} sentence against a band of ${MIN_SENTENCES}-${MAX_SENTENCES}.`,
    });
  }

  /*
   * 4 — A FIGURE THAT IS NOT HIS. Added 19 November, after the first real run produced one.
   *
   * The header above used to say these checks "cannot catch an invented number". It was right, and
   * within minutes of the feature being switched on that is exactly what arrived. The 07:00 poll
   * drafted a comment reading "you're looking at a 15-20% drop in accuracy on mobile numbers within
   * 60 days", and labelled its own reasoning "[his_number]". Searched across every raw input, every
   * material field and the receipts section: zero hits. The figure exists nowhere Josh has ever
   * spoken or supplied, and `flags` came back empty, so nothing stood between it and a comment
   * published in his name under somebody else's post.
   *
   * A draft cannot do this — the claim ledger refuses an unsourced number outright. A comment had
   * no equivalent, and "in a session the writer is the check" assumes the writer knows which
   * figures are his, which nothing told them.
   *
   * SO THIS IS THE SAME TEST THE LEDGER APPLIES, in the one place it was missing. A number is his
   * if it appears anywhere in his own material. It is also allowed if it appears in the post being
   * replied to, because quoting their figure back is legitimate and common.
   *
   * HOW WEAK THIS IS, MEASURED, because it would be easy to read it as more than it is.
   *
   * Josh's material holds 241 distinct figures. Run against the real comment above, the check
   * flags "60" and NOTHING ELSE: "15" and "20" both appear somewhere in his notes in unrelated
   * contexts, so "a 15-20% drop" passes on its digits. It caught that comment by one number out of
   * three, and a differently worded invention using only common figures would pass entirely.
   *
   * A whole-corpus match cannot tell "15 appears in his material" from "15% of mobile numbers
   * decay in 60 days". Only a per-comment claim ledger could, and comments do not have one. So this
   * is a floor that happens to catch the case that occurred, not a guarantee against the next one.
   *
   * ADVISORY, like the other three, and for one reason beyond the above: a year, a round number in
   * a turn of phrase, and a figure he gave in a session that was never filed would all trip it. It
   * is a prompt to check, and the detail says which figure. If the read of his material failed,
   * that is reported rather than passed over — a check that did not run is not one that found
   * nothing.
   */
  if (hisFigures === null) {
    flags.push({
      flag: "figures_not_checked",
      detail: "His own material could not be read, so no figure in this comment was checked " +
        "against it. NOT a pass — nothing looked. Read any number here out to him before it goes " +
        "anywhere.",
    });
  } else {
    const theirs = new Set(extractNumbers(postText ?? ""));
    const unsourced = extractNumbers(text).filter((n) => !hisFigures.has(n) && !theirs.has(n));
    if (unsourced.length > 0) {
      flags.push({
        flag: "figure_not_his",
        detail: `Cites ${unsourced.join(", ")}, which appears nowhere in his own material and ` +
          `nowhere in the post being replied to. A comment goes out in his name: an invented ` +
          `statistic is the one thing this system exists to prevent, and a comment is the only ` +
          `route out that has no claim ledger. Check it with him or cut the number.`,
      });
    }
  }

  return flags;
}

/**
 * Every figure Josh has ever supplied, for the check above.
 *
 * Read once per run, like the name screen beside it. Across ALL of his material rather than one
 * moment's, because a comment is not written from a moment — he is replying to somebody, and any
 * number he has ever given is fair for him to use again.
 *
 * Returns null when the read fails, which `review` reports as a check that did not run. Swallowing
 * it and returning an empty set would flag every figure in every comment, and a check that cries
 * wolf on everything is one nobody reads.
 */
export async function hisFigures(db: SupabaseClient): Promise<Set<string> | null> {
  try {
    const out = new Set<string>();

    /*
     * PAGED AND ORDERED, because the first version was neither.
     *
     * It read `.limit(2000)` with no order, and `row-ceiling.test.ts` failed it immediately: a
     * limited read with no order on a table that grows returns an arbitrary slice, so which of his
     * figures the screen knew about would depend on row order. Worse, the 2000 was a fiction —
     * PostgREST truncates any response at 1,000 rows however many are asked for, silently.
     *
     * This has to see ALL of it or the check quietly weakens as the bank grows: a figure it misses
     * is a figure flagged as not his. So it pages until a short page ends it, ordered by id so the
     * pages cannot overlap or skip.
     */
    const PAGE = 500;
    /*
     * `key` is a parameter because the two tables do not share one. `material` has NO `id` column
     * at all — it is keyed on `moment_id`, one row per moment — and the first version of this
     * ordered both by `id`, so the whole screen returned null against the live schema and every
     * comment would have carried figures_not_checked for ever.
     *
     * The fake client did not catch it: its `order()` on a column that does not exist sorts on
     * undefined and its select list is ignored. Only running it against the real database did.
     */
    const pageThrough = async (
      table: string,
      key: string,
      select: string,
      take: (row: Record<string, unknown>) => string,
    ) => {
      for (let from = 0;; from += PAGE) {
        const { data, error } = await db
          .from(table)
          .select(select)
          .order(key, { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        // Through `unknown`: the select list is built at runtime, so the client cannot type it.
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        for (const row of rows) {
          for (const n of extractNumbers(take(row))) out.add(n);
        }
        if (rows.length < PAGE) return;
      }
    };

    await pageThrough(
      "raw_inputs",
      "id",
      "id, transcript, text_body",
      (r) => `${r.transcript ?? ""} ${r.text_body ?? ""}`,
    );
    await pageThrough(
      "material",
      "moment_id",
      `moment_id, ${SOURCE_FIELDS.join(", ")}`,
      (r) => Object.values(r).join(" "),
    );

    const receipts = await db.from("library_sections").select("body").eq("key", "receipts")
      .maybeSingle();
    if (receipts.data?.body) {
      for (const n of extractNumbers(String(receipts.data.body))) out.add(n);
    }

    return out;
  } catch (err) {
    await logEvent(db, "comment_figure_screen_unavailable", "warn", {
      error: err instanceof Error ? err.message : String(err),
      means: "Comments from this run carry a figures_not_checked flag rather than a silent pass.",
    }).catch(() => {});
    return null;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ── Telling him ──────────────────────────────────────────────────────────── */

/**
 * ONE notice per run, built from an accumulated list — the shape worker-ops uses.
 *
 * Never one per post. `system_status` reads fifteen unread notices, so four posts a day for four
 * days would push everything else out of his view, and the thing it would push out first is the
 * approval that actually blocks the pipeline.
 */
async function announce(db: SupabaseClient, d: Drafted): Promise<void> {
  const lines = [
    `${d.options} comment option(s) are waiting, across ${d.posts} post(s) from your list.`,
    "",
    ...d.headlines,
  ];
  if (d.flagged > 0) {
    lines.push(
      "",
      `${d.flagged} of them carry a flag — a name nobody cleared, the poster's own wording, or ` +
        `a length outside the band. Nothing is blocked; read the flag and decide.`,
    );
  }
  if (d.remaining > 0) {
    lines.push("", `${d.remaining} more post(s) are stored and undrafted. The next run takes them.`);
  }
  lines.push(
    "",
    "These are UNCHECKED: no gate, no claim ledger, no shingle guard reads a comment. Read any " +
      "number in one before you use it.",
  );

  await notice(db as SupabaseClient, "comments_ready", lines.join("\n"), {
    severity: d.flagged > 0 ? "warn" : "info",
    actedOn: ["list_comment_options", "record_comment_used"],
  });
}
