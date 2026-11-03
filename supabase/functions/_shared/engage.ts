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
 * three deterministic checks and records what they find on the row. They are a FLOOR, not a gate:
 * they catch a named client and a copied phrase, and they cannot catch an invented number or the
 * composite that actually identifies a company — a figure plus a niche plus a date.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets, secret } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import { notice } from "../_shared/notices.ts";
import { callStructured, MODELS } from "../_shared/llm.ts";
import { loadLibrary } from "../_shared/library.ts";
import { COMMENT_SYSTEM, COMMENT_USER, PROMPT_VERSION } from "../_shared/prompts.ts";
import { CommentOptionsSchema } from "../_shared/schemas.ts";
import { borrowedRuns, hashRun, shinglesOf } from "../_shared/shingles.ts";
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



export async function poll(db: SupabaseClient, write: OptionWriter = optionsFor): Promise<Response> {
  const { data: creators, error } = await db
    .from("creators")
    .select("handle, display_name, profile_url")
    .eq("active", true)
    .order("handle");
  if (error) throw new Error(`could not read creators: ${error.message}`);

  const list = (creators ?? []) as Creator[];

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

  for (const post of queue) {
    try {
      const options = await write(db, library.prompt, post, wanted);
      const kept: Record<string, unknown>[] = [];

      for (const o of options) {
        const flags = review(o.body, post.text, banned);
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
export function review(body: string, postText: string, bannedNames: string[]): Flag[] {
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

  return flags;
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
