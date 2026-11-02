/**
 * Josh's authorisation to publish, and nothing else.
 *
 * `marked_ready_at` is the only thing in this system that authorises a post to go out (11.2, R3), and
 * until now the only code that wrote it lived in `weeklypass.ts` behind a Telegram button. Telegram is
 * being removed, so it moves here — unchanged in what it writes — and both the old button and the new
 * `mark_ready` tool call the same function. One writer, as it has always been.
 *
 * The database is the real guard and stays so: migration 0003 refuses `ready` without
 * `marked_ready_at`, `scheduled` without a date, `published` without both, and any `published_at`
 * earlier than the authorisation. Nothing here may be relaxed to make a tool more convenient.
 *
 * WHAT IS NEW HERE, AND WHY
 *
 * Two checks that the button never needed and a tool does. A button was only ever attached to a draft
 * the system had already chosen to show him, so it could not be tapped on a rejected draft or on a
 * post he had approved an hour ago. A tool can be called with any id, by a model, on his behalf — so
 * it asks whether this post is actually approvable before it writes the one field that matters.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { recordEditDiff } from "./outcome.ts";
import { logEvent } from "./db.ts";

/** Nine in the morning, local, which is what the day buttons always meant by a date. */
const POST_HOUR = 9;

export interface WhenParsed {
  date: Date;
  /** How it was understood, echoed back so he can catch a misread before it is a scheduled post. */
  spoken: string;
}

/**
 * Turn what a person said into a date.
 *
 * The Telegram version offered four buttons — tomorrow, in two days, in three, next Monday — so the
 * vocabulary is deliberately the same. A bare date is accepted too, because a tool is typed rather
 * than tapped and "the 14th" is a normal thing to type.
 *
 * Refuses the past. A post scheduled for yesterday would be picked up by the next `publish-due` tick
 * and go out immediately, which is not what anyone means by a date.
 */
export function parseWhen(input: string, now = new Date()): WhenParsed {
  const text = (input ?? "").trim().toLowerCase();
  if (!text) throw new Error('A date is required — "tomorrow", "next monday", "in 3 days" or 2026-10-14.');

  const at = (d: Date) => {
    d.setHours(POST_HOUR, 0, 0, 0);
    return d;
  };
  const plus = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return at(d);
  };

  const spokenFor = (d: Date) =>
    d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  let date: Date | null = null;

  if (/^(today|now)$/.test(text)) date = at(new Date(now));
  else if (/^tomorrow$/.test(text)) date = plus(1);
  else if (/^(the )?day after tomorrow$/.test(text)) date = plus(2);

  // "in 3 days", "3 days", "in a week"
  const inDays = text.match(/^(?:in\s+)?(\d+)\s*days?$/) ?? null;
  if (!date && inDays) date = plus(Number(inDays[1]));
  if (!date && /^(?:in\s+)?a\s+week$/.test(text)) date = plus(7);

  // "next monday", "monday"
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const named = text.match(/^(?:next\s+|on\s+)?(sun|mon|tues|wednes|thurs|fri|satur)day$/);
  if (!date && named) {
    const wanted = DAYS.findIndex((d) => d.startsWith(named[1]));
    const ahead = (wanted - now.getDay() + 7) % 7 || 7; // never today — "monday" on a Monday means the next one
    date = plus(ahead);
  }

  // A plain ISO date.
  if (!date && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    if (Number.isNaN(parsed.getTime()) || parsed.getMonth() !== m - 1) {
      throw new Error(`"${input}" is not a real date.`);
    }
    date = at(parsed);
  }

  if (!date) {
    throw new Error(
      `I could not read "${input}" as a date. Try "tomorrow", "next Monday", "in 3 days", or 2026-10-14.`,
    );
  }

  // Today is allowed and is the one case where the hour may already have passed; a date before today
  // never is.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (date < startOfToday) {
    throw new Error(
      `${spokenFor(date)} is in the past. A post dated before today would be published on the next ` +
        `tick, which is not what a date means.`,
    );
  }

  return { date, spoken: spokenFor(date) };
}

export interface ApprovalRefusal {
  ok: false;
  why: string;
}
export interface ApprovalDone {
  ok: true;
  when: string;
  postId: number;
  draftId: number | null;
  /* The checks he approved over, when the gate was advisory. Empty on a draft that passed. */
  overAdvisory?: string[];
}

/**
 * Mark a post ready and give it a date. 11.2's whole authorisation, in one call.
 */
export async function markReady(
  db: SupabaseClient,
  postId: number,
  when: string,
  now = new Date(),
): Promise<ApprovalDone | ApprovalRefusal> {
  let overAdvisory: string[] = [];

  const { data: post } = await db
    .from("posts")
    .select("id, draft_id, status, marked_ready_at, body")
    .eq("id", postId)
    .maybeSingle();

  if (!post) return { ok: false, why: `There is no post with id ${postId}.` };

  // Idempotent rather than destructive: approving twice must not re-stamp the authorisation or
  // re-measure the edit, because `outcomes` would then carry two rows for one decision.
  if (post.marked_ready_at) {
    return {
      ok: false,
      why: `That post was already approved on ${new Date(post.marked_ready_at).toDateString()}. ` +
        `Hold it first if the date needs changing.`,
    };
  }

  if (post.status === "published") {
    return { ok: false, why: "That post has already gone out." };
  }

  /*
   * THE GATE IS NOT OPTIONAL, AND A TOOL COULD SKIP IT.
   *
   * `pushToCalendar` only ever runs on a draft that passed all eight checks, so a calendar row has
   * always implied a passed gate. That stays true — this is a belt on top of it, because the tool
   * takes a post id from a model rather than from a button the system placed, and clause 9b is the
   * hardest judgement in the build to have bypassed by a typo.
   */
  if (post.draft_id) {
    const { data: draft } = await db
      .from("drafts")
      .select("id, gate_passed, gate_reason, gate_advisory")
      .eq("id", post.draft_id)
      .maybeSingle();

    /*
     * ONE EXCEPTION, AND IT IS A COLUMN RATHER THAN A SETTING.
     *
     * In one-step mode a failing draft is handed to him with its flags, and he decides. So he must
     * be able to approve one — otherwise "advisory" means nothing and he is back to receiving
     * silence, which is what he complained about.
     *
     * Read from `gate_advisory` on the draft, never from the live mode. Two consequences, both
     * wanted: turning the mode back off cannot strand a post he has already read and approved, and
     * a draft judged before that column existed can never become approvable over a failure by a
     * later flip of a flag. The permission is a property of the draft he was shown, not of the
     * system's state at the moment he says yes.
     *
     * `gate_passed === null` is still refused in every mode. Unjudged is not the same as judged and
     * overridden, and only one of them is his to override.
     */
    if (draft && draft.gate_passed !== true) {
      const overridable = draft.gate_passed === false && draft.gate_advisory === true;
      if (!overridable) {
        return {
          ok: false,
          why: draft.gate_passed === false
            ? `Draft ${draft.id} was rejected by the checks, so it cannot be approved. ` +
              `${draft.gate_reason ?? ""} Ask for a rewrite instead.`.trim()
            : `Draft ${draft.id} has not been judged yet — run the gate checks first.`,
        };
      }
      overAdvisory = String(draft.gate_reason ?? "")
        .split(" | ")
        .map((r) => r.split(":")[0].trim())
        .filter(Boolean);
    }
  }

  const parsed = parseWhen(when, now);

  await db.from("posts").update({
    status: "scheduled",
    marked_ready_at: new Date().toISOString(),
    scheduled_for: parsed.date.toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", postId);

  /*
   * 12.2 — the difference between what the system wrote and what Josh approved, measured HERE rather
   * than at publish. It needs no LinkedIn, and 12.3 says the automatic signals must be enough on their
   * own. An approval with the body untouched is itself the measurement: the strongest evidence a draft
   * was right is that he changed nothing.
   */
  await recordEditDiff(db, postId, "approved");

  if (overAdvisory.length > 0) {
    await logEvent(db, "post_approved_over_advisory_gate", "info", {
      post_id: postId,
      draft_id: post.draft_id ?? null,
      failed_checks: overAdvisory,
    });
  }

  return {
    ok: true,
    when: parsed.spoken,
    postId,
    draftId: post.draft_id ?? null,
    ...(overAdvisory.length > 0 ? { overAdvisory } : {}),
  };
}

/**
 * Record that Josh published a post HIMSELF, by hand, off a scheduled row.
 *
 * WHY THIS EXISTS
 *
 * `published_archive` is written by `worker-publish` and by nothing else, and LinkedIn has never
 * been connected. Josh posts every week by copying the text out. So on 2 November the archive held
 * ZERO rows, and three things were inert for that one reason:
 *
 *   - the retelling check's published half had nothing to compare against (7.2);
 *   - `get_outcomes` had no published post to show, so the learning loop was starved of the
 *     draft-versus-published signal 12.2 calls the strongest there is;
 *   - `record_post_verdict` and `record_conversation` had nothing to attach to.
 *
 * R3 IS NOT WEAKENED AND MUST NOT BE. This records something that has already happened to a post
 * HE approved: `posts_published_requires_josh` demands `marked_ready_at`, `scheduled_for` and
 * `published_at` together, and this sets only the last of those. A post he never marked ready is
 * refused below before the database gets the chance, so the refusal can say why.
 *
 * It is deliberately NOT a publishing route. Nothing here talks to LinkedIn, and the post must
 * already carry his approval and his date before this can say anything about it.
 *
 * THE FINAL TEXT IS THE POINT. He edits in the LinkedIn box, so what went out is usually not what
 * he approved. That difference is the measurement — `recordEditDiff(…, "published")` only
 * re-measures when the body actually moved, so a post he approved and posted untouched is not
 * reclassified by a second identical comparison.
 */
export async function recordPublished(
  db: SupabaseClient,
  postId: number,
  opts: { body?: string | null; postedOn?: string | null } = {},
): Promise<{ ok: true; postId: number; edited: boolean } | { ok: false; why: string }> {
  const { data: post } = await db
    .from("posts")
    .select("id, moment_id, status, body, marked_ready_at, scheduled_for, published_at")
    .eq("id", postId)
    .maybeSingle();

  if (!post) return { ok: false, why: `No post with id ${postId}.` };
  if (post.status === "published") {
    return {
      ok: false,
      why: `Post ${postId} is already recorded as published` +
        `${post.published_at ? ` (${String(post.published_at).slice(0, 10)})` : ""}. ` +
        `Published posts are a record, not a draft — nothing rewrites one.`,
    };
  }
  if (!post.marked_ready_at || !post.scheduled_for) {
    return {
      ok: false,
      why: `Post ${postId} was never approved, so there is nothing to record as published. ` +
        `Only Josh approves a post, with mark_ready and a date (R3) — and that has to happen ` +
        `before it goes out, not after. If he posted something the system never approved, approve ` +
        `it first and say so.`,
    };
  }

  const finalBody = typeof opts.body === "string" && opts.body.trim() ? opts.body : post.body;
  // Never before he approved it: posts_ready_precedes_publish would refuse, and a date he gives
  // that precedes his own approval is a typo rather than a fact.
  const askedFor = opts.postedOn ? new Date(opts.postedOn) : new Date();
  const readyAt = new Date(post.marked_ready_at);
  const publishedAt = Number.isNaN(askedFor.getTime()) || askedFor < readyAt ? new Date() : askedFor;

  const { error } = await db.from("posts").update({
    status: "published",
    body: finalBody,
    published_at: publishedAt.toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", postId);

  if (error) return { ok: false, why: `The database refused it: ${error.message}` };

  // 12.2, the half that needed a publish. Measures only if the body moved after approval.
  const measured = await recordEditDiff(db, postId, "published");

  /*
   * The retelling index (7.2). No embedding: the fast path has been returning a billing error, and
   * a row without a vector is still comparable by the LLM fallback and still better than no row —
   * worker-publish takes the same position in its own catch.
   *
   * `origin: "system"` because this post came through this system, whoever pressed the button.
   * "historic" is for his back catalogue, which is a different import and a different question.
   */
  await db.from("published_archive").insert({
    origin: "system",
    moment_id: post.moment_id,
    body: finalBody,
    posted_on: publishedAt.toISOString().slice(0, 10),
  });

  await db.from("moments").update({
    status: "published",
    updated_at: new Date().toISOString(),
  }).eq("id", post.moment_id);

  await logEvent(db, "published_by_hand", "info", {
    post_id: postId,
    moment_id: post.moment_id,
    edited_after_approval: measured.measured,
    edit_class: measured.editClass,
  });

  return { ok: true, postId, edited: Boolean(measured.measured) };
}

/**
 * Put an approved post back to draft — 11.2 in reverse.
 *
 * Deliberately clears both the date and the authorisation. A post that keeps `marked_ready_at` while
 * sitting at `draft` is a row the publish worker would ignore today and a trap for whoever next reads
 * the lifecycle.
 */
export async function holdPost(db: SupabaseClient, postId: number): Promise<boolean> {
  const { data } = await db.from("posts")
    .update({
      status: "draft",
      scheduled_for: null,
      marked_ready_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .neq("status", "published") // what is out is out
    .select("id");

  return (data ?? []).length > 0;
}
