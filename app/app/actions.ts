"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { classifyEdit } from "@/lib/diff";

/**
 * 11.4 — Josh edits the post here, in the calendar itself, without going back into the system.
 * 11.5 — those edits are read back into the idea bank automatically, because this IS the idea bank.
 * 11.2 — marking ready is the ONLY thing that authorises publishing, and the database enforces it:
 *        `posts` will not accept status 'scheduled' without both marked_ready_at and scheduled_for.
 */
export async function markReady(formData: FormData) {
  const db = await supabaseServer();
  const postId = Number(formData.get("post_id"));
  const body = String(formData.get("body") ?? "").trim();
  const date = String(formData.get("scheduled_for") ?? "");

  if (!body || !date) return;

  // Local date + time from the form, stored as an instant.
  const when = new Date(`${date}T${formData.get("time") || "09:00"}`);

  await db.from("posts").update({
    body,
    status: "scheduled",
    marked_ready_at: new Date().toISOString(),
    scheduled_for: when.toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", postId);

  // 12.2 — measured HERE, not at publish.
  //
  // This is the moment the edit exists: `body` is what Josh approved, and the draft is what the
  // system wrote. It used to be taken only inside the successful LinkedIn publish loop, so with
  // LinkedIn unconnected the signal 12.3 requires to stand on its own captured nothing at all.
  await recordEditDiff(db, postId, "approved");

  revalidatePath("/");
  revalidatePath("/calendar");
}

/**
 * 12.2 — the app's half of the edit measurement.
 *
 * The Telegram half is `recordEditDiff` in `supabase/functions/_shared/outcome.ts`; this writes the
 * same columns the same way. A sweep in `worker-select` measures anything either writer misses,
 * because the failure here is invisible — an approved post with no measurement looks exactly like a
 * post that was never approved.
 */
async function recordEditDiff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  postId: number,
  stage: "approved" | "published",
) {
  const { data: post } = await db
    .from("posts").select("moment_id, draft_id, body").eq("id", postId).maybeSingle();
  if (!post?.draft_id) return;

  const { data: draft } = await db
    .from("drafts").select("body").eq("id", post.draft_id).maybeSingle();
  if (!draft?.body) return;

  const diff = classifyEdit(draft.body, post.body);
  const now = new Date().toISOString();

  await db.from("outcomes").upsert({
    post_id: postId,
    moment_id: post.moment_id,
    draft_body: draft.body,
    approved_body: post.body,
    edit_diff: diff,
    edit_ratio: diff.editRatio,
    edit_class: diff.editClass,
    edit_stage: stage,
    edit_measured_at: now,
    updated_at: now,
  });
}

/** Save an edit without committing to a date. Nothing is scheduled and nothing publishes. */
export async function saveDraft(formData: FormData) {
  const db = await supabaseServer();
  const postId = Number(formData.get("post_id"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  await db.from("posts").update({ body, updated_at: new Date().toISOString() }).eq("id", postId);
  revalidatePath("/");
}

/** Take a scheduled post back out of the calendar. Never deletes it (6.3). */
export async function unschedule(formData: FormData) {
  const db = await supabaseServer();
  const postId = Number(formData.get("post_id"));
  await db.from("posts").update({
    status: "draft",
    scheduled_for: null,
    marked_ready_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", postId);
  revalidatePath("/");
  revalidatePath("/calendar");
}

/**
 * 12.4 — a one-line verdict, in a couple of seconds. "If it takes longer he will not do it."
 */
export async function leaveVerdict(formData: FormData) {
  const db = await supabaseServer();
  const postId = Number(formData.get("post_id"));
  const verdict = String(formData.get("verdict") ?? "").trim();
  if (!verdict) return;

  const { data: post } = await db
    .from("posts").select("moment_id, draft_id").eq("id", postId).single();
  if (!post) return;

  await db.from("outcomes").upsert({
    post_id: postId,
    moment_id: post.moment_id,
    verdict: verdict.slice(0, 500),
    verdict_at: new Date().toISOString(),
    // Which draft version he is judging. A moment produces several — a push-back revision is a new
    // one — and "the hook was wrong" against a moment says nothing about which attempt was wrong.
    verdict_draft_id: post.draft_id ?? null,
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/");
}

/**
 * 12.5 / 12.6 — the one question, asked inside the weekly pass and nowhere else (12.7).
 * Skipping is a first-class answer: 12.8 forbids stalling, nagging or degrading if he never answers.
 */
export async function recordConversation(formData: FormData) {
  const db = await supabaseServer();
  const postId = Number(formData.get("post_id"));
  const conversation = String(formData.get("conversation") ?? "none");
  const who = String(formData.get("who") ?? "").trim();

  const { data: post } = await db.from("posts").select("moment_id").eq("id", postId).single();
  if (!post) return;

  await db.from("outcomes").upsert({
    post_id: postId,
    moment_id: post.moment_id,
    conversation,
    conversation_who: who || null,
    conversation_answered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/");
}

/**
 * 12.8 — a skip that actually silences it.
 *
 * The old version wrote `conversation_asked_at` and nothing read it, so the same posts came back on
 * every pass for three weeks. A button that looks like it worked is worse than no button: he stops
 * trusting the controls.
 *
 * Now it counts. Two asks and the question drops away whether or not he answered — one ask is early
 * for a DM that arrives a fortnight later, three is nagging. And the count is shared with Telegram,
 * so a skip here is honoured there.
 */
export async function skipConversationQuestion(formData: FormData) {
  const db = await supabaseServer();
  const ids = String(formData.get("post_ids") ?? "").split(",").filter(Boolean).map(Number);
  await markAsked(db, ids);
  revalidatePath("/");
}

/**
 * Record that these were put in front of him.
 *
 * Called when the question is DISPLAYED, not only when it is skipped: from Josh's side, being asked
 * and closing the tab is the same event as being asked and pressing skip. Making the two identical
 * is what stops a post he has quietly ignored from following him around for three weeks.
 */
export async function markAsked(
  // deno-lint-ignore no-explicit-any
  db: any,
  postIds: number[],
) {
  const now = new Date().toISOString();
  for (const id of postIds) {
    const { data: row } = await db
      .from("posts")
      .select("moment_id, outcomes(conversation_ask_count)")
      .eq("id", id)
      .maybeSingle();
    if (!row) continue;

    const raw = row.outcomes;
    const o = Array.isArray(raw) ? raw[0] : raw;
    await db.from("outcomes").upsert({
      post_id: id,
      moment_id: row.moment_id,
      conversation_asked_at: now,
      conversation_ask_count: (o?.conversation_ask_count ?? 0) + 1,
      updated_at: now,
    });
  }
}

/**
 * 8.5 / 8.6 — Josh edits the library with no build or deploy step, and the change applies to the
 * very next draft. The version bump, the history row and the snapshot are handled by triggers.
 */
export async function saveLibrarySection(formData: FormData) {
  const db = await supabaseServer();
  const key = String(formData.get("key"));
  const body = String(formData.get("body") ?? "");

  const { data: updated } = await db
    .from("library_sections")
    .update({ body })
    .eq("key", key)
    .eq("immutable", false)
    .select("key, version");

  // 12.11 — "recorded with the date and the reason."
  //
  // The history trigger writes (key, version, body) and leaves `reason` null, because a trigger has
  // no way to know why. Nothing ever filled it in, so the rollback list read "v5 v4 v3" with no
  // indication which version came from a proposal and which Josh typed himself — which is 12.12's
  // "Josh can see WHICH change" half missing, even though the undo worked.
  if (updated?.[0]) await noteReason(db, key, updated[0].version, "edited by Josh");

  revalidatePath("/library");
}

/** 12.11 — fill in the reason the history trigger cannot know. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function noteReason(db: any, key: string, version: number, reason: string) {
  await db.from("library_section_versions")
    .update({ reason })
    .eq("key", key)
    .eq("version", version);
}

/**
 * 12.10 — Josh approves or rejects each proposal. The system never changes the library on its own.
 * 12.11 — an approved change takes effect on the next draft and increments the library version.
 */
export async function decideProposal(formData: FormData) {
  const db = await supabaseServer();
  const id = Number(formData.get("proposal_id"));
  const approve = String(formData.get("decision")) === "approve";
  const reason = String(formData.get("reason") ?? "").trim();

  const { data: proposal } = await db
    .from("library_proposals")
    .select("section_key, proposed_body, status")
    .eq("id", id)
    .maybeSingle();
  if (!proposal || proposal.status !== "open") return;

  let version: number | null = null;
  let sectionVersion: number | null = null;

  if (approve) {
    // `.select()` so the result says whether a row actually changed.
    //
    // The old version updated with `.eq("immutable", false)` and marked the proposal approved
    // regardless. A proposal against the core rules matches no rows, so it would have been recorded
    // as ACCEPTED while changing nothing — a lie in the audit trail about the one thing in the
    // system that must never move. A write that affects nothing is not a change.
    const { data: updated } = await db
      .from("library_sections")
      .update({ body: proposal.proposed_body })
      .eq("key", proposal.section_key)
      .eq("immutable", false)
      .select("key, version");

    if (!updated || updated.length === 0) {
      revalidatePath("/proposals");
      return;
    }

    // Read after the update: the trigger has rolled the version forward, and 12.11 wants the version
    // the change actually took effect in.
    const { data: v } = await db
      .from("library_versions")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = v?.version ?? null;
    sectionVersion = updated[0].version ?? null;

    // 12.11 — the date and the reason, on the version itself.
    if (sectionVersion) {
      await noteReason(
        db,
        proposal.section_key,
        sectionVersion,
        `proposal #${id} approved${reason ? `: ${reason}` : ""}`,
      );
    }
  }

  await db.from("library_proposals").update({
    status: approve ? "approved" : "rejected",
    decided_at: new Date().toISOString(),
    decided_reason: reason || null,
    applied_library_version: version,
    // 12.12 — `applied_library_version` is the SNAPSHOT counter and this is the SECTION counter.
    // Without both, a rollback of section v5 has no way to find the proposal that produced it, and
    // an approved change Josh then reverted goes on reading "approved" for ever.
    applied_section_version: sectionVersion,
  }).eq("id", id);

  revalidatePath("/proposals");
  revalidatePath("/library");
  revalidatePath("/");
}

/**
 * 12.12 — a change must be reversible. Restores a section to an earlier version, which itself
 * becomes a new version, so the history stays append-only and nothing is lost.
 */
export async function revertSection(formData: FormData) {
  const db = await supabaseServer();
  const key = String(formData.get("key"));
  const version = Number(formData.get("version"));

  const { data: old } = await db
    .from("library_section_versions")
    .select("body")
    .eq("key", key)
    .eq("version", version)
    .single();
  if (!old) return;

  const { data: updated } = await db
    .from("library_sections")
    .update({ body: old.body })
    .eq("key", key)
    .eq("immutable", false)
    .select("key, version");

  if (!updated?.[0]) return;

  await noteReason(db, key, updated[0].version, `rolled back to v${version}`);

  // 12.12 — "If posts get worse after a change, Josh can see which change and undo it."
  //
  // The undo worked and the record of it did not. `proposal_status` has always had a 'reverted'
  // value and NOTHING anywhere set it, so a proposal Josh approved and then rolled back still read
  // "approved" for ever. Two consequences, both bad: the trail said the change was in force when it
  // was not, and the learning loop had no way to know its change had been tried and undone — so it
  // was free to propose the same thing again the following Monday.
  const { data: reverted } = await db
    .from("library_proposals")
    .update({ status: "reverted" })
    .eq("section_key", key)
    .eq("status", "approved")
    .gte("applied_section_version", version)
    .select("id");

  if (reverted?.length) {
    await db.from("system_events").insert({
      kind: "proposal_reverted",
      severity: "info",
      detail: { section_key: key, back_to_version: version, proposal_ids: reverted.map((r: { id: number }) => r.id) },
    });
  }

  revalidatePath("/library");
  revalidatePath("/proposals");
}

/** 7.4 — pin a moment to the front, kill one, or say "not this month". */
export async function overrideMoment(formData: FormData) {
  const db = await supabaseServer();
  const id = Number(formData.get("moment_id"));
  const action = String(formData.get("action"));

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (action === "pin") patch.pinned = true;
  if (action === "unpin") patch.pinned = false;
  if (action === "kill") patch.killed = true;
  if (action === "not_this_month") {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    patch.not_before = d.toISOString().slice(0, 10);
  }

  await db.from("moments").update(patch).eq("id", id);
  revalidatePath("/bank");
}

/** 9.10 — clearance is granted per post, so it is granted here, deliberately, one name at a time. */
export async function setNameClearance(formData: FormData) {
  const db = await supabaseServer();
  const id = Number(formData.get("name_id"));
  const cleared = String(formData.get("cleared")) === "true";

  await db.from("moment_names").update({
    cleared,
    cleared_at: cleared ? new Date().toISOString() : null,
  }).eq("id", id);
  revalidatePath("/bank");
}

/**
 * 6.1 — "readable and editable by Josh directly, without a developer and without going through the
 * chat interface."
 *
 * The bank page used to offer only pin / kill / not-this-month, which is deciding about a moment
 * rather than editing it. The fields here are the ones that change what gets written: `material` is
 * the ONLY thing the drafter ever reads, so a mangled quote in `their_actual_words` was inherited by
 * every future draft with no way back short of raw SQL. Pillar, audience and notes follow because
 * they steer selection and framing.
 *
 * Nothing here is destructive in 6.3's sense: it edits the moment in place, and the version history
 * on `moments` keeps what it was.
 */
export async function editMoment(formData: FormData) {
  const db = await supabaseServer();
  const id = Number(formData.get("moment_id"));
  if (!Number.isInteger(id)) return;

  // Empty means "no value", not an empty string — the drafter tests for null.
  const field = (name: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return v.length > 0 ? v : null;
  };

  // 6.1 — `decays_at` is the one field the model sets that can REMOVE Josh's material without him
  // doing anything: `expireDecayedMoments` parks any mined moment once the date passes. It was shown
  // nowhere and editable nowhere, so a wrong guess quietly took a moment out of the queue with a
  // reason that may have been false.
  //
  // The two are written together and kept consistent: a moment with no date is not time-sensitive,
  // and one with a date is. Letting them disagree would leave a flag that does nothing or a date
  // that fires on a moment nobody marked as decaying.
  const decaysAt = field("decays_at");

  await db.from("moments").update({
    pillar: field("pillar"),
    audience: field("audience"),
    notes: field("notes"),
    decays_at: decaysAt,
    time_sensitive: decaysAt !== null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  // Upserted, because a moment that was never mined has no material row yet — and correcting one
  // by hand is a reasonable way to rescue a moment the interview could not open up.
  await db.from("material").upsert({
    moment_id: id,
    the_moment: field("the_moment"),
    the_detail: field("the_detail"),
    the_realisation: field("the_realisation"),
    the_lesson: field("the_lesson"),
    their_actual_words: field("their_actual_words"),
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/bank");
}

/**
 * 6.4 — "A moment must be re-openable. Josh adds to an old entry and it goes back into the queue."
 *
 * The same mechanism as the "Add to this one" button on a park message in Telegram, for the times
 * he is looking at the bank rather than his phone. Sending the moment back to `captured` puts it in
 * front of the interviewer again; the parked reason goes because it no longer describes the moment.
 */
export async function reopenMoment(formData: FormData) {
  const db = await supabaseServer();
  const id = Number(formData.get("moment_id"));
  if (!Number.isInteger(id)) return;

  await db.from("moments").update({
    status: "captured",
    parked_reason: null,
    // A new session on an old moment: the budgets in 5.3 and 5.8 count from here, so a moment
    // parked after eight questions does not come back with nothing left to spend.
    reopened_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  await db.from("jobs").insert({
    type: "interview_step",
    payload: { moment_id: id },
    run_after: new Date().toISOString(),
  });

  revalidatePath("/bank");
}
