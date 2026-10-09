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
      .select("id, gate_passed, gate_reason")
      .eq("id", post.draft_id)
      .maybeSingle();

    if (draft && draft.gate_passed !== true) {
      return {
        ok: false,
        why: draft.gate_passed === false
          ? `Draft ${draft.id} was rejected by the checks, so it cannot be approved. ` +
            `${draft.gate_reason ?? ""} Ask for a rewrite instead.`.trim()
          : `Draft ${draft.id} has not been judged yet — run the eight checks first.`,
      };
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

  return { ok: true, when: parsed.spoken, postId, draftId: post.draft_id ?? null };
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
