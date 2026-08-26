/**
 * WHAT COMES BACK (clause 12a and 12.4), written from one place.
 *
 * Two things live here, and they are together because both had the same failure: a signal the spec
 * calls automatic and required, implemented on exactly one code path that turned out not to run.
 *
 * 12.2 — THE DIFF, DECOUPLED FROM LINKEDIN
 *
 *   "The difference between the draft the system produced and the post Josh actually published must
 *    be captured automatically, every time."
 *   "These two must be enough on their own to drive the learning in clause 12c." (12.3)
 *
 * It was captured in exactly one place: inside the successful LinkedIn publish loop in
 * `worker-publish`. LinkedIn is not connected, so it captured nothing — two published posts, zero
 * diffs, `edit_class` null everywhere. That took 13.3's "how many Josh rewrote" and the whole of the
 * 17a acceptance measurement down with it, and it left the automatic layer — the layer 12.3 says
 * must stand on its own — entirely dependent on the one thing that is blocked.
 *
 * The edit is knowable the moment Josh approves. Nothing about it needs a network call. So it is
 * measured at approval, and refreshed at publish only if the body moved again in between.
 *
 * 12.4 — THE VERDICT
 *
 *   "Josh must be able to leave a one-line verdict on a draft in a couple of seconds."
 *
 * One writer, so a verdict left by tapping in Telegram and one typed in the web app are the same row
 * written the same way — the rule `_shared/conversation.ts` already establishes for the conversation
 * question, for the same reason: two surfaces are fine, two different answers are not.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { classifyEdit } from "./diff.ts";
import { logEvent } from "./db.ts";

export type EditStage = "approved" | "published";

export interface EditMeasurement {
  measured: boolean;
  editRatio: number | null;
  editClass: "light" | "rewrite" | null;
  reason?: string;
}

/**
 * Measure what Josh changed, and record it against the post.
 *
 * @param stage "approved" is the moment he marks it ready and is the one that needs no LinkedIn.
 *              "published" re-measures only if the body moved after approval, so a post he approved
 *              and never touched again is not reclassified by a second identical comparison.
 */
export async function recordEditDiff(
  db: SupabaseClient,
  postId: number,
  stage: EditStage,
): Promise<EditMeasurement> {
  const none: EditMeasurement = { measured: false, editRatio: null, editClass: null };

  const { data: post } = await db
    .from("posts")
    .select("id, moment_id, draft_id, body")
    .eq("id", postId)
    .maybeSingle();

  if (!post) return { ...none, reason: "post not found" };

  // A post with no draft behind it was not written by the system, so there is no "what it wrote" to
  // compare against. Recorded rather than silently skipped: 12.2 says every time, and a post that
  // cannot satisfy it should be visible rather than absent.
  if (!post.draft_id) {
    await logEvent(db, "edit_diff_unmeasurable", "info", {
      post_id: postId,
      stage,
      reason: "no draft_id — this post was not produced by the drafter",
    });
    return { ...none, reason: "no draft on this post" };
  }

  const { data: draft } = await db
    .from("drafts")
    .select("body")
    .eq("id", post.draft_id)
    .maybeSingle();

  if (!draft?.body) return { ...none, reason: "draft body missing" };

  const { data: existing } = await db
    .from("outcomes")
    .select("approved_body, edit_stage")
    .eq("post_id", postId)
    .maybeSingle();

  // Nothing moved between approval and publishing, so the approval measurement still describes it.
  // Re-running would produce the same numbers and overwrite the honest `edit_stage`.
  if (
    stage === "published" && existing?.edit_stage === "approved" &&
    existing.approved_body === post.body
  ) {
    await db.from("outcomes").update({
      published_body: post.body,
      updated_at: new Date().toISOString(),
    }).eq("post_id", postId);
    return { measured: false, editRatio: null, editClass: null, reason: "unchanged since approval" };
  }

  const diff = classifyEdit(draft.body, post.body);
  const now = new Date().toISOString();

  const { error } = await db.from("outcomes").upsert({
    post_id: postId,
    moment_id: post.moment_id,
    draft_body: draft.body,
    approved_body: post.body,
    published_body: stage === "published" ? post.body : existing ? undefined : null,
    edit_diff: diff,
    edit_ratio: diff.editRatio,
    edit_class: diff.editClass,
    edit_stage: stage,
    edit_measured_at: now,
    updated_at: now,
  });

  if (error) {
    await logEvent(db, "edit_diff_failed", "warn", { post_id: postId, stage, error: error.message });
    return { ...none, reason: error.message };
  }

  return { measured: true, editRatio: diff.editRatio, editClass: diff.editClass };
}

/**
 * 12.4 — one line, recorded against the draft it judges.
 *
 * Returns false rather than throwing on an empty verdict: every caller reaches this from a place
 * where saying nothing is a valid answer, and 12b is best effort by definition.
 */
export async function recordVerdict(
  db: SupabaseClient,
  postId: number,
  verdict: string,
  draftId?: number | null,
): Promise<boolean> {
  const text = (verdict ?? "").trim();
  if (!text) return false;

  const { data: post } = await db
    .from("posts")
    .select("moment_id, draft_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return false;

  const now = new Date().toISOString();
  const { error } = await db.from("outcomes").upsert({
    post_id: postId,
    moment_id: post.moment_id,
    verdict: text.slice(0, 500),
    verdict_at: now,
    verdict_draft_id: draftId ?? post.draft_id ?? null,
    updated_at: now,
  });

  if (error) {
    await logEvent(db, "verdict_failed", "warn", { post_id: postId, error: error.message });
    return false;
  }

  await logEvent(db, "verdict_recorded", "info", {
    post_id: postId,
    draft_id: draftId ?? post.draft_id ?? null,
    verdict: text.slice(0, 200),
  });
  return true;
}
