/**
 * What the system would have told Josh, written down instead of sent.
 *
 * This is the drop-in replacement for `sendMessage(joshChatId(), …)`. Every worker that used to push
 * a message calls `notice()` instead, with the same text it used to send — so the substitution is
 * mechanical rather than a rewrite, and the words that were already tested on a real person survive.
 *
 * TWO PROPERTIES WORTH KEEPING
 *
 * It never throws into the caller. `worker-ops` and `worker-select` both wrapped their sends so that a
 * failed message could not undo the work that produced it; a notice is strictly less important than
 * the job it describes, and the same rule applies.
 *
 * `acted_on` carries the tools worth calling. The old messages had buttons under them — reopen this,
 * skip that, park it — and the buttons were what made them useful. A notice with no next step is a
 * line of text; one that names the tool is the same affordance in a different shape.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface NoticeExtra {
  severity?: "info" | "warn" | "error";
  momentId?: number | null;
  postId?: number | null;
  /** Tool names worth calling about this. What the buttons used to be. */
  actedOn?: string[];
}

export async function notice(
  db: SupabaseClient,
  kind: string,
  body: string,
  extra: NoticeExtra = {},
): Promise<boolean> {
  const text = (body ?? "").trim();
  // An empty notice is worse than none: it occupies the unread list and tells him nothing.
  if (!text) return false;

  const { error } = await db.from("notices").insert({
    kind,
    severity: extra.severity ?? "info",
    body: text,
    moment_id: extra.momentId ?? null,
    post_id: extra.postId ?? null,
    acted_on: extra.actedOn ?? [],
  });

  if (error) {
    // Logged, not thrown. See the note above.
    console.error(`notice(${kind}) failed: ${error.message}`);
    return false;
  }
  return true;
}

/** What he has not seen yet, newest first. The answer to "what's waiting?". */
export async function unreadNotices(
  db: SupabaseClient,
  limit = 20,
): Promise<
  {
    id: number;
    kind: string;
    severity: string;
    body: string;
    moment_id: number | null;
    post_id: number | null;
    acted_on: string[];
    created_at: string;
  }[]
> {
  const { data } = await db
    .from("notices")
    .select("id, kind, severity, body, moment_id, post_id, acted_on, created_at")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

/**
 * Mark notices seen.
 *
 * Without this the same digest is offered forever, which is the failure `sendDraftDigest` was written
 * to avoid — it kept a time bucket so two drafts arriving minutes apart produced one message. The
 * discipline moves to the reader's side here: nothing is marked read by being returned, because a tool
 * result that silently consumes the thing it reports cannot be called twice safely.
 */
export async function markNoticesRead(db: SupabaseClient, ids: number[]): Promise<number> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (clean.length === 0) return 0;

  const { data, error } = await db
    .from("notices")
    .update({ read_at: new Date().toISOString() })
    .in("id", clean)
    .is("read_at", null)
    .select("id");

  if (error) throw new Error(`could not mark notices read: ${error.message}`);
  return (data ?? []).length;
}
