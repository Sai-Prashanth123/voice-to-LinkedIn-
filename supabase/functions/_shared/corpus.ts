/**
 * Collecting the nine reference writers on a schedule, which nothing has ever done.
 *
 * WHAT HE ASKED FOR
 *
 * Josh, 18 November 2026: "I can't see which reference-writer posts are doing well. Seven of the
 * nine writers have had no reaction counts since the 20 October load, nothing collects new posts on
 * a schedule, and get_reference_posts stops at 50 with no paging. Can you: collect all nine on a
 * schedule, keeping line breaks and counts."
 *
 * Measured, and he is exactly right. 2,148 stored posts across nine handles. Reaction counts exist
 * on mattjbarker1 (250), tim-scheuer (248) and ONE row of curtishowland. The other six writers have
 * none at all. The newest post for seven of them is 19 October. Line breaks, though, are already
 * kept on 2,082 of the 2,148 — that half of the ask was already done.
 *
 * WHY IT WAS NEVER AUTOMATED, AND WHAT CHANGED
 *
 * worker-ops recorded the reason in its own words: "The scrape itself is still a script someone
 * runs, deliberately: it needs a key that does not live in this vault, and automating the
 * collection of a corpus that currently comes back without line breaks would be automating
 * something half useless." The first half of that is now addressable — a key can be put in the
 * vault — and the second half is why the backend choice below is not a detail.
 *
 * WHAT CHANGED ON 23 NOVEMBER, BECAUSE IT REVERSES THE PREMISE BELOW
 *
 * The console was fixed. Measured by submitting eight live jobs rather than by being told: 111 of
 * the 114 posts returned carried their line breaks, all 114 carried a reaction count, and a job
 * that fetches nothing now reports `failed` with a reason instead of `succeeded` with no rows —
 * which was the dangerous one, because a success with nothing in it is indistinguishable from a
 * quiet week.
 *
 * The limit MOVED rather than disappearing, and the remaining half is the half Josh asked about.
 * The console reads the profile page, which shows a logged-out reader a handful of recent entries —
 * every job today returned 7 to 8 posts per profile. So it collects new posts beautifully and
 * cannot reach an old one: a post-URL harvest of six stored posts (entity_type "post") and the
 * `linkedin-backfill` actor over March–May 2026 each returned zero rows and reported success. The
 * 1,649 stored posts with no reaction count therefore stay uncounted until APIFY_TOKEN exists, and
 * everything collected from here on arrives counted.
 *
 * THE TWO BACKENDS ARE STILL NOT INTERCHANGEABLE, AND THIS IS THE WHOLE RISK
 *
 * On 9 October all 14 rows of a Matt Barker harvest came back from the console as one unbroken
 * paragraph each, three of today's 114 rows still arrived flat, and a third party can regress
 * without telling us. Apify (APIFY_TOKEN) preserves them by design. So every guard below stays
 * exactly as it was: what changed is what this reports, not what it is allowed to overwrite.
 *
 * That is not a quality preference, it is a correctness boundary. Six columns here are counted FROM
 * line breaks, and `merge-duplicates` means a key present with a null value overwrites. So one
 * console run over an Apify-collected corpus would null the shape of all 2,082 shaped rows, and
 * 0046 revokes DELETE from every role, so there would be no way back. The guards below are ported
 * from `scripts/load-reference-posts.mjs` for that reason and their comments are kept, because
 * both of them were written after something was actually lost.
 *
 * So: Apify refreshes the corpus. The console may only ADD posts not already held, and it says so
 * in an event rather than appearing to have done the job.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Decide anything. Engagement figures collected here are read by a human through a tool, and
 * migration 0004 is explicit about why that line exists: "A system optimising freely against
 * LinkedIn engagement finds its way to engagement bait, because that is what the metric rewards."
 * Nothing in the gate sees a reaction count and nothing here writes a rule.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { logEvent } from "../_shared/db.ts";
import { loadSecrets, secret } from "../_shared/secrets.ts";
import { json, withBudget } from "../_shared/jobs.ts";
import {
  collectConsoleHarvest,
  fetchFromApify,
  normaliseRows,
  submitConsoleHarvest,
} from "../../../scripts/lib/harvest.mjs";
import { measurePost } from "../../../scripts/lib/prose.mjs";

/**
 * The nine, and the profile each one is fetched from.
 *
 * Spelled here rather than imported from `mcp-server/writers.mjs` because that module is the
 * connector's and this runs in the cloud — but it is the same nine, and `corpus.test.ts` asserts
 * the two lists agree so they cannot drift. Tim Scheuer was added on 5 November at his request.
 */
export const CORPUS_WRITERS: Record<string, string> = {
  "mattjbarker1": "Matt Barker",
  "demandjen1": "Jen Allen-Knuth",
  "outboundphd": "Eric Nowoslawski",
  "juliacarter98": "Julia Carter",
  "ryanscarlin": "Ryan Carlin",
  "curtishowland": "Curtis Howland",
  "amangrowth": "Aman Ghataura",
  "adam-treboutat": "Adam Treboutat",
  "tim-scheuer-91b005237": "Tim Scheuer",
};

export const CORPUS_HANDLES = Object.keys(CORPUS_WRITERS);

/**
 * Same budget as the creator poll, and the same reason. The full note is in engage.ts.
 *
 * In short: the edge runtime kills every execution at 150.0s with `reason: WallClockTime`, measured
 * from its own logs on 19 November, so a budget above that can never fire and the run dies in
 * silence. 140s is the largest value that leaves ten seconds to report the failure.
 *
 * THE CONSEQUENCE THIS WORKER CARRIED UNTIL 23 NOVEMBER, AND NO LONGER DOES
 *
 * The one successful refresh here took 147s — nine profiles, 67 posts, 18 November — three seconds
 * inside the platform's kill. Under a 140s budget that run is stopped and REPORTED instead of
 * finishing, which is the right trade against dying silently and was never a fix. It then failed on
 * every scheduled run: 19 November and 23 November, both at this budget.
 *
 * Measured on 23 November, submitting the real jobs rather than reasoning about them:
 *
 *   nine profiles in one job   273.1s   76 posts     — cannot fit, and never could
 *   three profiles in one job  120.2s   17 posts     — fits, with 20s to spare
 *   one profile in one job     111.7s, 128.5s        — the cost is overhead, not per-profile
 *
 * So the ceiling is not about how many profiles are asked for; a single profile already spends most
 * of the budget. That is what `CORPUS_BATCH` answers.
 */
const HARVEST_BUDGET_MS = 140_000;

/**
 * How long a run may wait for a job it has just submitted, before leaving it for the next run.
 *
 * 90s, not 140. The difference is the point: this budget running out is the EXPECTED outcome rather
 * than a failure, so it is set low enough to leave room for the collect-and-store that follows a
 * job which does land. Waiting the full budget would turn every slow job into an isolate killed
 * mid-store, which is the fault this whole two-phase arrangement removes.
 */
const OPPORTUNISTIC_BUDGET_MS = 90_000;

/**
 * How many writers one run fetches, and why it is three.
 *
 * The same shape as `POLL_BATCH` in engage.ts and for the same reason, with one difference worth
 * knowing: there, batching made progress durable. Here it is the only thing that makes the run
 * possible at all — nine profiles measured 273s against a platform that kills every execution at
 * 150s, so the scheduled refresh could not have completed however reliable the backend became.
 *
 * Three measured 120s. Two runs a week covers all nine in a week and a half, and `run_worker` with
 * `corpus` walks through them faster when somebody is waiting.
 *
 * NOT raised to four without measuring it. 120s of a 140s budget is already thin, and the overhead
 * reading above means a fourth profile is not a third of the cost of three.
 */
export const CORPUS_BATCH = 3;

const PROFILE_URL = (handle: string) => `https://www.linkedin.com/in/${handle}/`;

/**
 * Columns a backend may legitimately not fill, which are therefore DROPPED rather than written.
 *
 * Ported with its reason. On 20 October the Apify mapping looked for `reactionsCount` where the
 * payload says `engagement.likes`, so every row arrived with null engagement, the upsert merged it
 * in, and the reaction and comment counts of all 1,900 posts were erased. The run reported success;
 * the only sign was a column of nulls nobody queried until hours later.
 *
 * A backend that genuinely cannot see a field must not be able to delete it.
 */
const NULLABLE_ON_MERGE = [
  "author_name",
  "url",
  "posted_at",
  "reaction_count",
  "comment_count",
  "words",
  "sentence_words_sd",
] as const;

type Row = Record<string, unknown>;

/**
 * Shape one already-normalised post into a `reference_writer_posts` row, or null if it is not one.
 *
 * The handle is NOT re-derived here. `normaliseRows` does it with `handleOf`, which is the function
 * that was one run away from filing a stranger's post under a reference writer's name — a second
 * copy of that logic is the outcome most worth avoiding in this file, so anything arriving here has
 * already been attributed and anything foreign has already been counted.
 */
function rowFor(p: Record<string, unknown>): Row | null {
  const handle = String(p.author_handle ?? "");
  const text = String(p.text ?? "").trim();
  if (!handle || !text) return null;
  if (p.is_repost) return null;

  const id = String(
    p.activity_id ?? `${handle}:${p.posted_at ?? ""}:${text.slice(0, 40)}`,
  );

  const hasBreaks = text.includes("\n");
  const m = measurePost(text);

  return {
    activity_id: id,
    handle,
    author_name: p.author_name ?? null,
    url: p.url ?? null,
    posted_at: p.posted_at ?? null,
    text,
    words: m.words,
    // Null rather than a number nobody can source: each of these is counted from line breaks, and a
    // post that arrived as one line has none to count.
    paragraphs: hasBreaks ? m.paragraphs : null,
    above_fold_words: hasBreaks ? m.above_fold_words : null,
    opening_words: hasBreaks ? m.opening_words : null,
    opening_shape: hasBreaks ? m.opening_shape : null,
    close_shape: hasBreaks ? m.close_shape : null,
    uses_list: hasBreaks ? m.uses_list : null,
    sentence_words_sd: m.sentence_words_sd,
    has_line_breaks: hasBreaks,
    reaction_count: p.reaction_count ?? null,
    comment_count: p.comment_count ?? null,
    // Written on every touch, which the CLI loader does NOT do: it omits scraped_at from the
    // payload, so `merge-duplicates` leaves the original and the staleness alarm in worker-ops has
    // been measuring time-since-first-insert rather than time-since-last-refresh.
    scraped_at: new Date().toISOString(),
  };
}

/**
 * Drop any row that would replace a shaped post with a flat one.
 *
 * Ported with its reason. The upsert merges on activity_id and 0046 revokes DELETE from every role,
 * so a flat copy of a post already held with its line breaks would null six columns with no way
 * back. Dropping the row is right rather than merging columns: the text is identical either way,
 * and the only thing the flat copy could add is a fresher reaction count, which is not worth the
 * risk of getting the merge wrong.
 *
 * A failed read REFUSES rather than proceeding. Upserting blind is the one thing that cannot be
 * undone here.
 */
async function withoutRegressions(
  db: SupabaseClient,
  rows: Row[],
): Promise<{ keep: Row[]; dropped: number }> {
  const flatIds = rows.filter((r) => r.has_line_breaks === false).map((r) => String(r.activity_id));
  if (flatIds.length === 0) return { keep: rows, dropped: 0 };

  const shaped = new Set<string>();
  for (let i = 0; i < flatIds.length; i += 200) {
    const { data, error } = await db
      .from("reference_writer_posts")
      .select("activity_id")
      .eq("has_line_breaks", true)
      .in("activity_id", flatIds.slice(i, i + 200));
    if (error) {
      throw new Error(
        `could not read what is already stored (${error.message}) — refusing to upsert blind, ` +
          `because a flat row written over a shaped one cannot be undone`,
      );
    }
    for (const r of data ?? []) shaped.add(String(r.activity_id));
  }

  const keep = rows.filter((r) => !(r.has_line_breaks === false && shaped.has(String(r.activity_id))));
  return { keep, dropped: rows.length - keep.length };
}

/** Strip the keys a backend could not fill, so a merge cannot erase a stored value. */
function withoutEmptyFields(rows: Row[]): { rows: Row[]; held: number } {
  let held = 0;
  for (const r of rows) {
    for (const col of NULLABLE_ON_MERGE) {
      if (r[col] === null || r[col] === undefined) {
        delete r[col];
        held++;
      }
    }
  }
  return { rows, held };
}

/**
 * Which three writers this run fetches: the three whose turn it has been longest.
 *
 * ROTATION BY ATTEMPT, NOT BY WHAT IS STORED.
 *
 * The obvious signal is `max(scraped_at)` per handle, and it is the wrong one. A writer whose fetch
 * returns nothing stores nothing, so `scraped_at` does not move, so that writer is the stalest
 * again next run and the other eight never get a turn. `ryanscarlin` is exactly that case already —
 * last stored 20 October, newest post 10 September — so this is not a hypothetical.
 *
 * `corpus_started` is filed on every run before any work begins, which makes it the one record of
 * an ATTEMPT rather than of a success. Reading the recent ones rotates: a writer that failed is
 * retried once the others have had their turn, and a run that dies part-way does not pin the
 * schedule to the same three forever.
 *
 * ORDERED AND LIMITED rather than windowed by `created_at`, for the reason orphan-runs.ts records
 * at length: the row this system writes takes `created_at` from the column default, so the value is
 * not in the payload a fake database sees.
 */
export async function corpusDueForRefresh(
  db: SupabaseClient,
  batch = CORPUS_BATCH,
): Promise<{ handles: string[]; basis: string }> {
  const { data, error } = await db
    .from("system_events")
    .select("detail")
    .eq("kind", "corpus_started")
    .order("id", { ascending: false })
    .limit(20);

  if (error) {
    /*
     * Reported in the event, not swallowed into a silent default.
     *
     * The fallback still has to pick somebody, and it picks the first three — but a run that
     * chose them because it could not read its own history is a different fact from a run that
     * chose them because it was their turn, and only one of those is worth acting on.
     */
    return {
      handles: CORPUS_HANDLES.slice(0, batch),
      basis: `could not read which writers ran recently (${error.message}), so this is the first ` +
        `${batch} rather than the longest waiting`,
    };
  }

  // Position in the list is recency: 0 is the most recent run. A handle absent from all of them
  // has never been attempted, and goes first.
  const lastAttempt = new Map<string, number>();
  (data ?? []).forEach((row, index) => {
    const writers = (row as { detail?: { writers?: unknown } }).detail?.writers;
    if (!Array.isArray(writers)) return;
    for (const w of writers) {
      const handle = String(w);
      if (!lastAttempt.has(handle)) lastAttempt.set(handle, index);
    }
  });

  const never = CORPUS_HANDLES.filter((h) => !lastAttempt.has(h));
  const seen = CORPUS_HANDLES.filter((h) => lastAttempt.has(h))
    .sort((a, b) => lastAttempt.get(b)! - lastAttempt.get(a)!);

  const handles = [...never, ...seen].slice(0, batch);
  return {
    handles,
    basis: never.length > 0
      ? `${never.length} of the ${CORPUS_HANDLES.length} have no run on record, and they go first`
      : "the longest since their last run, from the last 20 runs",
  };
}

/** Which backend can run, and what it costs. Apify first, because the console cannot keep shape. */
export function backendFor(): {
  name: "apify" | "console" | null;
  keepsLineBreaks: boolean;
  note: string;
} {
  if (secret("APIFY_TOKEN")) {
    return {
      name: "apify",
      keepsLineBreaks: true,
      note: "Apify keeps line breaks, so shape columns and reaction counts are both refreshed.",
    };
  }
  if (secret("XP_API_KEY")) {
    return {
      name: "console",
      /*
       * TRUE since 23 November, and this is a reversal of the reading this whole file was built
       * around. Measured by submitting eight jobs: 111 of the 114 posts returned carried their line
       * breaks and all 114 carried a reaction count, where on 9 October all 14 rows of a Barker
       * harvest came back as one unbroken paragraph each.
       *
       * NOTHING MAY USE THIS TO SKIP `withoutRegressions`. The guard is not an optimisation for a
       * backend that loses shape, it is the thing that makes an irreversible write safe — three of
       * the 114 rows still arrived flat, 0046 revokes DELETE from every role, and a third party can
       * regress without telling us. This field is a report, not a permission.
       */
      keepsLineBreaks: true,
      note: "Measured again on 23 November and this changed: the console now returns line breaks " +
        "(111 of 114 rows) and a reaction count on every row, so a new post arrives with both its " +
        "shape and its counts. It still strips them often enough that the shape guard stays. What " +
        "it CANNOT do is reach a post older than the handful LinkedIn shows a logged-out reader: a " +
        "post-URL harvest of six stored posts and the backfill actor over March–May 2026 each " +
        "returned zero rows and reported success. So posts already stored without a count stay " +
        "uncounted until APIFY_TOKEN is in the vault; everything collected from here on is counted.",
    };
  }
  return {
    name: null,
    keepsLineBreaks: false,
    note: "Neither APIFY_TOKEN nor XP_API_KEY is in the vault, so there is no way to fetch a post.",
  };
}

/**
 * The harvest, stored. Returns what it did, for the event log.
 *
 * `handles` is the batch — see `corpusDueForRefresh`. It defaults to all nine because a caller who
 * wants the whole corpus in one go (a script, where nothing is killed at 150 seconds) should not
 * have to know about batching, and because that is what every existing caller meant.
 *
 * Attribution is NOT narrowed to the batch. `normaliseRows` still gets all nine writers, because a
 * profile harvest returns other people's posts from the feed and one of those people is sometimes
 * another reference writer. Narrowing it would throw away a post this corpus wants, and would file
 * it under `foreign` while it sat there correctly attributed.
 */
export async function refreshCorpus(
  db: SupabaseClient,
  maxPosts = 50,
  handles: string[] = CORPUS_HANDLES,
) {
  const backend = backendFor();
  if (!backend.name) {
    await logEvent(db, "corpus_blocked", "warn", { means: backend.note });
    return { ok: false as const, backend: null, note: backend.note };
  }

  const profileUrls = handles.map(PROFILE_URL);
  let raw: { rows?: unknown[] };
  if (backend.name === "apify") {
    raw = await fetchFromApify({ profileUrls, token: secret("APIFY_TOKEN"), maxPosts });
  } else {
    /*
     * Submit, then poll — rather than the old all-in-one `fetchFromConsole`.
     *
     * This path is for a caller nothing kills: a script at a terminal, or `refreshCorpus` called
     * directly. The scheduled worker does NOT come through here, because the polling is exactly
     * what it cannot afford; see `collectThenSubmit`.
     */
    const creds = { key: secret("XP_API_KEY"), base: secret("XP_BASE") ?? undefined };
    const { jobId } = await submitConsoleHarvest({ profileUrls, ...creds });
    let got = await collectConsoleHarvest({ jobId, ...creds });
    const startedAt = Date.now();
    while (!got.done) {
      if (Date.now() - startedAt > 10 * 60_000) {
        throw new Error(`console job ${jobId} still ${got.status} after 10 minutes`);
      }
      await new Promise((r) => setTimeout(r, 10_000));
      got = await collectConsoleHarvest({ jobId, ...creds });
    }
    if (!got.won) throw new Error(`job ${jobId} ${got.status}: ${got.error}`);
    raw = { rows: got.rows };
  }

  return await storeHarvest(db, {
    rawRows: raw.rows ?? [],
    handles,
    backend: backend.name,
    note: backend.note,
  });
}

/**
 * Normalise, guard and store a harvest somebody else fetched, then report what happened.
 *
 * Split out of `refreshCorpus` on 23 November so the two-phase worker path can reuse it without a
 * second copy of the guards. The guards are the reason this file exists — 20 October erased the
 * reaction counts of 1,900 posts through a mapping mistake — and two copies of a guard is one
 * guard and one liability.
 */
export async function storeHarvest(
  db: SupabaseClient,
  opts: {
    rawRows: unknown[];
    handles: string[];
    backend: "apify" | "console";
    note: string;
    jobId?: number | string | null;
  },
) {
  const { rawRows, handles, backend, note } = opts;

  /*
   * `foreign` and `unmapped` are reported, not swallowed. harvest.mjs says why in its own words: "a
   * run that silently dropped everything and a run where nobody posted look identical otherwise."
   * A high `foreign` count is expected and healthy — a profile harvest returns other people's posts
   * from the feed — but a run where EVERYTHING was foreign means the attribution broke.
   */
  const { rows: items, foreign, unmapped } = normaliseRows(rawRows, CORPUS_WRITERS);

  const seen = new Set<string>();
  const shaped: Row[] = [];
  for (const p of items) {
    const row = rowFor(p as Record<string, unknown>);
    if (!row) continue;
    const id = String(row.activity_id);
    if (seen.has(id)) continue;
    seen.add(id);
    shaped.push(row);
  }

  const { keep, dropped } = await withoutRegressions(db, shaped);
  const { rows, held } = withoutEmptyFields(keep);

  let stored = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db
      .from("reference_writer_posts")
      .upsert(rows.slice(i, i + 100), { onConflict: "activity_id" });
    if (error) throw new Error(`could not store posts: ${error.message}`);
    stored += rows.slice(i, i + 100).length;
  }

  const result = {
    ok: true as const,
    backend,
    job: opts.jobId ?? null,
    writers: handles,
    writers_not_in_this_run: CORPUS_HANDLES.filter((h) => !handles.includes(h)),
    theirs: items.length,
    someone_elses: foreign,
    fields_the_backend_did_not_map: [...unmapped],
    stored,
    dropped_to_protect_shape: dropped,
    empty_fields_held: held,
    with_counts: rows.filter((r) => typeof r.reaction_count === "number").length,
    /*
     * The measured answer to the question `keepsLineBreaks` only ever declared.
     *
     * That field is read by nothing but its own test, which is this repository's signature defect:
     * a value nothing reads, reporting success. What a reader actually needs is what THIS run
     * received, because the backend's behaviour changed under us once already — in our favour on 23
     * November, and it can change back without a word.
     */
    with_line_breaks: rows.filter((r) => r.has_line_breaks === true).length,
    note,
  };

  await logEvent(db, "corpus_refreshed", "info", result);
  return result;
}

/** The kind that records a submission, which is the only thing that makes a job collectable. */
export const JOB_SUBMITTED = "corpus_job_submitted";

/**
 * The job this run should collect before it submits another, or null if there is nothing waiting.
 *
 * A submitted job is "pending" until some later run reports an outcome carrying its id. Both
 * outcomes carry one — `corpus_refreshed.job` and `corpus_failed.job` — so the pending set is
 * simply the submitted ids with no outcome against them.
 *
 * ORDERED AND LIMITED rather than windowed by `created_at`, for the reason orphan-runs.ts records:
 * the rows this system writes take `created_at` from the column default, so the value is not in the
 * payload.
 */
export async function pendingConsoleJob(
  db: SupabaseClient,
): Promise<{ jobId: number | string; writers: string[] } | null> {
  const { data: submitted, error } = await db
    .from("system_events")
    .select("detail")
    .eq("kind", JOB_SUBMITTED)
    .order("id", { ascending: false })
    .limit(10);
  if (error || !submitted?.length) return null;

  const { data: finished } = await db
    .from("system_events")
    .select("detail")
    .in("kind", ["corpus_refreshed", "corpus_failed"])
    .order("id", { ascending: false })
    .limit(40);

  const settled = new Set(
    (finished ?? [])
      .map((r) => (r as { detail?: { job?: unknown } }).detail?.job)
      .filter((j) => j !== null && j !== undefined)
      .map(String),
  );

  for (const row of submitted) {
    const detail = (row as { detail?: { job?: unknown; writers?: unknown } }).detail ?? {};
    const jobId = detail.job;
    if (jobId === null || jobId === undefined) continue;
    if (settled.has(String(jobId))) continue;
    return {
      jobId: jobId as number | string,
      writers: Array.isArray(detail.writers) ? detail.writers.map(String) : [],
    };
  }
  return null;
}

/**
 * Collect whatever is waiting, then submit the next batch. The worker's whole job.
 *
 * WHY THIS SHAPE, AND WHAT IT REPLACES
 *
 * Until today this worker submitted a harvest and waited for it inside the isolate. That could
 * never work and the logs say so: it failed on 19 November, on 23 November at 06:00, and twice more
 * this afternoon under the new three-writer batch. The reason is not the batch size, which is what
 * I assumed and fixed first. It is that the console takes 111s to 137s to answer AT ALL — measured
 * across six jobs of one and three profiles — against a platform that kills every execution at
 * 150.0s. A single profile already spends most of the budget, so no batch size fits.
 *
 * The job does not need us. It runs server-side to completion whether anybody is listening. So:
 *
 *   1. Collect the job the last run submitted, if it has landed. This costs one API call and a
 *      page of rows, because the waiting already happened in the gap between runs.
 *   2. Submit the next batch and record its id. If this isolate dies now, nothing is lost: the
 *      submission is on record and the next run collects it.
 *   3. If there is budget left, poll the new job too, so one manual `run_worker` can still finish
 *      a whole writer in one go when somebody is sitting there waiting for it.
 *
 * Step 3 is the opportunistic half and it is allowed to fail. Steps 1 and 2 are what make the
 * schedule work.
 */
export async function collectThenSubmit(db: SupabaseClient, maxPosts = 50) {
  const backend = backendFor();
  if (!backend.name) {
    await logEvent(db, "corpus_blocked", "warn", { means: backend.note });
    return { ok: false as const, note: backend.note };
  }

  /*
   * Apify fetches synchronously and has no two-phase API here, so it keeps the old path. It is also
   * not configured, so this branch has never run — said plainly rather than implied, because an
   * untested branch that looks tested is how 20 October happened.
   */
  if (backend.name === "apify") {
    const { handles } = await corpusDueForRefresh(db);
    return await refreshCorpus(db, maxPosts, handles);
  }

  const creds = { key: secret("XP_API_KEY"), base: secret("XP_BASE") ?? undefined };
  const collected: Record<string, unknown>[] = [];

  // ── 1. Collect what is already waiting ──────────────────────────────────
  const pending = await pendingConsoleJob(db);
  if (pending) {
    try {
      const got = await collectConsoleHarvest({ jobId: pending.jobId, ...creds });
      if (!got.done) {
        await logEvent(db, "corpus_job_waiting", "info", {
          job: pending.jobId,
          writers: pending.writers,
          status: got.status,
          means: "The job submitted by an earlier run has not finished. Nothing is lost and no new " +
            "job is submitted on top of it — the next run collects this one.",
        });
        return { ok: true as const, waiting_on: pending.jobId, submitted: null };
      }
      if (!got.won) {
        await logEvent(db, "corpus_failed", "error", {
          job: pending.jobId,
          writers: pending.writers,
          error: `job ${pending.jobId} ${got.status}: ${got.error}`,
          means: "The scraper refused this one. Those writers go to the back of the rotation and " +
            "are retried once the others have had a turn, which is why a failure cannot stall the " +
            "corpus.",
        });
      } else {
        collected.push(
          await storeHarvest(db, {
            rawRows: got.rows,
            handles: pending.writers.length ? pending.writers : CORPUS_HANDLES,
            backend: "console",
            note: backend.note,
            jobId: pending.jobId,
          }) as unknown as Record<string, unknown>,
        );
      }
    } catch (err) {
      await logEvent(db, "corpus_failed", "error", {
        job: pending.jobId,
        error: `collecting job ${pending.jobId} threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  // ── 2. Submit the next batch, and record it before anything can kill us ──
  const due = await corpusDueForRefresh(db);
  const { jobId } = await submitConsoleHarvest({
    profileUrls: due.handles.map(PROFILE_URL),
    ...creds,
  });
  await logEvent(db, JOB_SUBMITTED, "info", {
    job: jobId,
    writers: due.handles,
    chosen_because: due.basis,
    means: "Submitted and deliberately not waited for. The console takes 111-137s to answer and " +
      "this runtime is killed at 150s, so waiting is what broke every previous run. The next run " +
      "collects this job; if this isolate dies now, the work is still on record.",
  });

  // ── 3. If there is time, finish it now rather than next run ─────────────
  let finishedNow: Record<string, unknown> | null = null;
  try {
    finishedNow = await withBudget(
      (async () => {
        let got = await collectConsoleHarvest({ jobId, ...creds });
        while (!got.done) {
          await new Promise((r) => setTimeout(r, 8_000));
          got = await collectConsoleHarvest({ jobId, ...creds });
        }
        if (!got.won) {
          await logEvent(db, "corpus_failed", "error", {
            job: jobId,
            writers: due.handles,
            error: `job ${jobId} ${got.status}: ${got.error}`,
          });
          return null;
        }
        return await storeHarvest(db, {
          rawRows: got.rows,
          handles: due.handles,
          backend: "console",
          note: backend.note,
          jobId,
        }) as unknown as Record<string, unknown>;
      })(),
      OPPORTUNISTIC_BUDGET_MS,
      "waiting for the job just submitted",
    );
  } catch {
    /*
     * Deliberately swallowed, and this is the only place in this file where that is right.
     *
     * Running out of budget here is the EXPECTED path, not a fault: the job is submitted, its id is
     * on record, and the next run collects it. Filing an error would train whoever reads these
     * events to ignore `corpus_failed`, which is the one event that has to keep meaning something.
     */
  }

  return {
    ok: true as const,
    collected_from_last_run: collected,
    submitted: { job: jobId, writers: due.handles, chosen_because: due.basis },
    finished_in_this_run: finishedNow,
  };
}

/**
 * Answer the caller, then harvest — the same arrangement worker-engage needed, for the same reason.
 *
 * `invoke_worker` allows 30 seconds and a harvest of nine profiles takes minutes. A worker that
 * cannot answer in its budget leaves a pg_net timeout and nothing else: no rows, no event, and no
 * line in the edge logs, because it never sends a response. That is measured, not predicted — it is
 * what the creator poll did on 18 November, its first run with anybody to fetch.
 *
 * So every path has to leave an event. `corpus_started` goes in first, and a start with no finish
 * beside it means a run was torn down part-way.
 */
export async function refreshDetached(db: SupabaseClient): Promise<Response> {
  /*
   * The batch is chosen BEFORE the start event, because the start event is what records it.
   *
   * That ordering is the whole mechanism: `corpus_started.writers` is the only record that these
   * three were attempted, and `corpusDueForRefresh` reads it back on the next run to rotate. If the
   * batch were chosen inside the work, a torn-down run would leave no trace of whose turn it had
   * been and the rotation would stall on the same three.
   */
  const due = await corpusDueForRefresh(db).catch((err) => ({
    handles: CORPUS_HANDLES.slice(0, CORPUS_BATCH),
    basis: `choosing the batch threw (${err instanceof Error ? err.message : String(err)})`,
  }));

  await logEvent(db, "corpus_started", "info", {
    writers: due.handles,
    chosen_because: due.basis,
    means: `This run fetches ${due.handles.length} of the ${CORPUS_HANDLES.length} writers. All ` +
      `nine in one job measured 273s on 23 November against a platform that kills every run at ` +
      `150s, so the whole corpus in one execution is not slow, it is impossible. The response goes ` +
      `out before the harvest finishes, so a start with no finish beside it is a run that was torn ` +
      `down part-way.`,
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
      /*
       * Under a deadline this runtime can hold — see withBudget. The budget is a backstop here
       * rather than the mechanism: `collectThenSubmit` is built so that the expensive part, waiting
       * for the scraper, happens between runs instead of inside one. If this fires, something other
       * than the harvest latency is slow.
       */
      await withBudget(collectThenSubmit(db), HARVEST_BUDGET_MS, "the corpus refresh");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logEvent(db, "corpus_failed", "error", { error: message.slice(0, 500) })
        .catch(() => {});
    }
  })();

  try {
    // deno-lint-ignore no-explicit-any
    const edge = (globalThis as any).EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(work);
    else await work;
  } catch {
    await work;
  }

  return json({
    ok: true,
    started: true,
    next: "What happened is in the event log: corpus_refreshed with the counts, corpus_blocked if " +
      "no scraping key is in the vault, or corpus_failed. A corpus_started with none of those " +
      "beside it means the run did not reach the end.",
  });
}
