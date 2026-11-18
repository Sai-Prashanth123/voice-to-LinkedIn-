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
 * THE TWO BACKENDS ARE NOT INTERCHANGEABLE, AND THIS IS THE WHOLE RISK
 *
 * The console (XP_API_KEY) strips line breaks from every LinkedIn post it returns — verified
 * against the live API on 9 October, when all 14 rows of a Matt Barker harvest came back as one
 * unbroken paragraph each. Apify (APIFY_TOKEN) preserves them.
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
import { json } from "../_shared/jobs.ts";
import { fetchFromApify, fetchFromConsole, normaliseRows } from "../../../scripts/lib/harvest.mjs";
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
      keepsLineBreaks: false,
      note: "Only the console key is set, and the console strips line breaks (verified 9 October). " +
        "So this run may ADD posts not already held, and cannot refresh a post that is stored with " +
        "its shape — which is most of them, and is the half Josh asked for. Set APIFY_TOKEN in the " +
        "vault to refresh reaction counts on the existing corpus.",
    };
  }
  return {
    name: null,
    keepsLineBreaks: false,
    note: "Neither APIFY_TOKEN nor XP_API_KEY is in the vault, so there is no way to fetch a post.",
  };
}

/** The harvest, stored. Returns what it did, for the event log. */
export async function refreshCorpus(db: SupabaseClient, maxPosts = 50) {
  const backend = backendFor();
  if (!backend.name) {
    await logEvent(db, "corpus_blocked", "warn", { means: backend.note });
    return { ok: false as const, backend: null, note: backend.note };
  }

  const profileUrls = CORPUS_HANDLES.map(PROFILE_URL);
  const raw = backend.name === "apify"
    ? await fetchFromApify({ profileUrls, token: secret("APIFY_TOKEN"), maxPosts })
    : await fetchFromConsole({
      profileUrls,
      key: secret("XP_API_KEY"),
      base: secret("XP_BASE") ?? undefined,
    });

  /*
   * `foreign` and `unmapped` are reported, not swallowed. harvest.mjs says why in its own words: "a
   * run that silently dropped everything and a run where nobody posted look identical otherwise."
   * A high `foreign` count is expected and healthy — a profile harvest returns other people's posts
   * from the feed — but a run where EVERYTHING was foreign means the attribution broke.
   */
  const { rows: items, foreign, unmapped } = normaliseRows(raw.rows ?? [], CORPUS_WRITERS);

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
    backend: backend.name,
    theirs: items.length,
    someone_elses: foreign,
    fields_the_backend_did_not_map: [...unmapped],
    stored,
    dropped_to_protect_shape: dropped,
    empty_fields_held: held,
    with_counts: rows.filter((r) => typeof r.reaction_count === "number").length,
    note: backend.note,
  };

  await logEvent(db, "corpus_refreshed", "info", result);
  return result;
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
  await logEvent(db, "corpus_started", "info", {
    means: "The response goes out before the harvest finishes, because nine profiles do not fetch " +
      "in the 30 seconds invoke_worker allows. A start with no finish beside it is a run that was " +
      "torn down part-way.",
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
      await refreshCorpus(db);
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
