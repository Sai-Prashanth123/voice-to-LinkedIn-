/**
 * Josh's creator list, and what he did with a comment option.
 *
 * Three decisions, behind the one write door for the same reason every other decision is: the
 * `content_mcp` role has no UPDATE and no DELETE anywhere, and all three of these are updates. A
 * tool writing directly would appear to work today and start failing silently the day the scoped
 * key is minted.
 *
 * WHOSE LIST THIS IS
 *
 * His. The `josh-comment` skill attributes the judgement in as many words — "deciding whose posts
 * are worth his time is a judgement about his market that he has and this does not" — so these are
 * the only three doors into `creators`, all of them driven by something he said, and nothing in the
 * system adds a creator on its own. `worker-engage` reads this table and never writes to it.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/jobs.ts";
import { logEvent } from "../_shared/db.ts";
import { notice } from "../_shared/notices.ts";
import { secret } from "../_shared/secrets.ts";
import type { Body } from "./decisions.ts";

const str = (v: unknown): string => String(v ?? "").trim();

/**
 * A LinkedIn handle out of whatever he said.
 *
 * He will paste a URL, because that is what LinkedIn gives you when you click share. He may also
 * just type a name. Both have to land on the same row or he will end up watching one person twice
 * under two spellings, and the poll would fetch the same profile twice and pay for it twice.
 *
 * Deliberately narrow about what it ACCEPTS: the table's CHECK constraints refuse anything else
 * anyway, and a clear refusal here is a sentence he can act on rather than a constraint violation.
 */
export function handleFrom(input: string): string | null {
  const raw = str(input);
  if (!raw) return null;

  // A URL, with or without the scheme, the www, a trailing slash, or a query string.
  const fromUrl = raw.match(/linkedin\.com\/in\/([^/?#\s]+)/i)?.[1];

  /*
   * The `in/` prefix comes off BEFORE the trailing slash, not after.
   *
   * The other way round, "in/" became "in" — the slash was stripped first, so the prefix no longer
   * matched, and "in" is a perfectly valid-looking handle. He would have ended up watching a
   * creator called "in" at linkedin.com/in/in/, and the poll would have fetched it twice a day.
   */
  let candidate = decodeURIComponent(fromUrl ?? raw).trim().replace(/^@/, "");
  if (!fromUrl) candidate = candidate.replace(/^in\//i, "");
  candidate = candidate.replace(/\/+$/, "");

  if (!/^[A-Za-z0-9._-]{2,100}$/.test(candidate)) return null;
  return candidate;
}

export const profileUrlFor = (handle: string) => `https://www.linkedin.com/in/${handle}/`;

/**
 * Start watching someone, or put someone back he had stopped watching.
 *
 * Idempotent on purpose: asking twice is something he will do, and the second ask must not read as
 * an error or create a second row. A creator he had deactivated is reactivated rather than
 * duplicated — 6.3 means the old row is still there and still the one the stored posts point at.
 */
export async function watchCreator(db: SupabaseClient, body: Body): Promise<Response> {
  const given = str(body.creator) || str(body.handle) || str(body.profile_url) || str(body.url);
  const handle = handleFrom(given);
  if (!handle) {
    return json({
      error: given
        ? `"${given.slice(0, 80)}" is not a LinkedIn profile I can read. Give me their profile ` +
          `URL, or just the handle out of it — the bit after /in/.`
        : "Tell me who to watch: their LinkedIn profile URL, or the handle out of it.",
    }, 400);
  }

  const displayName = str(body.display_name) || str(body.name) || null;

  const { data: existing } = await db
    .from("creators")
    .select("handle, display_name, active")
    .eq("handle", handle)
    .maybeSingle();

  /*
   * Decided BEFORE the write, not read off `existing` afterwards.
   *
   * What he is told depends on what was true when he asked — already watching, watching again, or
   * new — and the upsert is about to make all three look the same. Reading it after is the kind of
   * thing that works until the client stops handing back a copy.
   */
  const alreadyWatching = existing?.active === true;
  const wasDeactivated = existing != null && existing.active === false;
  const knownName = existing?.display_name ?? null;

  const row: Record<string, unknown> = {
    handle,
    profile_url: profileUrlFor(handle),
    active: true,
  };
  // Never write a null over a name he gave us earlier.
  if (displayName) row.display_name = displayName;

  const { error } = await db.from("creators").upsert(row, { onConflict: "handle" });
  if (error) return json({ error: `could not add ${handle}: ${error.message}` }, 500);

  const { count } = await db
    .from("creators")
    .select("handle", { count: "exact", head: true })
    .eq("active", true);

  await logEvent(db, "creator_watched", "info", { handle, reactivated: wasDeactivated });

  /*
   * CAN ANYTHING ACTUALLY FETCH THEIR POSTS? ASKED HERE, BECAUSE HERE IS WHERE HE IS LISTENING.
   *
   * worker-engage needs XP_API_KEY or APIFY_TOKEN and throws when both are absent. But it returns
   * early on an empty `creators` table — the off state — several lines BEFORE it looks for a
   * credential. So for the fifteen days after the feature shipped it ran twice a day, logged
   * `creator_poll_idle` eighteen times, and never once touched the code that needs a key.
   *
   * MEASURED 18 November 2026: neither name is in the vault. So the first creator Josh ever added
   * would also have been the first test of the credentials, and he would have met it as a worker
   * that failed hours later, in a `system_events` row nothing reads out to him.
   *
   * This is the moment to say so: he has just named somebody and is waiting to hear what happens
   * next. It does NOT refuse — the list is his, the row is correct, and `watch_creator` recording
   * his instruction is not the thing that is broken.
   */
  const canFetch = secret("XP_API_KEY") !== null || secret("APIFY_TOKEN") !== null;
  if (!canFetch) {
    await notice(
      db,
      "creator_poll_blocked",
      `${handle} is on your watch list, but nothing can fetch their posts yet: neither ` +
        `XP_API_KEY nor APIFY_TOKEN is in the vault, so the twice-daily run has no way in. ` +
        `The list is kept and starts working the moment one is added.`,
      // warn, not info: he has asked for a feature and it cannot run. An info notice reads as
      // news, and this is a thing that needs doing.
      { severity: "warn", actedOn: ["list_creators"] },
    );
    await logEvent(db, "creator_watched_without_credentials", "warn", {
      handle,
      means: "The creator is recorded and the poll cannot read anybody. Neither fetch credential " +
        "is set, and the empty-list early return meant nothing had ever surfaced that.",
      remedy: "select vault.create_secret('<value>', 'APIFY_TOKEN');",
    });
  }

  return json({
    ok: true,
    handle,
    display_name: displayName ?? knownName,
    profile_url: profileUrlFor(handle),
    watching: count ?? null,
    already_watching: alreadyWatching,
    // Reported rather than inferred from silence: "it can fetch" and "nobody has checked" are
    // different answers, and the second one is what fifteen days of idle runs actually meant.
    can_fetch_posts: canFetch,
    ...(!canFetch && {
      cannot_fetch_yet: "Neither XP_API_KEY nor APIFY_TOKEN is in the vault, so nothing can read " +
        "their posts. The watch list is saved and works as soon as one is set: " +
        "select vault.create_secret('<value>', 'APIFY_TOKEN');",
      tell_him: "Say he is on the list, and say plainly that no comments can come back until one " +
        "of the two keys is added — do not let him find that out from an empty result in a week.",
    }),
    /*
     * The credential sentence is APPENDED, not substituted.
     *
     * It replaced this whole chain in the first version of this change, and two existing tests
     * caught it: "already watching" and "watching again" are facts he asked about, and losing
     * them to a warning about something else is the wrong trade. Both are true at once, so both
     * are said — and the promise about the next run is the one part that is dropped, because with
     * no key it is the sentence that would be false.
     */
    next: (alreadyWatching
      ? `Already watching ${handle}; nothing changed.`
      : wasDeactivated
      ? `Watching ${handle} again. The posts already stored are still there.`
      : canFetch
      ? `Watching ${handle}. The next run picks up anything they have posted — it runs at 07:00 ` +
        `and 15:00 on weekdays, and you can run it now with run_worker if you would rather not wait.`
      : `Watching ${handle}.`) +
      (canFetch
        ? ""
        : ` Nothing can fetch their posts yet, so no comment options will appear until ` +
          `XP_API_KEY or APIFY_TOKEN is in the vault.`),
  });
}

/**
 * Stop watching someone. Deactivated, never deleted (6.3) — the posts stored against them still
 * point at this row, and a creator he dropped is a decision worth keeping.
 */
export async function stopWatchingCreator(db: SupabaseClient, body: Body): Promise<Response> {
  const given = str(body.creator) || str(body.handle) || str(body.profile_url) || str(body.url);
  const handle = handleFrom(given);
  if (!handle) return json({ error: "Tell me who to stop watching — their handle or profile URL." }, 400);

  const { data: existing } = await db
    .from("creators")
    .select("handle, active")
    .eq("handle", handle)
    .maybeSingle();
  if (!existing) {
    return json({ error: `${handle} is not on your list, so there is nothing to stop.` }, 404);
  }

  const { error } = await db
    .from("creators")
    .update({ active: false })
    .eq("handle", handle);
  if (error) return json({ error: `could not stop watching ${handle}: ${error.message}` }, 500);

  await logEvent(db, "creator_unwatched", "info", { handle });

  return json({
    ok: true,
    handle,
    was_active: existing.active === true,
    next: `No longer watching ${handle}. Nothing was deleted — their posts and any comment ` +
      `options you have not used are still there, and watch_creator puts them back.`,
  });
}

/**
 * Which option he actually left, and which he passed over.
 *
 * This is the whole learning signal for this feature, and the reason the status column exists. Until
 * it is called there is no way to tell a comment he used from one he ignored — the same gap that
 * left `record_posted_by_hand` uncalled and the retelling index empty while he posted every week.
 */
export async function recordCommentUsed(db: SupabaseClient, body: Body): Promise<Response> {
  const id = Number(body.option_id ?? body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "option_id must be an integer" }, 400);

  const asked = str(body.status) || (body.used === false ? "discarded" : "used");
  if (!["used", "discarded"].includes(asked)) {
    return json({ error: `status must be "used" or "discarded", not "${asked}".` }, 400);
  }

  const { data: option } = await db
    .from("comment_options")
    .select("id, status, activity_id")
    .eq("id", id)
    .maybeSingle();
  if (!option) return json({ error: `there is no comment option ${id}.` }, 404);

  if (option.status !== "offered") {
    // Idempotent, and honest about it. Re-recording the same decision is not an error; silently
    // overwriting a different one would be.
    return json({
      ok: true,
      option_id: id,
      status: option.status,
      unchanged: true,
      next: `That one was already recorded as ${option.status}.`,
    });
  }

  const { error } = await db
    .from("comment_options")
    .update({ status: asked, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "offered");
  if (error) return json({ error: `could not record it: ${error.message}` }, 500);

  return json({
    ok: true,
    option_id: id,
    status: asked,
    next: asked === "used"
      ? "Recorded. That is the only signal this has about which comments are worth writing."
      : "Recorded as passed over, which is just as useful a signal as a used one.",
  });
}
