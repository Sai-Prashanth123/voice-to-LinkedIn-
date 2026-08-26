/**
 * 9.16 — Josh pushing back on a draft in the same thread.
 *
 *   "When Josh happens to be in the session, he can push back on a draft in the same thread, by
 *    voice or typed, and get a revision. Revisions go back through the gate like any other draft,
 *    no exceptions."
 *
 * Its own module because the two halves of "by voice or typed" arrive at different times. A typed
 * reply is actionable the moment the webhook reads it; a voice reply has to be stored, transcribed
 * by a worker, and acted on afterwards. Both must end in exactly the same place, and they will not
 * if each path writes its own version of what push-back means.
 *
 * The voice half was silently broken: `route()` passes `msg.text ?? msg.caption ?? ""`, so a voice
 * reply arrived as an empty string and the old handler returned without a word. Josh would have
 * recorded his objection, watched it be received, and seen nothing happen — the worst kind of
 * failure, because there is nothing to notice.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueue } from "./jobs.ts";
import { logEvent } from "./db.ts";

export async function pushBack(
  db: SupabaseClient,
  momentId: number,
  draftId: number,
  note: string,
): Promise<boolean> {
  if (!note.trim()) return false;

  const { data: draft } = await db
    .from("drafts")
    .select("body")
    .eq("id", draftId)
    .maybeSingle();

  // 7.2 — a near-miss warning attached to the original draft still applies to its revision. Without
  // carrying it, the rewrite is free to walk into the retelling the first attempt was steered away
  // from, and nothing would catch it: the dedup check runs at selection, which has already happened.
  const { data: sourceJob } = await db
    .from("jobs")
    .select("payload")
    .eq("type", "draft")
    .eq("payload->>moment_id", String(momentId))
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  await enqueue(db, "draft", {
    moment_id: momentId,
    // A fresh cycle rather than a consumed strike. The three attempts in 9.8 are the system failing
    // to clear its own gate; Josh asking for something different is not one of its three failures.
    attempt: 1,
    previous_body: draft?.body ?? "",
    failures: [`Josh's note on the previous version: ${note.trim()}`],
    near_miss: (sourceJob?.payload as Record<string, unknown> | undefined)?.near_miss ?? null,
  });

  await logEvent(db, "pushback", "info", {
    moment_id: momentId,
    draft_id: draftId,
    note: note.trim().slice(0, 500),
  });

  return true;
}
