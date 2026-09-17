/**
 * Where Claude Code posts finished thinking.
 *
 * WHY AN ENDPOINT RATHER THAN A WIDER GRANT
 *
 * Moving a job off the free tier means moving the MODEL CALL, not the write authority. The obvious
 * shortcut was to grant `content_mcp` insert on `material`, `moment_names`, `moments` and
 * `raw_inputs` and let the MCP tools write directly. That would have dissolved the one property
 * that makes handing these tools to a model safe: the role can write four tables, none of them the
 * idea bank, and it holds no UPDATE anywhere. A confused model gets a permission error rather than
 * a corrupted bank.
 *
 * So the model produces a result and posts it here. This function validates it and writes with its
 * own admin client. Same pattern `scan_sessions` already uses with worker-triage, and the same
 * reason: the boundary is worth more than the convenience.
 *
 * WHAT VALIDATION ACTUALLY BUYS
 *
 * Not politeness. Every claim in a draft is verified against the idea bank entry, span by span,
 * with zero tolerance — and until now the entry itself was written by a model that was asked nicely
 * not to invent things and never checked. The most rigorous part of this system rested on the least
 * checked part of it.
 *
 * verifyExtraction closes that, on the three rules EXTRACT_SYSTEM states as absolutes and which are
 * genuinely checkable: the quote is verbatim, no number was added, nobody was named who was not
 * named. The prose fields legitimately summarise and are NOT checked — see extraction.ts, which
 * says so out loud rather than letting a pass imply more than it proved.
 *
 * verify_jwt stays ON. This writes to the idea bank, so a caller must at minimum hold a project
 * key; there is no reason for this door to be more open than worker-triage's.
 */

import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import {
  applyExtraction,
  chooseNextQuestion,
  seedText,
} from "../_shared/handlers/interview.ts";
import { appendTurn, loadSession, renderTranscript } from "../_shared/session.ts";
import { verifyExtraction } from "../_shared/extraction.ts";
import { applyDraft } from "../_shared/handlers/draft.ts";
import type { Claim } from "../_shared/claims.ts";
import type { Extraction } from "../_shared/schemas.ts";
import { applyCandidates, type Candidate, candidateRoom } from "../_shared/triage.ts";
import type { MomentSource } from "../_shared/types.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** The three sources 4.3 and 4.4 define. A caller may not invent a fourth. */
const ALLOWED_SOURCES = new Set(["claude_code", "call_transcript", "slack"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = admin();
  await loadSecrets(db);

  // One envelope, two kinds. Typed loosely here and narrowed per route, because the alternative
  // is a discriminated union whose only job is to satisfy a check the routes already do.
  let body: {
    kind?: string;
    text?: string;
    answer?: string;
    moment_id?: number;
    extracted?: Extraction;
    source?: string;
    source_ref?: string;
    candidates?: Candidate[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }

  if (body.kind === "candidates") return await submitCandidates(db, body);
  if (body.kind === "capture") return await capture(db, body);
  if (body.kind === "draft") return await fileDraft(db, body as unknown as DraftBody);
  if (body.kind === "interview_next") return await interviewNext(db, body);
  if (body.kind === "interview_answer") return await interviewAnswer(db, body);

  if (body.kind !== "extraction") {
    return json({
      error: `unknown kind "${body.kind ?? ""}". Expected "extraction", "candidates", ` +
        `"capture", "draft", "interview_next" or "interview_answer".`,
    }, 400);
  }

  const momentId = Number(body.moment_id);
  if (!Number.isInteger(momentId)) return json({ error: "moment_id must be an integer" }, 400);
  if (!body.extracted || typeof body.extracted !== "object") {
    return json({ error: "extracted is required" }, 400);
  }

  const { data: moment } = await db
    .from("moments").select("id, ref, status, killed").eq("id", momentId).maybeSingle();

  if (!moment) return json({ error: `no moment with id ${momentId}` }, 404);

  // 6.3 — a killed moment is one Josh has already declined.
  if (moment.killed) return json({ error: `moment ${momentId} has been killed`, ref: moment.ref }, 409);

  // A moment already mined must not be silently overwritten by a second submission. Re-extraction
  // is a real operation, but it is one somebody should ask for rather than one that happens because
  // two runs overlapped.
  if (moment.status === "mined") {
    return json({ error: `moment ${momentId} is already mined`, ref: moment.ref }, 409);
  }

  // THE SOURCE IS REBUILT HERE, NOT ACCEPTED FROM THE CALLER.
  //
  // Taking the transcript from the request would make the check circular: a caller that invented a
  // quote could invent a transcript containing it. What the model was shown is read from the
  // database, which is the only copy that cannot be argued with.
  const session = await loadSession(db, momentId);
  const seed = await seedText(db, momentId);
  const source = `${seed}\n\n${renderTranscript(session)}`;

  const verdict = verifyExtraction(body.extracted, source);

  if (!verdict.ok) {
    await logEvent(db, "extraction_refused", "warn", {
      moment_id: momentId,
      ref: moment.ref,
      failures: verdict.failures,
    });
    return json({
      ok: false,
      moment_ref: moment.ref,
      failures: verdict.failures,
      checked: verdict.checked,
      next: "Fix the extraction against what Josh actually said, or leave the field empty. " +
        "Leaving a field empty is always allowed and is the correct answer when he did not say it.",
    }, 422);
  }

  await applyExtraction(db, momentId, body.extracted);

  await logEvent(db, "extraction_applied", "info", {
    moment_id: momentId,
    ref: moment.ref,
    source: "claude_code",
  });

  const { data: after } = await db
    .from("moments").select("status, strength, pillar").eq("id", momentId).maybeSingle();

  return json({
    ok: true,
    moment_ref: moment.ref,
    status: after?.status ?? null,
    strength: after?.strength ?? null,
    pillar: after?.pillar ?? null,
    verified: verdict.checked,
    not_verified: verdict.not_checked,
    // Parking is a correct outcome and the caller should not read it as a failure.
    note: after?.status === "parked"
      ? "Applied, and the moment parked itself: there is a scene here but nothing taken from it. " +
        "Josh has been told, and it reopens the moment he adds to it."
      : "Applied. The moment is mined and can now be selected for drafting.",
  });
});

/**
 * Candidates triaged by Claude Code (4.3, 4.4).
 *
 * The model call moved; the two things that protect Josh did not. The daily cap and the strength
 * bar are applied HERE, from _shared/triage.ts, the same code worker-triage runs — because 4.4.3 is
 * explicit that a version surfacing ten candidates a day is worse than no version at all, and a
 * caller that could set its own cap would be no cap.
 *
 * A caller cannot raise the cap by asking, cannot lower the strength bar, and cannot write a moment
 * as anything other than half_mined. It supplies judgement about what is interesting. It supplies
 * nothing about how much of Josh's attention that is worth.
 */
async function submitCandidates(db: SupabaseClient, body: {
  source?: string;
  source_ref?: string;
  candidates?: Candidate[];
}): Promise<Response> {
  const source = String(body.source ?? "claude_code") as MomentSource;
  const sourceRef = String(body.source_ref ?? "").trim();

  if (!ALLOWED_SOURCES.has(source)) {
    return json({ error: `source must be one of ${[...ALLOWED_SOURCES].join(", ")}` }, 400);
  }
  if (!sourceRef) return json({ error: "source_ref is required" }, 400);
  if (!Array.isArray(body.candidates)) return json({ error: "candidates must be an array" }, 400);

  // Already triaged. worker-triage's ingest checks the same pair before queueing, and without it
  // here a re-run would surface every candidate a second time — which is the burying-Josh failure
  // arriving by the one route that skips the queue.
  const { data: existing } = await db
    .from("moments").select("id").eq("source", source).eq("source_ref", sourceRef).maybeSingle();

  if (existing) {
    return json({
      ok: true,
      surfaced: 0,
      reason: `${sourceRef} has already been triaged, so nothing was added.`,
    });
  }

  const dailyCap = await getSetting(db, "cc_candidates_per_day", 3);
  const room = await candidateRoom(db, dailyCap);

  if (room <= 0) {
    // Not an error. The cap doing its job is the system working.
    return json({
      ok: true,
      surfaced: 0,
      reason: `The daily cap of ${dailyCap} is already reached. Nothing was surfaced, and that ` +
        `is the cap working rather than a failure. Try again tomorrow.`,
    });
  }

  const surfaced = await applyCandidates(db, { source, source_ref: sourceRef }, body.candidates, room);

  await logEvent(db, "candidates_submitted", "info", {
    source,
    source_ref: sourceRef,
    offered: body.candidates.length,
    surfaced,
    room,
  });

  return json({
    ok: true,
    surfaced,
    offered: body.candidates.length,
    room_remaining: Math.max(0, room - surfaced),
    note: surfaced === 0
      ? "Nothing cleared the bar. Most sessions produce nothing and that is the intended result."
      : `${surfaced} candidate(s) stored as half_mined. Each needs Josh interviewed before it ` +
        `can be drafted (4.3.3), and the opening question is stored rather than sent.`,
  });
}

/* ── The interview, off Telegram ───────────────────────────────────────────────────────────────
 *
 * WHY THESE EXIST
 *
 * Josh's Claude session told him "Waiting on an interview with you (6)" and gave him no way to
 * answer one. Telegram could ask but was not reaching him; Claude was reaching him but could not
 * ask. All six questions expired at seven days and parked, which is every call transcript he has
 * ever sent.
 *
 * The write authority argument is unchanged from the top of this file: content_mcp holds no INSERT
 * on moments, raw_inputs or interview_turns, and it should not. The model decides; this writes.
 */

/** 4.1 — a thought, from a surface that is not Telegram. */
async function capture(db: SupabaseClient, body: { text?: string }) {
  const text = String(body.text ?? "").trim();
  if (!text) return json({ error: "text is required" }, 400);

  const { data: moment, error } = await db.from("moments").insert({
    source: "raw_capture",
    status: "captured",
  }).select("id, ref").single();
  if (error || !moment) return json({ error: `could not create moment: ${error?.message}` }, 500);

  await db.from("raw_inputs").insert({
    moment_id: moment.id,
    kind: "text",
    text_body: text,
  });

  // The interview starts here, synchronously, and the first question goes back to Claude — not to
  // the Telegram queue. Without a first question the moment sits at `captured` with no turns, which
  // is how seven of them ended up. But enqueueing the Telegram step for it (as this did) also sent
  // that question to Telegram, so a thought typed into Claude was interviewed in two places at once.
  const step = await chooseNextQuestion(db, moment.id);
  await logEvent(db, "captured_via_mcp", "info", { moment_id: moment.id, ref: moment.ref, action: step.action });

  return json({
    ok: true,
    moment_id: moment.id,
    moment_ref: moment.ref,
    ...step,
    next: step.action === "asked"
      ? "Ask him this question, then pass his answer to answer_interview."
      : nextFor(step.action),
  });
}

/** The open question for a moment, asking a new one if there is room. */
async function interviewNext(db: SupabaseClient, body: { moment_id?: number }) {
  const momentId = Number(body.moment_id);
  if (!Number.isInteger(momentId)) return json({ error: "moment_id must be an integer" }, 400);

  // A question already waiting is NOT re-asked. Calling this twice must not burn two of the eight
  // (5.8), and must not leave two unanswered questions pointing at one moment.
  const session = await loadSession(db, momentId);
  const last = session.turns[session.turns.length - 1];
  if (last?.role === "question") {
    return json({
      ok: true,
      action: "asked",
      moment_id: momentId,
      question: last.body,
      already_open: true,
      progress: `${session.questionsAsked} of at most 8 asked so far.`,
      next: "Answer it with answer_interview. It was already waiting, so no new question was spent.",
    });
  }

  const step = await chooseNextQuestion(db, momentId);
  return json({ ok: true, ...step, moment_id: momentId, next: nextFor(step.action) });
}

/** Record an answer, then take the next step — all of it, without Telegram. */
async function interviewAnswer(db: SupabaseClient, body: { moment_id?: number; answer?: string }) {
  const momentId = Number(body.moment_id);
  if (!Number.isInteger(momentId)) return json({ error: "moment_id must be an integer" }, 400);

  const answer = String(body.answer ?? "").trim();
  if (!answer) return json({ error: "answer is required" }, 400);

  const { data: moment } = await db
    .from("moments").select("id, ref, status, killed").eq("id", momentId).maybeSingle();
  if (!moment) return json({ error: `no moment with id ${momentId}` }, 404);
  if (moment.killed) return json({ error: `moment ${momentId} has been killed` }, 409);

  // An answer with no question is a thought, not an answer — and filing it as one would put it in a
  // transcript under a question nobody asked.
  const session = await loadSession(db, momentId);
  const last = session.turns[session.turns.length - 1];
  if (last?.role !== "question") {
    return json({
      error: "There is no open question on that moment.",
      moment_ref: moment.ref,
      next: "Call next_interview_question first, or capture_thought if this is something new.",
    }, 409);
  }

  await appendTurn(db, momentId, {
    role: "answer",
    body: answer,
    question_key: null,
    depth: null,
    is_pushback: false,
  });

  // Synchronous rather than enqueued, deliberately. `enqueue("interview_step")` would work and the
  // next question would go to TELEGRAM, which is the surface this whole route exists to avoid.
  const step = await chooseNextQuestion(db, momentId);

  await logEvent(db, "interview_answered_via_mcp", "info", {
    moment_id: momentId,
    ref: moment.ref,
    action: step.action,
  });

  return json({ ok: true, ...step, moment_id: momentId, moment_ref: moment.ref, next: nextFor(step.action) });
}

function nextFor(action: string): string {
  if (action === "asked") return "Answer it with answer_interview.";
  if (action === "finished") {
    return "The interview is over and extraction is queued. It will become material on its own; " +
      "call get_moment in a minute to see what it produced.";
  }
  if (action === "parked") {
    return "Parked, which is a real outcome and not a failure (clause 5). It stays in the bank and " +
      "reopens if he adds to it.";
  }
  return "Nothing to do on that moment.";
}

/* ── A draft, written in Claude ────────────────────────────────────────────────────────────────
 *
 * Drafting moved to Claude and judging stayed on the server. This is the seam between them.
 *
 * The draft is filed by applyDraft — the same function the server's own drafter uses — so the claim
 * ledger, the one-row-per-check rule, the three-strike retry and the eight checks afterwards are all
 * exactly what they were. Only who holds the pen changed.
 */

interface DraftBody {
  moment_id?: number;
  body?: string;
  hook?: string;
  framework?: string;
  claims?: Claim[];
  model?: string;
}

async function fileDraft(db: SupabaseClient, body: DraftBody) {
  const momentId = Number(body.moment_id);
  if (!Number.isInteger(momentId)) return json({ error: "moment_id must be an integer" }, 400);

  const text = String(body.body ?? "").trim();
  if (!text) return json({ error: "body is required" }, 400);
  if (!Array.isArray(body.claims)) return json({ error: "claims must be an array (it may be empty)" }, 400);

  const { data: moment } = await db
    .from("moments").select("id, ref, status, killed").eq("id", momentId).maybeSingle();
  if (!moment) return json({ error: `no moment with id ${momentId}` }, 404);
  if (moment.killed) return json({ error: `moment ${momentId} has been killed`, ref: moment.ref }, 409);

  // Mined or queued is a first draft; drafted is a rewrite. Anything earlier has not been
  // interviewed (4.3.3), and anything later has already left the writing stage.
  if (!["mined", "queued", "drafted"].includes(moment.status)) {
    return json({
      error: `${moment.ref} is ${moment.status}, so it cannot be drafted yet.`,
      next: moment.status === "captured" || moment.status === "half_mined"
        ? "It has not been interviewed. Run the interview first with next_interview_question."
        : "It has already moved past drafting.",
    }, 409);
  }

  /*
   * THE WAITING JOB, IF THERE IS ONE.
   *
   * A draft job left pending for Claude carries the attempt number and the near-miss warning. The
   * attempt matters: it is what makes the third failure park the moment (9.8) instead of looping
   * forever. Taking it from the job rather than the caller means a caller cannot reset the count by
   * saying "attempt 1".
   */
  const { data: job } = await db
    .from("jobs")
    .select("id, payload")
    .eq("type", "draft")
    .eq("status", "pending")
    .eq("payload->>moment_id", String(momentId))
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  const payload = (job?.payload ?? {}) as Record<string, unknown>;
  const attempt = Number(payload.attempt ?? 1);
  const nearMiss = (payload.near_miss as string | null | undefined) ?? null;

  const { data: library } = await db
    .from("library_versions").select("version").order("version", { ascending: false }).limit(1).maybeSingle();

  const filed = await applyDraft(db, {
    momentId,
    attempt,
    nearMiss,
    body: text,
    hook: String(body.hook ?? "").trim(),
    framework: String(body.framework ?? "").trim(),
    claims: body.claims,
    // 8.4 — what wrote it. "claude-code" when the caller does not say, never a role name.
    model: String(body.model ?? "claude-code").trim() || "claude-code",
    libraryVersion: (library?.version as number | undefined) ?? null,
  });

  // The job is answered. Left pending it would be offered as work again, and written twice.
  if (job) {
    await db.from("jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", job.id);
  }

  await logEvent(db, "draft_written_in_claude", "info", {
    moment_id: momentId,
    ref: moment.ref,
    draft_id: filed.draftId,
    attempt,
    verified: filed.verified,
  });

  return json({
    ok: true,
    moment_ref: moment.ref,
    draft_id: filed.draftId,
    attempt,
    claims_verified: filed.verified,
    failures: filed.failures,
    next: filed.gateQueued
      ? "Filed. The server is running the eight checks now. If it is rejected, it comes back to " +
        "next_work with the reasons attached."
      : attempt >= 3
      ? "The claim ledger failed on the third attempt, so the idea has been parked (9.8)."
      : "The claim ledger failed, so the checks were not run. It is back on next_work with the " +
        "failures attached — fix those claims against what he actually said.",
  });
}
