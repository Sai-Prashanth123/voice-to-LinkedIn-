/**
 * Interview session state (5.11 — "a session must be resumable. Josh gets interrupted constantly.")
 *
 * State lives in the database, not in memory, so a session survives an Edge Function cold start, a
 * deploy, and Josh going quiet for three days mid-conversation. There is no session table: the
 * conversation IS `interview_turns`, and the active moment is whichever one is being mined.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { InterviewDepth, InterviewTurn } from "./types.ts";

export interface SessionState {
  momentId: number;
  turns: InterviewTurn[];
  questionsAsked: number;
  pushbackUsed: boolean;
  depthReached: InterviewDepth;
  /** 6.4 — this is a second sitting on a moment Josh came back to, not a fresh capture. */
  reopened: boolean;
}

/**
 * The moment Josh is currently being interviewed about, if any.
 *
 * "Currently" means captured or half_mined — a moment that has been mined is finished with, and a
 * new voice note starts a new moment rather than continuing an old conversation.
 */
export async function activeSession(db: SupabaseClient): Promise<SessionState | null> {
  const { data } = await db
    .from("moments")
    .select("id, depth_reached")
    .in("status", ["captured", "half_mined"])
    .eq("killed", false)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return await loadSession(db, data.id);
}

export async function loadSession(db: SupabaseClient, momentId: number): Promise<SessionState> {
  const { data: moment } = await db
    .from("moments")
    .select("depth_reached, reopened_at")
    .eq("id", momentId)
    .single();

  const { data: turns } = await db
    .from("interview_turns")
    .select("*")
    .eq("moment_id", momentId)
    .order("turn_no");

  const list = (turns ?? []) as InterviewTurn[];

  // 6.4 — re-opening starts a NEW session on an old moment, so the per-session budgets start again
  // from there. Counting them over the whole history meant a moment parked after eight questions
  // came back with nothing left to spend: it would go straight to extraction, re-mine the same
  // material and park itself again. The transcript below is still the whole conversation, because
  // what he said the first time is context, not budget.
  const since = moment?.reopened_at ? new Date(moment.reopened_at).getTime() : null;
  const thisSession = since === null
    ? list
    : list.filter((t) => t.created_at != null && new Date(t.created_at).getTime() >= since);

  return {
    momentId,
    turns: list,
    questionsAsked: thisSession.filter((t) => t.role === "question").length,
    pushbackUsed: thisSession.some((t) => t.is_pushback),
    depthReached: (moment?.depth_reached ?? "none") as InterviewDepth,
    reopened: since !== null,
  };
}

/**
 * When the newest question on a moment was asked, or null if none has been.
 *
 * Used to decide whether an incoming message is an answer or a new thought. 4.1.3 lets Josh "talk
 * for two minutes and be done, with the follow-up happening later if he is busy" — so an unanswered
 * question is normal, and a message arriving long afterwards is far more likely to be something new
 * than a belated reply.
 */
export async function lastQuestionAt(
  db: SupabaseClient,
  momentId: number,
): Promise<Date | null> {
  const { data } = await db
    .from("interview_turns")
    .select("created_at")
    .eq("moment_id", momentId)
    .eq("role", "question")
    .order("turn_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.created_at ? new Date(data.created_at) : null;
}

export function renderTranscript(state: SessionState): string {
  if (state.turns.length === 0) return "(no questions asked yet)";
  return state.turns
    .map((t) => (t.role === "question" ? `YOU: ${t.body}` : `JOSH: ${t.body}`))
    .join("\n\n");
}

export async function appendTurn(
  db: SupabaseClient,
  momentId: number,
  turn: Omit<InterviewTurn, "moment_id" | "turn_no">,
): Promise<void> {
  const { data } = await db
    .from("interview_turns")
    .select("turn_no")
    .eq("moment_id", momentId)
    .order("turn_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  await db.from("interview_turns").insert({
    moment_id: momentId,
    turn_no: (data?.turn_no ?? 0) + 1,
    ...turn,
  });
}

/** Depths are ordered; a session records the deepest rung it reached, not the last one tried. */
const DEPTH_RANK: Record<InterviewDepth, number> = {
  none: 0,
  earned_perspective: 1,
  time_anchored: 2,
  scene: 3,
};

export function deepest(a: InterviewDepth, b: InterviewDepth): InterviewDepth {
  return DEPTH_RANK[a] >= DEPTH_RANK[b] ? a : b;
}
