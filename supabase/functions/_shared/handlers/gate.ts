/**
 * Job: `gate` — the rejection mechanism (clause 9b).
 *
 *   "The gate runs on every draft before Josh sees it. It is a rejection mechanism, not a scoring
 *    exercise." — 9b
 *   "A gate that always eventually passes something is not a gate." — 9b callout
 *
 * Design decisions that make it actually reject things:
 *
 *   * EACH CHECK IS ITS OWN CALL. Run together in one prompt, a model averages across eight criteria
 *     and lets marginal work through. Separately, each gets a focused rubric and a binary verdict.
 *   * ANY SINGLE FAIL FAILS THE DRAFT. There is no scoring, no weighting, no pass-with-a-note (9.7).
 *   * THE GATE IS NOT TOLD THE DRAFT WAS MACHINE-WRITTEN. It never sees the drafter's prompt, its
 *     reasoning, or that it is judging its own output. It is handed a post by an unnamed author.
 *   * UNSURE MEANS FAIL. Stated in the system prompt and reinforced by the schema.
 *
 * Acceptance test 8 — 10 deliberately generic drafts, at least 9 rejected — is the check on all of
 * the above, and it is the reason none of it is optional.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callStructured, MODELS, modelName, pacing } from "../llm.ts";
import { getMaterial, getMoment, getNames, logEvent, sourceEntry } from "../db.ts";
import { clearedNames, unclearedNames } from "../names.ts";
import { enqueue } from "../jobs.ts";
import { loadLibrary } from "../library.ts";
import { CHECK_NEEDS_SECTION, notJudged, unjudgeableChecks } from "../views.ts";
// Re-exported because gate-basis.test.ts imports them from here, and because this is where a
// reader looking for the gate rule will go first.
export { notJudged, unjudgeableChecks };
import { GATE_CHECKS, GATE_SYSTEM, GATE_USER, PROMPT_VERSION } from "../prompts.ts";
import { GateVerdictSchema } from "../schemas.ts";
import type { Job } from "../types.ts";
import { retryOrPark } from "./draft.ts";

/** Checks that need the source material in front of them. */
const NEEDS_SOURCE = new Set(["claims_trace", "anyone_else", "identifiable"]);

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Promise.all was fine until a provider with a per-minute token budget arrived and eight concurrent
 * gate checks tripped its rate limit before a single verdict came back. Results stay in input order,
 * because the gate reports per check and the order is how a human reads it.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function handleGate(db: SupabaseClient, job: Job): Promise<void> {
  const draftId = Number(job.payload.draft_id);
  const momentId = Number(job.payload.moment_id);
  const attempt = Number(job.payload.attempt ?? 1);
  const nearMiss = (job.payload.near_miss as string | null | undefined) ?? null;

  const { data: draft, error } = await db.from("drafts").select("*").eq("id", draftId).single();
  if (error || !draft) throw new Error(`draft ${draftId} not found`);
  if (draft.gate_passed !== null) return; // already judged; a retried job must not re-judge

  const moment = await getMoment(db, momentId);
  const material = await getMaterial(db, momentId);
  const entry = sourceEntry(material);
  // 9.10 — cleared FOR THIS POST, not for whatever this moment produced last time.
  const cleared = await clearedNames(db, momentId);

  const library = await loadLibrary(db, "gating");
  const system = GATE_SYSTEM(library.prompt);

  await db.from("moments").update({ status: "gated" }).eq("id", momentId);

  // THE GATE RESUMES. It does not restart.
  //
  // Each verdict is written the moment it is reached, and a check that already has one is not run
  // again. So a job that dies part way — a rate limit, a wall-clock timeout, a deploy mid-flight —
  // picks up where it stopped instead of paying for six completed checks a second time.
  //
  // This started as a way to survive Groq's 8,000 tokens-per-minute ceiling, which eight checks
  // cannot fit into one invocation however they are scheduled. But it is the right shape for any
  // provider: the gate is eight independent judgements, and there was never a reason for the
  // seventh failing to discard the first six.
  const { data: done } = await db
    .from("gate_runs")
    .select("check_key, passed, reason")
    .eq("draft_id", draftId);

  const already = new Map((done ?? []).map((r) => [r.check_key, r]));
  let remaining = GATE_CHECKS.filter((c) => !already.has(c.key));

  // A CHECK WITH NO BASIS IS RECORDED AS UNJUDGED, NOT AS A PASS.
  //
  // Measured across every run to date: voice_guide has failed 0 times out of 18, including all five
  // deliberately generic drafts that acceptance test 8 exists to have rejected. anyone_else caught
  // 6 of those 6. The difference is not that the check is lenient — it is that the section it
  // judges against is the placeholder Josh has not replaced, so there is nothing to compare a draft
  // to and every draft looks compliant.
  //
  // It still passes, because blocking a draft for a section Josh has not supplied would punish him
  // for a gap he has already been told about. What changes is that the row now says so. A green
  // verdict with no reason is indistinguishable from an earned one everywhere gate_runs is read —
  // the draft record, the desk, list_drafts — and that is exactly the kind of control that looks
  // like it works and does nothing.
  //
  // The scorecard has warned about this since clause 17 was built. The warning lived in a report
  // nobody reads per draft; this puts it where the verdict is.
  const unjudgeable = unjudgeableChecks(remaining, library.sections);

  if (unjudgeable.length > 0) {
    remaining = remaining.filter((c) => !unjudgeable.includes(c));
    const rows = unjudgeable.map((c) => ({
      draft_id: draftId,
      check_key: c.key,
      passed: true,
      reason: notJudged(CHECK_NEEDS_SECTION[c.key]),
      model: "none",
    }));
    await db.from("gate_runs").insert(rows);
    for (const row of rows) {
      already.set(row.check_key, {
        check_key: row.check_key,
        passed: true,
        reason: row.reason,
      });
    }
  }

  // Concurrency is a provider property, and now it is actually asked for rather than decided here.
  // This used to compare provider() against the
  // literal "groq", which quietly assumed every provider added afterwards had Anthropic's headroom.
  // Gemini does not — its free tier limits REQUESTS per minute rather than tokens — and its first
  // real gate run returned 429 before judging anything, in exactly the way this comment already
  // described and the code no longer prevented.
  //
  // Throttling remains an accommodation: if the gate needs it in production, the provider is wrong,
  // not the gate.
  const { parallel: paced, spacingMs } = pacing();
  const parallel = Math.min(paced, GATE_CHECKS.length);

  let deferred: Error | null = null;

  await mapWithLimit(remaining, parallel, async (check, index) => {
    if (deferred) return; // the budget is already gone; stop spending it
    if (spacingMs && index > 0) await new Promise((r) => setTimeout(r, spacingMs));

    let verdict: { passed: boolean; reason: string };
    try {
      verdict = await callStructured(GateVerdictSchema, {
        model: MODELS.OPUS,
        system,
        messages: [{
          role: "user",
          content: GATE_USER({
            check,
            body: draft.body,
            entry: NEEDS_SOURCE.has(check.key) ? entry : undefined,
            audience: check.key === "aimed_at_someone" ? moment.audience : undefined,
            clearedNames: check.key === "names_cleared" ? cleared : undefined,
          }),
        }],
        effort: "high",
        // 800 was too tight. The banned-phrases check reasons over a long list before answering and
        // ran out of budget mid-thought — which the gate recorded as a failure, because a check that
        // could not run has not passed. The post was fine; the budget was not.
        maxTokens: 1600,
        purpose: `gate:${check.key}`,
        momentId,
        draftId,
        promptVersion: PROMPT_VERSION,
      }, { db });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // "The service was busy" is not "the answer is no". Recording a rate limit as a gate failure
      // burns one of the three attempts a moment gets (9.8) and would eventually park a perfectly
      // good moment for reasons that have nothing to do with its quality. It is held and rethrown
      // after the loop, so the checks that DID complete are kept.
      if (message.includes("TRANSIENT")) {
        deferred = err instanceof Error ? err : new Error(message);
        return;
      }

      // A check that genuinely could not run has not passed. Failing open defeats the point.
      verdict = { passed: false, reason: `This check could not be completed: ${message}` };
    }

    await db.from("gate_runs").insert({
      draft_id: draftId,
      check_key: check.key,
      passed: verdict.passed,
      reason: verdict.passed ? null : (verdict.reason || "Failed without a stated reason."),
      // The MODEL, not the role. This stored the literal "STRONG", which says nothing about what
      // actually judged the draft — and what judged it is the single most important caveat on
      // every gate number in this build, because "STRONG" has meant Claude, gpt-oss, Qwen and
      // flash-lite at different points. A verdict you cannot attribute is a verdict you cannot
      // weigh.
      model: modelName(MODELS.OPUS),
    });
    already.set(check.key, { check_key: check.key, passed: verdict.passed, reason: verdict.reason });
  });

  // Rethrown only now. The job retries and finishes the checks that never ran; the ones that did
  // are already recorded and will be skipped.
  if (deferred) throw deferred;

  await finishGate(db, draftId, nearMiss);
}

/**
 * What happens to a draft once all eight verdicts exist, whoever reached them.
 *
 * WHY THIS IS ITS OWN FUNCTION NOW
 *
 * The judging moved into Claude: with `gate_runs_in_claude` on, the server files a draft and leaves
 * it, and `record_gate_verdict` writes the eight rows from there. That worked — and nothing happened
 * afterwards. Draft 57 had eight verdicts, one of them a rejection, while `gate_passed` stayed null,
 * no rewrite was queued and Josh was never told. The tool even replied "the draft is ready for Josh's
 * calendar", which nothing implemented.
 *
 * That is the same shape of fault as the 30 ungated drafts he found: a step that reports success and
 * has no second half. The ending belongs with the verdicts, not with whichever caller reached them,
 * so both paths run this.
 *
 * Idempotent on purpose. A second call after `gate_passed` is set returns what it already decided
 * rather than queueing a second rewrite.
 */
export async function finishGate(
  db: SupabaseClient,
  draftId: number,
  /* 7.2's warn band, carried into the retry so attempt three does not forget what attempt two was
     warned off. Null is correct and common. */
  nearMiss: string | null = null,
): Promise<{ outcome: "passed" | "rejected" | "incomplete" | "already"; failed: string[]; judged: number }> {
  const { data: draft, error } = await db.from("drafts").select("*").eq("id", draftId).single();
  if (error || !draft) throw new Error(`draft ${draftId} not found`);

  const momentId = Number(draft.moment_id);
  const attempt = Number(draft.attempt ?? 1);

  if (draft.gate_passed !== null) {
    return {
      outcome: "already",
      failed: draft.gate_passed ? [] : String(draft.gate_reason ?? "").split(" | ").filter(Boolean),
      judged: 8,
    };
  }

  const { data: rows } = await db.from("gate_runs")
    .select("check_key,passed,reason")
    .eq("draft_id", draftId);

  // One verdict per check, the first recorded standing — the same rule record_gate_verdict enforces.
  const byCheck = new Map<string, { passed: boolean; reason: string | null }>();
  for (const r of rows ?? []) {
    if (!byCheck.has(r.check_key)) byCheck.set(r.check_key, { passed: r.passed, reason: r.reason });
  }

  // A draft is not judged until every check has answered. Closing it out early is how a draft with
  // six verdicts gets treated as finished, which is what clause 9b exists to prevent.
  const missing = GATE_CHECKS.filter((c) => !byCheck.has(c.key)).map((c) => c.key);
  if (missing.length > 0) {
    return { outcome: "incomplete", failed: [], judged: byCheck.size };
  }

  const verdicts = GATE_CHECKS.map((c) => {
    const r = byCheck.get(c.key)!;
    return { key: c.key, passed: r.passed, reason: r.reason ?? "" };
  });

  const failures = verdicts.filter((v) => !v.passed);

  if (failures.length > 0) {
    const reasons = failures.map((f) => `${f.key}: ${f.reason}`);
    await db.from("drafts").update({
      gate_passed: false,
      gate_reason: reasons.join(" | "),
    }).eq("id", draftId);

    await logEvent(db, "gate_rejected", "info", {
      moment_id: momentId,
      draft_id: draftId,
      attempt,
      failed_checks: failures.map((f) => f.key),
    });

    await retryOrPark(db, momentId, attempt, draft.body, reasons, nearMiss);
    return { outcome: "rejected", failed: failures.map((f) => f.key), judged: 8 };
  }

  await db.from("drafts").update({ gate_passed: true, gate_reason: null }).eq("id", draftId);

  // Acceptance test 8 seeds ten deliberately generic drafts and asks the gate to reject them. Two
  // are near-misses, written to be arguable — so one of them getting through is a possible and even
  // expected outcome of running the test. Without this, that outcome would put a fixture post in
  // Josh's calendar and announce it to him in Telegram: the test would corrupt the thing it is
  // testing. The verdict is still recorded; only the calendar is spared.
  if (draft.framework === "acceptance-fixture") {
    await logEvent(db, "gate_fixture_passed", "info", {
      draft_id: draftId,
      moment_id: momentId,
      note: "acceptance test 8 draft cleared the gate — recorded, not pushed to the calendar",
    });
    return { outcome: "passed", failed: [], judged: 8 };
  }

  await pushToCalendar(db, momentId, draftId, draft.body);

  await db.from("moments").update({
    status: "drafted",
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);

  await logEvent(db, "gate_passed", "info", { moment_id: momentId, draft_id: draftId, attempt });

  // 9.16 — push-back is optional and the system never waits on Josh. If he happens to be in the
  // session he can react; if not, the draft sits in the calendar for the weekly pass.
  await enqueue(db, "notify_draft_ready", { moment_id: momentId, draft_id: draftId });

  return { outcome: "passed", failed: [], judged: 8 };
}

/**
 * 11.1 — into the calendar at DRAFT status. Never scheduled, never live.
 *
 * Two things this does that a bare insert did not.
 *
 * IT SUPERSEDES RATHER THAN ACCUMULATES. Every gate pass used to insert a new row, and nothing
 * constrains `posts.moment_id`. A push-back (9.16) sends the revision back through the gate, so the
 * second pass created a SECOND calendar entry and Josh would meet the same moment twice in his
 * weekly pass — one of them the version he had already asked to be changed. The revision replaces
 * the draft it revises. An entry he has already approved is never touched: `marked_ready_at` is his
 * authorisation (R3) and this code has no business overwriting a decision he has made.
 *
 * IT CARRIES THE IMAGE. 11.3 says the entry carries the idea bank id "and its image where there is
 * one". `visual.ts` only ever set `visual_id` if a post already existed, and the ordinary case is
 * that Josh sends the image WITH the thought — long before anything is written. So the image was
 * built, stored, shown to him in Telegram, and then quietly never reached the calendar.
 */
async function pushToCalendar(
  db: SupabaseClient,
  momentId: number,
  draftId: number,
  body: string,
): Promise<void> {
  const { data: visual } = await db
    .from("visuals")
    .select("id")
    .eq("moment_id", momentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existing } = await db
    .from("posts")
    .select("id")
    .eq("moment_id", momentId)
    .eq("status", "draft")
    .is("marked_ready_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    moment_id: momentId,
    draft_id: draftId,
    body,
    status: "draft" as const,
    visual_id: visual?.id ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await db.from("posts").update(row).eq("id", existing.id)
    : await db.from("posts").insert(row);

  if (error) throw new Error(`could not create calendar entry: ${error.message}`);
}
