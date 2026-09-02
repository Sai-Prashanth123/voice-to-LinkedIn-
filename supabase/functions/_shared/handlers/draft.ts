/**
 * Job: `draft` — write the post (clause 9a).
 *
 * The drafter's context is built here and contains exactly two things: the idea bank entry, and the
 * reference library (9.1). No web access, no other moments, no published archive. That last one
 * matters — clause 8a says Josh's old posts drifted from how he sounds, and training on them would
 * reproduce the exact problem this system exists to solve. The archive lives in its own table and
 * nothing in this file reads it.
 *
 * The claim ledger is verified mechanically the moment the draft comes back, before a single gate
 * token is spent. A fabricated quote has no source span and fails here.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callStructured, MODELS, modelName } from "../llm.ts";
import { verifyDraft, type Claim } from "../claims.ts";
import { getMaterial, getMoment, getNames, logEvent, park, sourceEntry } from "../db.ts";
import { clearedNames, unclearedNames } from "../names.ts";
import { enqueue } from "../jobs.ts";
import { sendParked } from "../parked.ts";
import { loadLibrary } from "../library.ts";
import { DRAFT_USER, DRAFTER_SYSTEM, PROMPT_VERSION } from "../prompts.ts";
import { DraftSchema } from "../schemas.ts";
import type { Job } from "../types.ts";

const MAX_ATTEMPTS = 3; // 9.8 — three strikes and the moment parks

export async function handleDraft(db: SupabaseClient, job: Job): Promise<void> {
  const momentId = Number(job.payload.moment_id);
  const attempt = Number(job.payload.attempt ?? 1);
  const previousFailures = (job.payload.failures as string[] | undefined) ?? [];
  const previousBody = job.payload.previous_body as string | undefined;
  // 7.2’s warn band, handed down by the selector. Null on the common path.
  const nearMiss = (job.payload.near_miss as string | null | undefined) ?? null;

  const moment = await getMoment(db, momentId);
  if (moment.killed || moment.status === "parked") return;

  const material = await getMaterial(db, momentId);
  const entry = sourceEntry(material);
  if (Object.keys(entry).length === 0) {
    await park(db, momentId, "There is no mined material to write from.");
    return;
  }

  // 9.10 — cleared FOR THIS POST. A permission granted before the moment was last re-opened does
  // not carry into what is being written now.
  const cleared = await clearedNames(db, momentId);
  const uncleared = (await unclearedNames(db, momentId)).map((n) => n.name);

  // The claim ledger checks every name against its EFFECTIVE state for this post, which is why the
  // list is rebuilt from the two above rather than read straight off the row: `moment_names.cleared`
  // alone would say a re-opened moment's old permission still stands.
  const clearedSet = new Set(cleared);
  const names = (await getNames(db, momentId)).map((n) => ({
    ...n,
    cleared: clearedSet.has(n.name),
  }));

  const library = await loadLibrary(db, "drafting");

  const result = await callStructured(DraftSchema, {
    model: MODELS.OPUS,
    system: DRAFTER_SYSTEM(library.prompt),
    messages: [{
      role: "user",
      content: DRAFT_USER({
        entry,
        audience: moment.audience,
        pillar: moment.pillar,
        clearedNames: cleared,
        unclearedNames: uncleared,
        nearMiss,
        previousAttempt: previousBody
          ? { body: previousBody, failures: previousFailures }
          : undefined,
      }),
    }],
    effort: "high",
    maxTokens: 4000,
    purpose: "draft",
    momentId,
    promptVersion: PROMPT_VERSION,
  }, { db });

  // ── The claim ledger, checked before any model opinion is involved ──────────
  const verification = verifyDraft(
    result.body,
    result.claims as Claim[],
    entry,
    names.map((n) => ({ name: n.name, cleared: n.cleared })),
  );

  const nextVersion = await nextDraftVersion(db, momentId);

  const { data: inserted, error } = await db.from("drafts").insert({
    moment_id: momentId,
    version: nextVersion,
    attempt,
    body: result.body,
    hook: result.hook,
    framework: result.framework,
    library_version: library.version,
    // The model, not the role — see the note in gate.ts. 8.4 pins the library version a draft
    // was written against; the model that wrote it deserves the same treatment.
    model: modelName(MODELS.OPUS),
    claims: result.claims,
    claims_verified: verification.ok,
  }).select("id").single();
  if (error || !inserted) throw new Error(`could not store draft: ${error?.message}`);

  await db.from("moments").update({
    status: "drafted",
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);

  if (!verification.ok) {
    // Deterministic failure. No point paying for eight gate calls on a draft that already asserts
    // something that never happened.
    for (const failure of verification.failures) {
      await db.from("gate_runs").insert({
        draft_id: inserted.id,
        check_key: "claims_trace",
        passed: false,
        reason: failure,
        model: "deterministic",
      });
    }
    await db.from("drafts").update({
      gate_passed: false,
      gate_reason: verification.failures.join(" "),
    }).eq("id", inserted.id);

    await logEvent(db, "claims_failed", "info", {
      moment_id: momentId,
      draft_id: inserted.id,
      attempt,
      failures: verification.failures,
    });

    await retryOrPark(db, momentId, attempt, result.body, verification.failures, nearMiss);
    return;
  }

  await enqueue(db, "gate", { draft_id: inserted.id, moment_id: momentId, attempt, near_miss: nearMiss });
}

/**
 * 9.8 — after three failed attempts the draft must not be sent. The moment goes back to parked with
 * a plain-language reason, "usually that there is not enough real material yet".
 */
export async function retryOrPark(
  db: SupabaseClient,
  momentId: number,
  attempt: number,
  body: string,
  failures: string[],
  /* 7.2 — carried through every attempt on this moment, or attempt two writes the post attempt one
     was warned off. */
  nearMiss: string | null = null,
): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) {
    await park(
      db,
      momentId,
      `Three attempts could not clear the gate. ${failures[0] ?? ""} ` +
        `Usually this means there is not enough real material here yet — ` +
        `if you remember more about it, send it and I will reopen this one.`,
    );
    await logEvent(db, "moment_parked", "warn", { moment_id: momentId, failures });

    // The reason above promises a way back, and until 6.4 was built there was none: the moment
    // parked silently and anything he sent afterwards opened a new one. Telling him is also the
    // honest half of 9.8 — a draft that will never arrive should not just quietly not arrive.
    await sendParked(
      db,
      momentId,
      "I could not get this one past the gate in three attempts. " +
        (failures[0] ?? "") +
        "\n\nUsually that means there is not enough real material here yet. It stays in the bank.",
    );
    return;
  }
  await enqueue(db, "draft", {
    moment_id: momentId,
    attempt: attempt + 1,
    previous_body: body,
    failures,
    // Carried forward: without it, attempt two forgets what attempt one was warned to avoid.
    near_miss: nearMiss,
  });
}

async function nextDraftVersion(db: SupabaseClient, momentId: number): Promise<number> {
  const { data } = await db
    .from("drafts")
    .select("version")
    .eq("moment_id", momentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.version ?? 0) + 1;
}
