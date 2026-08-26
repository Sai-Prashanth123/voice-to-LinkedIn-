/**
 * The queue processor. pg_cron ticks this every minute.
 *
 * One function routes every queued job type rather than deploying a dozen pollers. Each invocation
 * takes a small batch and does one step per job, which keeps every call well inside the Edge
 * Function wall-clock limit and makes the pipeline resumable: a job that dies mid-step becomes
 * claimable again after backoff instead of being lost.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleDraft } from "../_shared/handlers/draft.ts";
import { handleGate } from "../_shared/handlers/gate.ts";
import { handleInterviewExtract, handleInterviewStep } from "../_shared/handlers/interview.ts";
import { handleTranscribe } from "../_shared/handlers/transcribe.ts";
import { handleVisual } from "../_shared/handlers/visual.ts";
import { enqueue, runWorker } from "../_shared/jobs.ts";
import { getSetting } from "../_shared/db.ts";
import { joshChatId, sendMessage } from "../_shared/telegram.ts";
import type { Job } from "../_shared/types.ts";

const HANDLERS: Record<string, (db: SupabaseClient, job: Job) => Promise<void>> = {
  transcribe: handleTranscribe,
  interview_step: handleInterviewStep,
  interview_extract: handleInterviewExtract,
  draft: handleDraft,
  gate: handleGate,
  visual: handleVisual,
  notify_draft_ready: notifyDraftReady,
  draft_digest: sendDraftDigest,
};

Deno.serve(() =>
  runWorker(
    { name: "worker-dispatch", types: Object.keys(HANDLERS), batch: 3, chain: true },
    async (db, job) => {
      const handler = HANDLERS[job.type];
      if (!handler) throw new Error(`no handler for job type "${job.type}"`);
      await handler(db, job);
    },
  )
);

/**
 * 9.16 — push-back is optional, and the system must not wait on Josh. This tells him a draft exists
 * so he *can* react in the session, but nothing depends on his doing so: the post is already in the
 * calendar and he will see it in the weekly pass either way.
 *
 * 9.5 — "timing is open, immediate or batched, because Josh does not want to wait after a session
 * but also does not want pinging all day." Both halves are real, and only one of them was built.
 * A single draft finishing after a session should arrive; a selection run that queues ten should
 * not arrive as ten messages. `draft_delivery` decides which, and defaults to batched.
 */
async function notifyDraftReady(db: SupabaseClient, job: Job): Promise<void> {
  const momentId = Number(job.payload.moment_id);
  const draftId = Number(job.payload.draft_id);

  if (await getSetting(db, "draft_delivery", "batched") === "batched") {
    // The first draft of a burst schedules the digest; the other nine find it already scheduled and
    // add nothing.
    //
    // The key is BUCKETED BY WINDOW, not a constant. `jobs.dedupe_key` is unique for all time, so a
    // fixed string would schedule exactly one digest ever and every later draft would vanish
    // silently — the same trap that stranded a moment in `queued` when the draft job used a
    // once-per-moment key. Two drafts landing either side of a bucket boundary schedule two
    // digests, which costs nothing: the digest only reports what it has not reported before, so the
    // second one finds nothing and says nothing.
    const minutes = await getSetting(db, "draft_digest_minutes", 45);
    const runAt = Date.now() + minutes * 60_000;
    const bucket = Math.floor(runAt / (minutes * 60_000));

    await enqueue(db, "draft_digest", {}, {
      runAfter: new Date(runAt),
      dedupeKey: `draft_digest:${bucket}`,
    });
    return;
  }

  const { data: draft } = await db.from("drafts").select("body").eq("id", draftId).single();
  const { data: moment } = await db.from("moments").select("ref").eq("id", momentId).single();
  if (!draft || !moment) return;

  const messageId = await sendMessage(
    joshChatId(),
    `Draft ready — ${moment.ref}\n\n${"─".repeat(20)}\n\n${draft.body}\n\n${"─".repeat(20)}\n\n` +
      `It is in the calendar as a draft. Reply to this message if you want it changed, or leave it ` +
      `for the weekly pass — nothing is waiting on you.`,
  );

  // Marked here as well as in the digest: switching `draft_delivery` mid-week must not cause a
  // draft announced immediately to be announced a second time by the next digest.
  await db.from("posts")
    .update({ announced_at: new Date().toISOString() })
    .eq("draft_id", draftId)
    .is("announced_at", null);

  // Recording the id is what makes a REPLY unambiguous push-back (9.14) rather than a guess about
  // whether Josh's next message was feedback or a new thought.
  if (messageId) {
    await db.from("sent_messages").insert({
      telegram_message_id: messageId,
      kind: "draft",
      moment_id: momentId,
      draft_id: draftId,
    });
  }
}

/**
 * 9.5 — one message for everything that became ready, rather than one message per draft.
 *
 * "Josh does not want to wait after a session but also does not want pinging all day." A digest a
 * short while after drafts land satisfies both: a single draft written just after a session still
 * arrives in minutes, and a selection run that queues ten arrives as one message instead of ten.
 *
 * IDEMPOTENT ON THE POST. It reports the drafts not yet marked `announced_at`, so a duplicate
 * digest — two bursts either side of a window boundary, a job retried after a timeout — finds
 * nothing new and sends nothing rather than showing him the same drafts twice.
 */
async function sendDraftDigest(db: SupabaseClient, _job: Job): Promise<void> {
  // Idempotent on the POST, not on a message.
  //
  // This used to write one `sent_messages` row per draft, all sharing the digest's single
  // telegram_message_id — which is that table's PRIMARY KEY. A digest listing three drafts therefore
  // recorded exactly one and dropped the other two without error, so every later run announced them
  // again. Seen live: three drafts, one recorded. A digest that repeats itself every 45 minutes is
  // worse than one that never arrives.
  const { data: fresh } = await db
    .from("posts")
    .select("id, body, moment_id, draft_id, visual_id, moments!inner(ref, pillar)")
    .eq("status", "draft")
    .is("marked_ready_at", null)
    .is("announced_at", null)
    .order("id");

  if (!fresh || fresh.length === 0) return;

  const lines = fresh.map((p) => {
    // deno-lint-ignore no-explicit-any
    const m = (p as any).moments;
    const one = Array.isArray(m) ? m[0] : m;
    const tags = [one?.pillar, p.visual_id ? "image" : null].filter(Boolean).join(", ");
    return `${one?.ref ?? "—"}${tags ? ` (${tags})` : ""}\n${firstLine(p.body)}`;
  });

  const messageId = await sendMessage(
    joshChatId(),
    `${fresh.length} draft${fresh.length === 1 ? "" : "s"} ready.\n\n` +
      `${lines.join("\n\n")}\n\n` +
      `They are in the calendar. /review to go through them whenever it suits — nothing is waiting ` +
      `on you.`,
  );

  // Marked on the posts themselves, in one statement, so nothing depends on a message id being
  // unique across several rows.
  await db.from("posts")
    .update({ announced_at: new Date().toISOString() })
    .in("id", fresh.map((p) => p.id));

  // One row for the digest message, so a reply to it is not orphaned. Kind "other" because it is
  // about several drafts, and a reply cannot be pushback on a specific one.
  if (messageId) {
    await db.from("sent_messages").insert({
      telegram_message_id: messageId,
      kind: "other",
      moment_id: fresh[0].moment_id,
    });
  }
}

/** Enough of a post to recognise it, without pasting the whole thing into a list of ten. */
function firstLine(body: string): string {
  const line = (body ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > 110 ? `${line.slice(0, 107)}…` : line;
}
