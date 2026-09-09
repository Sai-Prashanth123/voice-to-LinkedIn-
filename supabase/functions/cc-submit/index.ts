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
import { applyExtraction, seedText } from "../_shared/handlers/interview.ts";
import { loadSession, renderTranscript } from "../_shared/session.ts";
import { verifyExtraction } from "../_shared/extraction.ts";
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

  if (body.kind !== "extraction") {
    return json({
      error: `unknown kind "${body.kind ?? ""}". Expected "extraction" or "candidates".`,
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
