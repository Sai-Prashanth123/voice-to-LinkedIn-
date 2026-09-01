/**
 * The worker harness.
 *
 * Every worker is a plain function over one job. This wrapper claims work with SKIP LOCKED, runs the
 * handler, and records the outcome. One step per invocation keeps each Edge Function call well
 * inside its wall-clock limit and makes the whole pipeline resumable — a worker that dies mid-step
 * leaves the job claimable again after backoff rather than losing it.
 *
 * 13.2: failures surface rather than being swallowed. `fail_job` retries with exponential backoff
 * and, once attempts are exhausted, marks the job dead AND writes a system_event so Josh hears about
 * it rather than discovering an empty calendar three weeks later.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, logEvent } from "./db.ts";
import { budgetRemaining, estimatedCost, exceedsProviderCeiling, pacing } from "./llm.ts";
import { loadSecrets, secret } from "./secrets.ts";
import type { Job } from "./types.ts";

export type Handler = (db: SupabaseClient, job: Job) => Promise<void>;

export interface RunOptions {
  /** Job types this worker handles. */
  types: string[];
  /**
   * Set false for workers whose jobs do not call a model at all — they have no reason to be held
   * back by a token budget they will never spend. Defaults to paced.
   */
  paced?: boolean;
  /** How many to take per invocation. Keep small; cron ticks every minute. */
  batch?: number;
  name: string;
  /**
   * Re-invoke this worker when it actually did something.
   *
   * Handlers queue the next stage — interview leads to extract, extract to draft, draft to gate —
   * and without this each hop would wait for the next cron tick, turning one moment into four
   * minutes of dead time. Terminates naturally: a run that claims nothing does not chain.
   */
  chain?: boolean;
}

export async function runWorker(opts: RunOptions, handler: Handler): Promise<Response> {
  const db = admin();
  await loadSecrets(db);
  const results: { id: number; ok: boolean; error?: string }[] = [];

  // HOW MANY JOBS MAY RUN AT ONCE IS A PROVIDER QUESTION, NOT A CONSTANT.
  //
  // The gate paces itself - it knows to space eight checks out on a throttled provider. What it
  // could not know is that three copies of it were running in the same tick. Batch 3, two checks
  // in flight each, seven seconds apart came to roughly fifty requests a minute against a free
  // tier allowing about ten, so every job 429d, backed off, and the queue ground without
  // finishing. The per-job pacing looked correct in isolation and was wrong in aggregate.
  //
  // A provider that asks to be spaced out gets one job at a time. Slower, and it actually
  // completes.
  const paced = opts.paced === false ? { spacingMs: 0 } : pacing();
  const batch = paced.spacingMs > 0 ? 1 : (opts.batch ?? 3);

  const { data, error } = await db.rpc("claim_jobs", {
    p_worker: opts.name,
    p_types: opts.types,
    p_limit: batch,
  });

  if (error) {
    return json({ worker: opts.name, error: error.message }, 500);
  }

  // The per-minute token budget, read once for this invocation. Null on any provider without one,
  // in which case nothing below applies.
  let remaining = opts.paced === false ? null : await budgetRemaining(db);
  const deferred: number[] = [];

  for (const job of (data ?? []) as Job[]) {
    // Do not START work the provider cannot finish.
    //
    // The old loop raced the ceiling and found it by failing: a burst of real use — a voice note, an
    // image and a prompted session arriving together — put every job behind them on a 429 and burned
    // retry attempts on a problem retrying cannot solve. A job released here is not lost; it goes
    // back to pending and the next tick takes it a minute later, by which time the budget has
    // refilled. A minute is a much better outcome than a failed attempt.
    if (remaining !== null) {
      const cost = estimatedCost(job.type);

      // Some jobs cannot fit in this provider's minute at ANY point in the minute — a full gate
      // needs about 16,000 tokens against a free-tier allowance of 8,000. Deferring one forever
      // would be a silent stall, so it runs and relies on the gate's own resume: it will spend what
      // it can, hit the limit, keep the verdicts it reached, and finish on the next attempt.
      //
      // Saying it plainly beats discovering it as a 429 every four hours.
      if (exceedsProviderCeiling(job.type)) {
        await logEvent(db, "job_exceeds_provider_ceiling", "info", {
          job_type: job.type,
          estimated: cost,
          note: "runs anyway and resumes; the provider cannot do this in one minute",
        });
      } else if (remaining < cost) {
        deferred.push(job.id);
        await db.from("jobs").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          run_after: new Date(Date.now() + 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        continue;
      }
      remaining -= cost;
    }

    try {
      await handler(db, job);
      await db.from("jobs").update({
        status: "done",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      results.push({ id: job.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.rpc("fail_job", { p_id: job.id, p_error: message });
      results.push({ id: job.id, ok: false, error: message });
    }
  }

  if (deferred.length > 0) {
    await logEvent(db, "jobs_deferred_for_budget", "info", {
      worker: opts.name,
      deferred: deferred.length,
      note: "released rather than run into the provider's per-minute ceiling; next tick takes them",
    });
  }

  // Keep the pipeline moving while there is work, rather than one stage per minute. Deliberately not
  // chained when work was deferred: chaining straight into the same exhausted budget is the busy
  // loop this exists to prevent.
  if (opts.chain && results.length > 0 && deferred.length === 0) nudge(opts.name);

  return json({ worker: opts.name, claimed: results.length, deferred: deferred.length, results });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Wake the dispatcher now instead of waiting for the next cron tick.
 *
 * `pg_cron` cannot fire more often than once a minute, which is fine for a voice note reaching the
 * idea bank (4.1.5 only rules out a nightly run) but wrong for a conversation. A minute of silence
 * after every answer is how a session gets abandoned — which 5.8 names as the thing to avoid: "Josh
 * is busy and a session that runs to fifteen questions gets abandoned."
 *
 * Fire-and-forget on purpose. The caller has already queued the work, so cron remains the guarantee;
 * this is only latency. If the nudge fails, the job still runs within the minute. `waitUntil` keeps
 * the isolate alive long enough for the request to leave, without making Telegram wait for it —
 * Telegram retries a webhook that answers slowly, and a retry would double-capture.
 *
 * Racing the cron tick is safe: `claim_jobs` uses SKIP LOCKED, so whichever arrives first takes the
 * work and the other finds nothing.
 */
export function nudge(worker = "worker-dispatch"): void {
  const base = secret("functions_base_url");
  const key = secret("service_role_key");
  if (!base || !key) return;

  const pending = fetch(`${base}/${worker}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {
    // Swallowed deliberately: cron is the guarantee, this was only an optimisation.
  });

  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(pending);
  } catch { /* not on Supabase's runtime — the fetch still goes out */ }
}

/** Enqueue follow-on work. `dedupeKey` makes cron-created jobs idempotent. */
export async function enqueue(
  db: SupabaseClient,
  type: string,
  payload: Record<string, unknown> = {},
  opts: { runAfter?: Date; dedupeKey?: string } = {},
): Promise<void> {
  const { error } = await db.rpc("enqueue", {
    p_type: type,
    p_payload: payload,
    p_run_after: (opts.runAfter ?? new Date()).toISOString(),
    p_dedupe_key: opts.dedupeKey ?? null,
  });
  if (error) throw new Error(`enqueue ${type}: ${error.message}`);
}
