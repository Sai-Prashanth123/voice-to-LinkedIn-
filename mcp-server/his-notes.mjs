/**
 * Everything Josh has said about one post, for whichever brief is about to be written.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The read below was written inline in `get_drafting_brief` on 2 November, to fix the fault of 27
 * October: `pushBack` files his note in a `draft` job's payload, `create_draft` closes the job it
 * answers, and the brief read that job filtered to `status = pending` — so his note survived
 * exactly one draft and then vanished for good. On moment 113 that played out in ninety minutes and
 * four drafts, with `hook_opens_loop` and `banned_phrases` failing on every one. It looked like a
 * writer that would not learn. It was a brief that forgot.
 *
 * `get_rewrite_brief` needed the same rows, and a rewrite is the one place his instruction matters
 * most — 9.8 exists because the commonest way a second attempt fails is throwing away what worked.
 * Copying twelve lines across would have been the shape `notes.ts` was written to stop: reword one
 * copy and the other silently drifts, with nothing going red. So it is spelled once, here, and both
 * briefs call it.
 *
 * `his-notes.test.mjs` covers the drafting side against the real moment 113, so a regression in
 * this function fails there rather than in a fixture.
 */

import { joshNote } from "../supabase/functions/_shared/notes.ts";

/** How many draft jobs back to look. Twelve covers a long afternoon of attempts. */
const JOBS_READ = 12;

/**
 * His notes on a moment, newest first and deduplicated.
 *
 * Read across EVERY draft job for the moment, not just one still waiting: his note does not stop
 * being his note when the job closes. Kept separate from the gate's reasons by the caller, because
 * one is an instruction and the other is a verdict, and filing the first under "it failed on"
 * mislabels what he said.
 *
 * @returns an array of his words, possibly empty. Empty means he has not said anything about this
 *          post — which is a different fact from "he approved of it", and no caller should report
 *          it as the second.
 */
export async function hisNotesFor(db, momentId) {
  const noteJobs = await db.select("jobs", {
    select: "payload",
    type: "eq.draft",
    "payload->>moment_id": `eq.${momentId}`,
    order: "id.desc",
    limit: String(JOBS_READ),
  });

  return [...new Set(
    noteJobs
      .flatMap((j) => (Array.isArray(j?.payload?.failures) ? j.payload.failures : []))
      .map((f) => joshNote(f))
      .filter(Boolean),
  )];
}
