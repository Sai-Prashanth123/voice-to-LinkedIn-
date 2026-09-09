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

import { admin, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import { applyExtraction, seedText } from "../_shared/handlers/interview.ts";
import { loadSession, renderTranscript } from "../_shared/session.ts";
import { verifyExtraction } from "../_shared/extraction.ts";
import type { Extraction } from "../_shared/schemas.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = admin();
  await loadSecrets(db);

  let body: { kind?: string; moment_id?: number; extracted?: Extraction };
  try {
    body = await req.json();
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }

  if (body.kind !== "extraction") {
    return json({ error: `unknown kind "${body.kind ?? ""}". Expected "extraction".` }, 400);
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
