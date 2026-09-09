/**
 * What happens to a triage result, whoever produced it.
 *
 * Extracted when triage moved off the free tier, so the Claude Code path and worker-triage share
 * one implementation of the three rules that actually protect Josh — rather than two that agree
 * today and diverge on the first improvement to either.
 *
 * THE RULES, AND WHY EACH IS HERE RATHER THAN IN A PROMPT
 *
 *   The daily cap (4.4.3). "A version of this that surfaces ten candidates a day is worse than no
 *   version at all, because Josh will stop reading them." Counted against what he has actually been
 *   SHOWN in the last day, across every source. A prompt asked to be selective drifts; a subtraction
 *   does not.
 *
 *   The strength bar. Applied AFTER the model's own judgement, because a model asked for its best
 *   candidates will always find some. Four out of five, or it does not surface.
 *
 *   half_mined, never mined (4.3.2). A candidate is something to ask Josh about, not material. The
 *   moments_half_mined_is_automatic constraint enforces the same thing at the database, so a caller
 *   trying to write finished material through this door fails rather than succeeds quietly.
 *
 * The opening question is STORED, not asked (4.3.4): candidates are raised when Josh next opens a
 * session, never pushed at him the moment they are found.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { MomentSource } from "./types.ts";

export interface Candidate {
  summary: string;
  why_interesting: string;
  strength: number;
  opening_question: string;
  names?: { name: string; kind: "person" | "company" }[];
}

/** The bar a candidate clears to be worth Josh's attention at all. */
export const MIN_STRENGTH = 4;

/**
 * How many candidates may still be surfaced today.
 *
 * Deliberately counts moments rather than jobs: the cap is on what Josh SEES, and a job that
 * produced nothing cost him nothing.
 */
export async function candidateRoom(db: SupabaseClient, dailyCap: number): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db
    .from("moments")
    .select("*", { count: "exact", head: true })
    .eq("status", "half_mined")
    .in("source", ["claude_code", "call_transcript", "slack"])
    .gte("captured_at", since);

  return Math.max(0, dailyCap - (count ?? 0));
}

/**
 * Which candidates actually surface, out of what was offered.
 *
 * Pure, and separated from the writing so it can be proved without a database and without waiting
 * for the daily cap to be free. Both rules live here:
 *
 *   the bar    — applied AFTER the model's own judgement, because a model asked for its best
 *                candidates will always find some. A caller inflating a score to get something
 *                through only wastes its own run.
 *   the order  — strongest first, so when the cap bites it takes the weakest, not the last.
 */
export function worthSurfacing(candidates: Candidate[], room: number): Candidate[] {
  return (candidates ?? [])
    .filter((c) => Number(c.strength) >= MIN_STRENGTH)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, Math.max(0, room));
}

/**
 * Store the candidates worth storing, and return how many that was.
 *
 * @param room the most that may be surfaced now, from candidateRoom()
 */
export async function applyCandidates(
  db: SupabaseClient,
  p: { source: MomentSource; source_ref: string },
  candidates: Candidate[],
  room: number,
): Promise<number> {
  const worth = worthSurfacing(candidates, room);

  for (const c of worth) {
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

    // Stored, not sent. 4.3.4.
    await db.from("interview_turns").insert({
      moment_id: moment.id,
      turn_no: 1,
      role: "question",
      body: c.opening_question,
      depth: "scene",
      is_pushback: false,
    });
  }

  return worth.length;
}
