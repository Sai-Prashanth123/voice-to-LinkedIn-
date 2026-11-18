/**
 * MORE WORDS ON AN IDEA THAT ALREADY EXISTS.
 *
 * Added 18 November 2026, because there was no way to do it. `raw_inputs` was INSERTed in exactly
 * one place in this repository — two lines below a `moments` INSERT, inside `capture`, unreachable
 * except by creating a fresh idea. So when Josh said "actually, make it about X", and he says it
 * constantly ("Actually, I want to do a post about" appears seven times on 10 November alone), the
 * only door was `start_post` again, and a second idea was born.
 *
 * MEASURED, 4-18 November 2026: 36 raw inputs became 36 moments holding about 10 real ideas.
 * Moments 143 to 149 are one post — seven ideas in 74 minutes, the last of them titled "final".
 * Clause 6.3 means every one of the surplus 26 is permanent.
 *
 * THE DETECTION WAS NEVER THE PROBLEM and must not be credited as one. `resemblesEarlier` fired 24
 * times over that fortnight and named the right earlier idea every time — moment 149 matched 148 on
 * a 190-word shared passage, 147 matched 146 on 195 words. Nothing came of any of it, because a
 * session told "this is 190 words of moment 148" had nowhere to go. This is the somewhere.
 *
 * It lives here rather than in cc-submit because cc-submit calls `Deno.serve` at the top level and
 * therefore exports nothing and can be imported by no test. A new write route that nothing executes
 * is the defect this change exists to fix, so it goes where `material.test.ts` can run it.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logEvent } from "../db.ts";

export interface AppendResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Add his new words to an idea as more material. Returns the status and body for the caller to
 * serialise; it never throws for an expected refusal, because every refusal here has something
 * useful to say about what to do instead.
 */
export async function appendMaterial(
  db: SupabaseClient,
  momentId: number,
  rawText: string,
): Promise<AppendResult> {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return { status: 400, body: { error: "text is required — his words, as he said them" } };
  }
  if (!Number.isInteger(momentId) || momentId <= 0) {
    return {
      status: 400,
      body: { error: "moment_id must be the id of an idea that already exists" },
    };
  }

  const { data: moment, error } = await db
    .from("moments")
    .select("id, ref, status, killed, title")
    .eq("id", momentId)
    .maybeSingle();
  if (error) return { status: 500, body: { error: `could not read that idea: ${error.message}` } };
  if (!moment) return { status: 404, body: { error: `there is no idea ${momentId}` } };

  // The same refusal reopen_idea gives, in the same words, because it is the same situation.
  if (moment.killed) {
    return {
      status: 409,
      body: {
        error: "That one was killed rather than parked. Capture it again if it is back.",
        moment_id: momentId,
      },
    };
  }
  /*
   * A published post's material is the record of what was true when it went out, and the retelling
   * index is built from it. Appending here would rewrite the basis of something already public.
   */
  if (moment.status === "published") {
    return {
      status: 409,
      body: {
        error: "That idea is already published, so its material is the record of what went out. " +
          "Capture the new angle as its own idea.",
        moment_id: momentId,
      },
    };
  }
  /*
   * Parking is a decision somebody recorded, with a reason, and `reopen_idea` is its inverse.
   * Reviving an idea as a side effect of adding to it would take that decision quietly — which is
   * the thing clause 12.10 is about one level up.
   */
  if (moment.status === "parked") {
    return {
      status: 409,
      body: {
        error: `That idea is parked: "${moment.title ?? momentId}". Call reopen_idea first, then ` +
          `add to it — parking is a decision somebody recorded and this must not undo it.`,
        moment_id: momentId,
        next: "reopen_idea, then continue_post again.",
      },
    };
  }

  const { error: insertError } = await db.from("raw_inputs").insert({
    moment_id: momentId,
    kind: "text",
    text_body: text,
  });
  if (insertError) {
    return { status: 500, body: { error: `could not add to that idea: ${insertError.message}` } };
  }

  /*
   * How many of his messages this idea now holds. Reported because "it was added" and "this is the
   * fourth thing he has said about this" are different facts and only the second is worth hearing —
   * and because a count that comes back null says the read failed, not that there is nothing there.
   */
  const { count } = await db
    .from("raw_inputs")
    .select("id", { count: "exact", head: true })
    .eq("moment_id", momentId);

  await logEvent(db, "moment_material_appended", "info", {
    moment_id: momentId,
    ref: moment.ref,
    status: moment.status,
    chars: text.length,
    inputs_now: count ?? null,
    means: "His new words were added to an idea that already existed, rather than becoming a " +
      "second idea. Before 18 November there was no way to do this.",
  });

  return {
    status: 200,
    body: {
      ok: true,
      appended: true,
      moment_id: momentId,
      name: moment.title,
      status: moment.status,
      inputs_now: count ?? null,
      /*
       * `redo: true` is the whole point of saying this here. submit_extraction refuses a moment
       * that has already been written up unless it is passed, and the one-step path never passed
       * it — which is the second half of why one idea became seven.
       */
      next: moment.status === "captured"
        ? "Fill all eighteen fields from everything he has now said about this — the earlier " +
          "material and these new words together — then call write_post."
        : "Re-read the material and call write_post with redo: true and the fields filled from " +
          "everything he has now said, earlier words included. Do not call start_post: that " +
          "would make a second idea out of one, which is the defect this route exists to end.",
      tell_him: "Say in one line that it went onto the same idea rather than starting a new one.",
    },
  };
}
