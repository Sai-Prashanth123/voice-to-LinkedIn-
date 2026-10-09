/**
 * The queue processor. pg_cron ticks this every minute.
 *
 * One function routes every queued job type rather than deploying a dozen pollers. Each invocation
 * takes a small batch and does one step per job, which keeps every call well inside the Edge
 * Function wall-clock limit and makes the pipeline resumable: a job that dies mid-step becomes
 * claimable again after backoff instead of being lost.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleDraft } from "../_shared/handlers/draft.ts";
import { handleGate } from "../_shared/handlers/gate.ts";
import { handleInterviewExtract, handleInterviewStep } from "../_shared/handlers/interview.ts";
import { handleVisual } from "../_shared/handlers/visual.ts";
import { runWorker } from "../_shared/jobs.ts";
import type { Job } from "../_shared/types.ts";

const HANDLERS: Record<string, (db: SupabaseClient, job: Job) => Promise<void>> = {
  /*
   * `transcribe` is gone. Every piece of audio this system ever had arrived as a Telegram voice
   * note, and with that surface removed nothing produces any. The stored audio and transcripts stay
   * (4.1.2, 6.3) — what has gone is the job that turned one into the other.
   *
   * This is the clause-4 capability Josh is owed a written variation about: he can no longer talk
   * into his phone from anywhere. He dictates into a session instead, and the text arrives as text.
   */
  interview_step: handleInterviewStep,
  interview_extract: handleInterviewExtract,
  draft: handleDraft,
  gate: handleGate,
  visual: handleVisual,
};

/*
 * DRAFTS ARE WRITTEN IN CLAUDE. THE SERVER ONLY JUDGES THEM.
 *
 * `draft` is left out of the types this worker claims. The jobs are still queued — by selection,
 * by a gate rejection, by Josh pushing back — and they wait, pending, carrying exactly the context a
 * rewrite needs: the previous body, the gate's reasons, his note. That pending queue IS Claude's
 * writing list; next_work reads it and create_draft closes each job it answers.
 *
 * Everything after the writing is unchanged. applyDraft files a Claude draft exactly as the server
 * filed its own, and queues the eight checks, which this worker still runs.
 *
 * handleDraft stays registered so a job that is already running when this deploys still completes,
 * and so turning server drafting back on is removing one word from the filter below.
 */
const CLAIMED = Object.keys(HANDLERS).filter((type) => type !== "draft");

Deno.serve(() =>
  runWorker(
    { name: "worker-dispatch", types: CLAIMED, batch: 3, chain: true },
    async (db, job) => {
      const handler = HANDLERS[job.type];
      if (!handler) throw new Error(`no handler for job type "${job.type}"`);
      await handler(db, job);
    },
  )
);
