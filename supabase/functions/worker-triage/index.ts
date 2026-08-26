/**
 * The automatic inputs (4.3 call transcripts, 4.4 Claude Code, 4.5 Slack).
 *
 * ONE RULE GOVERNS THIS ENTIRE FILE, and the spec states it three times:
 *
 *   "The system must not draft a post from a transcript alone, under any circumstance." (4.3.3)
 *
 * Everything here produces `half_mined` moments — candidates. A candidate cannot be drafted: the
 * selector only ever picks up `mined` moments, and a moment only reaches `mined` by going through
 * the interview with Josh. Josh explains why himself: a transcript records what was said, never what
 * he thought about it, "and that is the entire raw material of a post worth reading. A system that
 * drafts off these sources will produce fluent, confident, generic posts. That is the single most
 * likely way this build fails."
 *
 * The second rule is volume (4.4.3): "a version of this that surfaces ten candidates a day is worse
 * than no version at all, because Josh will stop reading them." Hence the hard daily cap.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callStructured, MODELS } from "../_shared/llm.ts";
import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import {
  PROMPT_VERSION,
  TRIAGE_CLAUDE_CODE_SYSTEM,
  TRIAGE_SLACK_SYSTEM,
  TRIAGE_TRANSCRIPT_SYSTEM,
} from "../_shared/prompts.ts";
import { TriageSchema } from "../_shared/schemas.ts";
import type { MomentSource } from "../_shared/types.ts";

interface Pending {
  id: number;
  source: MomentSource;
  source_ref: string;
  digest: string;
}

Deno.serve(async (req) => {
  const db = admin();
  await loadSecrets(db);

  // Ingest endpoint: cc-agent on Josh's machine POSTs digests here (4.4.1).
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.digests) return await ingestDigests(db, body);
    } catch { /* fall through to the sweep */ }
  }

  return await sweep(db);
});

/**
 * Accepts pre-filtered digests from Josh's machine. The local agent has already discarded the
 * routine sessions and stripped the code — measured on a comparable machine, raw logs run to
 * ~1.1 MB per session and 625 MB in total, so shipping them would be both unaffordable and a
 * confidentiality problem (15.4).
 */
async function ingestDigests(db: SupabaseClient, body: {
  digests: { session_id: string; digest: string; started_at?: string }[];
  source?: MomentSource;
}): Promise<Response> {
  const source = body.source ?? "claude_code";
  let queued = 0;

  for (const d of body.digests) {
    const { data: existing } = await db
      .from("moments")
      .select("id")
      .eq("source", source)
      .eq("source_ref", d.session_id)
      .maybeSingle();
    if (existing) continue; // already seen this session

    await db.from("jobs").insert({
      type: "triage_digest",
      payload: { source, source_ref: d.session_id, digest: d.digest },
      dedupe_key: `triage:${source}:${d.session_id}`,
    });
    queued++;
  }

  await logEvent(db, "digests_received", "info", {
    source,
    received: body.digests.length,
    queued,
  });
  return json({ ok: true, received: body.digests.length, queued });
}

async function sweep(db: SupabaseClient): Promise<Response> {
  const dailyCap = await getSetting(db, "cc_candidates_per_day", 3);
  const slackEnabled = await getSetting(db, "slack_enabled", false);

  // 4.4.3 — the cap is on candidates SURFACED, counted against what Josh has actually been shown
  // today. It is enforced here in code, because a prompt asked to be selective will drift.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count: surfacedToday } = await db
    .from("moments")
    .select("*", { count: "exact", head: true })
    .eq("status", "half_mined")
    .in("source", ["claude_code", "call_transcript", "slack"])
    .gte("captured_at", since);

  const room = dailyCap - (surfacedToday ?? 0);
  if (room <= 0) {
    return json({ ok: true, surfaced: 0, reason: "daily candidate cap reached" });
  }

  // Claimed with SKIP LOCKED rather than plain-selected. Two overlapping sweeps reading the same
  // pending rows would triage the same call twice and surface duplicate candidates — which is
  // exactly the burying-Josh failure 4.4.3 warns about, arriving by a different route.
  const { data: jobs, error: claimError } = await db.rpc("claim_jobs", {
    p_worker: "triage",
    p_types: ["triage_digest"],
    p_limit: 10,
  });

  if (claimError) {
    return json({ ok: false, error: claimError.message }, 500);
  }
  if (!jobs || jobs.length === 0) {
    return json({ ok: true, surfaced: 0, reason: "nothing waiting" });
  }

  let surfaced = 0;
  const results: { ref: string; candidates: number }[] = [];
  const deferred: number[] = [];

  for (const job of jobs) {
    // The daily cap stops work but must not consume it. Anything claimed and not processed goes
    // back to pending below — otherwise it sits at `running` forever and that call is never read.
    if (surfaced >= room) {
      deferred.push(job.id);
      continue;
    }

    const p = job.payload as { source: MomentSource; source_ref: string; digest: string };
    if (p.source === "slack" && !slackEnabled) {
      // 4.5.2 — off by default until Josh says otherwise.
      await db.from("jobs").update({ status: "done" }).eq("id", job.id);
      continue;
    }

    try {
      const found = await triageOne(db, p, room - surfaced);
      surfaced += found;
      results.push({ ref: p.source_ref, candidates: found });
      await db.from("jobs").update({ status: "done" }).eq("id", job.id);
    } catch (err) {
      await db.rpc("fail_job", {
        p_id: job.id,
        p_error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (deferred.length > 0) {
    // Released without counting an attempt against them: they were never tried, only deferred.
    await db.from("jobs").update({
      status: "pending",
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    }).in("id", deferred);
  }

  return json({ ok: true, surfaced, deferred: deferred.length, results });
}

const SYSTEMS: Record<string, string> = {
  claude_code: TRIAGE_CLAUDE_CODE_SYSTEM,
  call_transcript: TRIAGE_TRANSCRIPT_SYSTEM,
  slack: TRIAGE_SLACK_SYSTEM,
};

async function triageOne(
  db: SupabaseClient,
  p: { source: MomentSource; source_ref: string; digest: string },
  room: number,
): Promise<number> {
  // Claude Code volume is the cost driver (~700 sessions/month even after local filtering), so it
  // gets the cheap model. Transcripts and Slack are lower volume and carry more nuance.
  const model = p.source === "claude_code" ? MODELS.HAIKU : MODELS.SONNET;

  const result = await callStructured(TriageSchema, {
    model,
    system: SYSTEMS[p.source],
    messages: [{ role: "user", content: p.digest.slice(0, 60_000) }],
    effort: "medium",
    maxTokens: 2000,
    purpose: `triage:${p.source}`,
    promptVersion: PROMPT_VERSION,
  }, { db });

  const candidates = (result.candidates ?? [])
    .filter((c) => c.strength >= 4) // a high bar, applied after the model's own judgement
    .sort((a, b) => b.strength - a.strength)
    .slice(0, room);

  for (const c of candidates) {
    const { data: moment } = await db.from("moments").insert({
      source: p.source,
      source_ref: p.source_ref,
      // 4.3.2 — stored as half-mined, never as finished material.
      status: "half_mined",
      strength: c.strength,
      notes: `${c.summary}\n\nWhy this might be worth writing: ${c.why_interesting}`,
    }).select("id").single();
    if (!moment) continue;

    // 4.3.5 / 9c — every name recorded, none cleared. Slack especially: other people's words in a
    // place they did not expect to be quoted.
    for (const n of c.names ?? []) {
      if (!n.name?.trim()) continue;
      await db.from("moment_names").upsert(
        { moment_id: moment.id, name: n.name.trim(), kind: n.kind, cleared: false },
        { onConflict: "moment_id,name", ignoreDuplicates: true },
      );
    }

    // The opening question is stored, not asked. 4.3.4: candidates are raised when Josh next opens
    // a session, not pushed at him the moment they are found.
    await db.from("interview_turns").insert({
      moment_id: moment.id,
      turn_no: 1,
      role: "question",
      body: c.opening_question,
      depth: "scene",
      is_pushback: false,
    });
  }

  return candidates.length;
}
