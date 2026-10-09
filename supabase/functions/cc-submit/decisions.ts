/**
 * The decisions only Josh can make, behind the one write door.
 *
 * WHY THESE EXIST AT ALL
 *
 * Until now Claude Code could write a post and judge it, and could not approve one. Every decision in
 * this system — approve, hold, push back, clear a name, decide a library proposal, park, reopen, fix
 * the pillar, end an interview, record a verdict — existed only as a Telegram button. Telegram is
 * being removed, so each one needs a door, and this is it.
 *
 * WHY THROUGH cc-submit AND NOT STRAIGHT FROM THE CONNECTOR
 *
 * The `content_mcp` role has select on sixteen tables, insert on three, and **no UPDATE or DELETE
 * anywhere**. Every decision here is an update. The hosted connector currently falls back to the
 * service role when its scoped key is absent, which means a tool writing directly would appear to
 * work and would start failing silently the day that key is minted. So the tools post here, this
 * function holds the admin client, and the boundary stays where it was designed to be.
 *
 * THE RULE EVERY HANDLER FOLLOWS
 *
 * Reuse the function that already implements the decision; never reimplement one. `markReady`,
 * `holdPost`, `pushBack`, `decide`, `park`, `kill`, `setClearance`, `appendToSection`,
 * `recordVerdict`, `recordAnswer`, `recordEditDiff` and `chooseNextQuestion` all existed before this
 * file and are called unchanged. What is new here is argument checking, and saying no clearly.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { holdPost, markReady } from "../_shared/approve.ts";
import { kill, park } from "../_shared/db.ts";
import { setClearance } from "../_shared/names.ts";
import { appendToSection } from "../_shared/library.ts";
import { decide } from "../_shared/proposals.ts";
import { pushBack } from "../_shared/pushback.ts";
import { recordVerdict } from "../_shared/outcome.ts";
import { classifyEdit } from "../_shared/diff.ts";
import { type ConversationAnswer, recordAnswer } from "../_shared/conversation.ts";
import { chooseNextQuestion } from "../_shared/handlers/interview.ts";
import { appendTurn } from "../_shared/session.ts";
import { markNoticesRead, notice } from "../_shared/notices.ts";
import { enqueue, json, nudge } from "../_shared/jobs.ts";
import { logEvent } from "../_shared/db.ts";

/** The loose envelope every route receives. Narrowed per route, as the rest of this function does. */
export type Body = Record<string, unknown>;

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const str = (v: unknown): string => String(v ?? "").trim();

/* ── The calendar: approve, hold, edit ────────────────────────────────────── */

/**
 * 11.2 — the only authorisation to publish in this system.
 *
 * Every guard lives in `markReady`, including the two a button never needed: a tool can be called
 * with any id, so it asks whether the draft actually passed the gate and whether this post was
 * approved already.
 */
export async function approvePost(db: SupabaseClient, body: Body): Promise<Response> {
  const postId = int(body.post_id);
  if (!postId) return json({ error: "post_id is required" }, 400);

  const when = str(body.when);
  if (!when) {
    return json({
      error: 'when is required — "tomorrow", "next monday", "in 3 days" or 2026-10-14',
    }, 400);
  }

  let out;
  try {
    out = await markReady(db, postId, when);
  } catch (e) {
    // parseWhen throws with a sentence a person can act on; it is the answer, not a stack trace.
    return json({ error: (e as Error).message }, 400);
  }

  if (!out.ok) return json({ error: out.why }, 409);

  await logEvent(db, "post_marked_ready", "info", { post_id: postId, when: out.when });

  return json({
    ok: true,
    post_id: postId,
    scheduled_for: out.when,
    next: `Approved and dated ${out.when}. It publishes itself that morning — nothing else to do. ` +
      `Hold it if you change your mind before then.`,
  });
}

/** 11.2 in reverse, plus the richest signal the learning loop gets: why he said no. */
export async function holdPostRoute(db: SupabaseClient, body: Body): Promise<Response> {
  const postId = int(body.post_id);
  if (!postId) return json({ error: "post_id is required" }, 400);

  const held = await holdPost(db, postId);
  if (!held) {
    return json({ error: `Post ${postId} could not be held — it may already be published.` }, 409);
  }

  // 12.4. The desk had a verdict box and collected exactly zero; Telegram's prompt collected them
  // because it asked. Asking is free here, so a reason given is recorded and a reason withheld is
  // not invented.
  const reason = str(body.reason);
  if (reason) await recordVerdict(db, postId, reason);

  await logEvent(db, "post_held", "info", { post_id: postId, had_reason: Boolean(reason) });

  return json({
    ok: true,
    post_id: postId,
    recorded_reason: Boolean(reason),
    next: reason
      ? "Back to draft, and your reason is on the record — that is what the learning loop reads."
      : "Back to draft. If you say in a line what was wrong with it, that goes further than the hold does.",
  });
}

/**
 * 11.4 and 11.5 — he edits the post, and the edit is read back.
 *
 * This has never existed on any surface. The desk's textarea sat behind a login he did not use, and
 * editing a thousand-character post in a chat box was refused on purpose. The measurement half was
 * already built: `recordEditDiff` compares the draft the system wrote against the body he approved,
 * and its `edit_class` IS the clause 17a number. Nothing had ever written the body for it to compare.
 */
export async function editPost(db: SupabaseClient, body: Body): Promise<Response> {
  const postId = int(body.post_id);
  if (!postId) return json({ error: "post_id is required" }, 400);

  const text = str(body.body);
  if (!text) return json({ error: "body is required — the post as you want it to read" }, 400);

  const { data: post } = await db
    .from("posts")
    .select("id, status, marked_ready_at")
    .eq("id", postId)
    .maybeSingle();

  if (!post) return json({ error: `no post with id ${postId}` }, 404);
  if (post.status === "published") {
    return json({ error: "That post has already gone out — editing it here would change the record, not the post." }, 409);
  }
  // An edit to something already authorised is a different act from an edit to a draft. Making him
  // hold it first keeps "approved" meaning "approved this text".
  if (post.marked_ready_at) {
    return json({
      error: "That post is approved and dated. Hold it first, then edit — otherwise the approval " +
        "would be recorded against text you have since changed.",
    }, 409);
  }

  await db.from("posts").update({ body: text, updated_at: new Date().toISOString() }).eq("id", postId);

  /*
   * MEASURED, BUT NOT RECORDED HERE.
   *
   * `EditStage` is "approved" or "published" and deliberately has no "edited": 12.2 measures the
   * distance between what the system wrote and what Josh *approved*, and `markReady` already takes
   * that measurement. An edit recorded as its own outcome row would count the same decision twice,
   * and the approval is the one that matters — he may edit three times before approving once.
   *
   * So the class is computed here for the reply only, off the same function that will do the
   * recording, and the record is written when he approves. If he never approves it, there was no
   * approved body to measure.
   */
  const { data: forDraft } = await db
    .from("posts")
    .select("draft_id, drafts(body)")
    .eq("id", postId)
    .maybeSingle();
  const draftBody = (forDraft?.drafts as { body?: string } | null)?.body ?? "";
  const measured = draftBody ? classifyEdit(draftBody, text) : null;

  await logEvent(db, "post_edited", "info", {
    post_id: postId,
    edit_class: measured?.editClass ?? null,
    edit_ratio: measured?.editRatio ?? null,
  });

  return json({
    ok: true,
    post_id: postId,
    edit_class: measured?.editClass ?? null,
    edit_ratio: measured?.editRatio ?? null,
    next: measured?.editClass === "rewrite"
      ? "Saved. As it stands this counts as a rewrite rather than a light edit, which is worth " +
        "knowing — the acceptance test is five of six needing only light edits. It is recorded " +
        "when you approve it, not now."
      : "Saved. It measures as a light edit against what the system wrote, and that is recorded " +
        "when you approve it.",
  });
}

/* ── Drafts: ask for it again ─────────────────────────────────────────────── */

/**
 * 9.14 / 9d — "this is wrong, write it again, and here is what to fix."
 *
 * `pushBack` is reused unchanged. It resets the attempt counter, because a push-back is not one of
 * the three strikes that park an idea (9.8), carries the previous body and the 7.2 near-miss warning
 * forward, and puts his note first in the failure list — `next_work` already calls that out as the
 * most important line in a rewrite brief.
 */
export async function pushBackRoute(db: SupabaseClient, body: Body): Promise<Response> {
  const note = str(body.note);
  if (!note) {
    return json({
      error: "note is required. A rewrite with no reason produces another guess — say what is wrong.",
    }, 400);
  }

  let draftId = int(body.draft_id);
  let momentId = int(body.moment_id);

  // Either identifier is enough; the other is looked up. He says "the cold email one", and the model
  // has whichever id it happens to be holding.
  if (draftId && !momentId) {
    const { data } = await db.from("drafts").select("moment_id").eq("id", draftId).maybeSingle();
    if (!data) return json({ error: `no draft with id ${draftId}` }, 404);
    momentId = Number(data.moment_id);
  } else if (momentId && !draftId) {
    const { data } = await db
      .from("drafts")
      .select("id")
      .eq("moment_id", momentId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return json({ error: `idea ${momentId} has no draft yet` }, 404);
    draftId = Number(data.id);
  }

  if (!draftId || !momentId) return json({ error: "draft_id or moment_id is required" }, 400);

  const queued = await pushBack(db, momentId, draftId, note);
  if (!queued) return json({ error: "That note was empty by the time it arrived." }, 400);

  nudge();

  return json({
    ok: true,
    draft_id: draftId,
    moment_id: momentId,
    next: "Queued as a rewrite with your note attached. Ask for the next piece of work and it comes " +
      "back — your words are the first thing the rewrite is told.",
  });
}

/* ── Names: 9.10, per post ────────────────────────────────────────────────── */

/**
 * The wall this clears is a real one. `create_draft` refuses a body containing an uncleared name,
 * twice over, so before this tool existed Claude Code could reach a dead stop it had no way out of.
 */
export async function clearNames(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  const names = Array.isArray(body.names)
    ? (body.names as unknown[]).map((n) => str(n)).filter(Boolean)
    : str(body.names) ? [str(body.names)] : [];
  if (body.all === true) names.push("all");

  if (names.length === 0) {
    return json({ error: 'names is required — the names as they appear, or all: true' }, 400);
  }

  const cleared = body.cleared !== false; // clearing is the common case; refusing is explicit
  const changed = await setClearance(db, momentId, names, cleared, str(body.note) || null);

  if (changed.length === 0) {
    return json({
      error: `None of those names are recorded against idea ${momentId}. Read it back with ` +
        `get_moment to see what the interview actually picked up.`,
    }, 404);
  }

  await logEvent(db, cleared ? "names_cleared" : "names_refused", "info", {
    moment_id: momentId,
    names: changed.map((c) => c.name),
  });

  return json({
    ok: true,
    moment_id: momentId,
    cleared,
    names: changed.map((c) => c.name),
    next: cleared
      ? `${changed.map((c) => c.name).join(", ")} may be named in this post. That permission is for ` +
        `this post only — reopening the idea asks again.`
      : `${changed.map((c) => c.name).join(", ")} will not be named. The draft has to work without ` +
        `them, and it will be written around them rather than hinting.`,
  });
}

/* ── The idea bank: park, kill, reopen, pillar ────────────────────────────── */

export async function parkIdea(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  const reason = str(body.reason) || "Parked for now.";
  await park(db, momentId, reason);
  await notice(db, "parked", `Parked: ${reason}`, { momentId, actedOn: ["reopen_idea"] });

  return json({
    ok: true,
    moment_id: momentId,
    next: "Parked, not deleted. It stays in the bank and comes back whenever you reopen it.",
  });
}

/** 6.3's only form of removal: killed and labelled, never deleted. */
export async function killIdea(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  const reason = str(body.reason);
  if (!reason) {
    return json({
      error: "A reason is required. Killing an idea takes it out of everything that selects, scores " +
        "and learns, and an unexplained kill is unreadable in six months.",
    }, 400);
  }

  try {
    await kill(db, momentId, reason);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  await logEvent(db, "idea_killed", "info", { moment_id: momentId, reason });

  return json({
    ok: true,
    moment_id: momentId,
    next: "Marked as one you do not want. Nothing is deleted — the idea, its answers and any drafts " +
      "stay on the record, and it is simply excluded from what gets chosen and what gets learned from.",
  });
}

/**
 * 6.4 — a parked idea comes back, and comes back with a question.
 *
 * Pointing it at `captured` is not enough on its own: without an open question the interview has
 * nothing to continue from. `chooseNextQuestion` is called synchronously rather than queued, for the
 * same reason the capture route does it — the caller is a person waiting for a reply, and a queued
 * job would answer into a void.
 */
export async function reopenIdea(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  const { data: moment } = await db
    .from("moments").select("id, title, status, killed").eq("id", momentId).maybeSingle();
  if (!moment) return json({ error: `no moment with id ${momentId}` }, 404);
  if (moment.killed) {
    return json({ error: "That one was killed rather than parked. Capture it again if it is back." }, 409);
  }

  await db.from("moments").update({
    status: "captured",
    parked_reason: null,
    // A new session on an old moment: 5.3 and 5.8 count from here, not from the first capture.
    reopened_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);

  const step = await chooseNextQuestion(db, momentId);

  return json({
    ok: true,
    moment_id: momentId,
    name: moment.title ?? null,
    question: step.question ?? null,
    progress: step.progress ?? null,
    next: step.question
      ? "Reopened. Answer the question and it carries on where it left off."
      : `Reopened. ${step.note ?? "Nothing more to ask — it can be written as it stands."}`,
  });
}

/** 5.10 — the interview says which pillar it chose so Josh can correct it. This is the correcting. */
export async function setPillar(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  const pillar = str(body.pillar);
  if (!pillar) return json({ error: "pillar is required" }, 400);

  await db.from("moments")
    .update({ pillar, updated_at: new Date().toISOString() })
    .eq("id", momentId);

  return json({
    ok: true,
    moment_id: momentId,
    pillar,
    next: `Filed under ${pillar}. That changes how it is weighed against the others when something ` +
      `is chosen to write next.`,
  });
}

/* ── The interview: skip, or stop ─────────────────────────────────────────── */

/** One question he does not want to answer, without ending the interview. */
export async function skipQuestion(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  // Recorded as an answer, because the interview counts turns and a skip is a turn that happened.
  await appendTurn(db, momentId, {
    role: "answer",
    body: "(skipped that question)",
    question_key: null,
    depth: null,
    is_pushback: false,
  });
  const step = await chooseNextQuestion(db, momentId);

  return json({
    ok: true,
    moment_id: momentId,
    question: step.question ?? null,
    progress: step.progress ?? null,
    next: step.question ? "Skipped. Here is a different one." : "Skipped, and that was the last one.",
  });
}

/**
 * "That is enough, write it up."
 *
 * Written because five interviews once sat open for a month with no way out but silence. Clause 5
 * already treats a scene without a lesson as a real outcome, so stopping early is a legitimate end,
 * not an abandonment.
 */
export async function endInterview(db: SupabaseClient, body: Body): Promise<Response> {
  const momentId = int(body.moment_id);
  if (!momentId) return json({ error: "moment_id is required" }, 400);

  await enqueue(db, "interview_extract", { moment_id: momentId });
  nudge();

  return json({
    ok: true,
    moment_id: momentId,
    next: "Closing it off and turning what you said into material. Ask for the next piece of work in " +
      "a moment and it will be ready to write.",
  });
}

/* ── The library: 12.10 decisions, 8.8 rules, 8.1 transcript ──────────────── */

/**
 * 12.10 — the system proposes, Josh approves. This is the half that was missing from Claude Code, so
 * proposals could be raised and never decided. `worker-learn` runs weekly; they were accumulating.
 */
export async function decideProposal(db: SupabaseClient, body: Body): Promise<Response> {
  const proposalId = int(body.proposal_id);
  if (!proposalId) return json({ error: "proposal_id is required" }, 400);
  if (typeof body.approve !== "boolean") {
    return json({ error: "approve must be true or false" }, 400);
  }

  const out = await decide(db, proposalId, body.approve, str(body.reason) || null);
  if (!out.ok) return json({ error: out.error ?? "that proposal could not be decided" }, 409);

  return json({
    ok: true,
    proposal_id: proposalId,
    section: out.sectionKey,
    section_version: out.version,
    next: body.approve
      ? `Applied to ${out.sectionKey}. The very next draft is written against it, with no deploy — ` +
        `and get_section_history can roll it back if the posts get worse.`
      : `Rejected, with your reason on it. The same evidence will not be proposed again.`,
  });
}

/** 8.8 — a rule into the library in under a minute, which was the point of it. */
export async function addLibraryRule(db: SupabaseClient, body: Body): Promise<Response> {
  const key = str(body.section_key);
  const text = str(body.text);
  if (!key) return json({ error: "section_key is required — get_library lists them" }, 400);
  if (!text) return json({ error: "text is required" }, 400);

  const out = await appendToSection(db, key, text, "rule");
  if (!out.ok) return json({ error: out.why ?? "that section refused the change" }, 409);

  return json({
    ok: true,
    section: key,
    next: `Added to ${key}. The next draft is written against it and the one after judged by it. ` +
      `Nothing was replaced — it is one more line in the section.`,
  });
}

/**
 * 8.1 — the voice interview, which is the source of truth for how he sounds.
 *
 * `/voiceguide` recorded audio and transcribed it. With the voice path gone, a pasted transcript is
 * the route — which 8.1 already invited: "or paste a transcript in directly, if it was recorded
 * elsewhere". The section is deliberately withheld from the gate's view of the library, and that
 * stays: a judge that has read the evidence judges against the evidence.
 */
export async function appendVoiceTranscript(db: SupabaseClient, body: Body): Promise<Response> {
  const text = str(body.text);
  if (!text) return json({ error: "text is required — the transcript, in his own words" }, 400);

  const out = await appendToSection(db, "voice_transcript", text, "block", str(body.source) || undefined);
  if (!out.ok) return json({ error: out.why ?? "the voice interview refused the change" }, 409);

  return json({
    ok: true,
    words: out.words,
    next: `${out.words} words into the voice interview. It appends, so keep going whenever you like — ` +
      `and this is what wins if the voice guide and the transcript ever disagree.`,
  });
}

/* ── What came back: 12.4 verdicts, 12.5 conversations ────────────────────── */

export async function recordPostVerdict(db: SupabaseClient, body: Body): Promise<Response> {
  const postId = int(body.post_id);
  if (!postId) return json({ error: "post_id is required" }, 400);

  const verdict = str(body.verdict);
  if (!verdict) return json({ error: "verdict is required — one line is plenty" }, 400);

  const recorded = await recordVerdict(db, postId, verdict, int(body.draft_id));
  if (!recorded) return json({ error: `could not record a verdict against post ${postId}` }, 404);

  return json({
    ok: true,
    post_id: postId,
    next: "On the record. Your words about a post that went out are worth more to the library than " +
      "any number the API returns.",
  });
}

/** 12.5 / 12.6 — did the post start a conversation, and what kind. */
export async function recordConversationRoute(db: SupabaseClient, body: Body): Promise<Response> {
  const postId = int(body.post_id);
  if (!postId) return json({ error: "post_id is required" }, 400);

  const allowed: ConversationAnswer[] = ["none", "comment_thread", "dm", "call", "client"];
  const answer = str(body.answer) as ConversationAnswer;
  if (!allowed.includes(answer)) {
    return json({ error: `answer must be one of: ${allowed.join(", ")}` }, 400);
  }

  await recordAnswer(db, postId, answer);

  return json({
    ok: true,
    post_id: postId,
    answer,
    next: answer === "none"
      ? "Recorded. A post that started nothing is as useful to measure as one that did."
      : "Recorded — that is the outcome the whole system is pointed at.",
  });
}

/* ── Notices ──────────────────────────────────────────────────────────────── */

export async function noticesRead(db: SupabaseClient, body: Body): Promise<Response> {
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map((n) => Number(n)) : [];
  if (ids.length === 0) return json({ error: "ids is required" }, 400);

  const marked = await markNoticesRead(db, ids);
  return json({ ok: true, marked, next: "Those will not be offered again." });
}
