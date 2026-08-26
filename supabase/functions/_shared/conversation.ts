/**
 * 12.5–12.8 — the one question, and the rules that make it survivable.
 *
 *   "Did any of these lead to a conversation?"
 *
 * It is the only signal that connects a post to the business, and the reason it is worth asking at
 * all is that nothing else can answer it: LinkedIn will never report that a DM came from a post, so
 * attribution here is invisible unless a person says it out loud.
 *
 * WHY THIS IS SHARED RATHER THAN IMPLEMENTED TWICE
 *
 * The pass exists on two surfaces — Telegram for approving in seconds where Josh already is, the web
 * app for the times he wants to rewrite in a real textarea. Both had their own copy of "which posts
 * still need asking about", and the copies disagreed: skipping in one was invisible to the other.
 *
 * 12.7 says the question must never become "a second place to go". Two surfaces are fine; two
 * different answers to the same question are not. So the state lives here, and both surfaces ask it
 * rather than deciding it.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSetting } from "./db.ts";

/** How far back the question looks. 12.6 — "the posts that went out in the last few weeks". */
const WINDOW_DAYS = 21;

export interface Askable {
  postId: number;
  momentId: number;
  ref: string;
  body: string;
  askCount: number;
}

/**
 * The posts worth raising, newest first.
 *
 * Excluded: anything answered, and anything already raised `conversation_max_asks` times. That
 * second rule is 12.8 and it is the whole point — a post he has ignored twice has told us what he
 * thinks of the question, and asking a third time is nagging.
 */
export async function postsToAskAbout(db: SupabaseClient): Promise<Askable[]> {
  const maxAsks = await getSetting(db, "conversation_max_asks", 2);
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const { data } = await db
    .from("posts")
    .select(
      "id, body, moment_id, published_at, moments!inner(ref, killed), outcomes(conversation_answered_at, conversation_ask_count)",
    )
    .eq("status", "published")
    // See the note in worker-ops: Josh was asked twice about a verification fixture.
    .eq("moments.killed", false)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(20);

  const out: Askable[] = [];
  for (const p of data ?? []) {
    // deno-lint-ignore no-explicit-any
    const raw = (p as any).outcomes;
    const o = (Array.isArray(raw) ? raw[0] : raw) as
      | { conversation_answered_at: string | null; conversation_ask_count: number | null }
      | null
      | undefined;

    if (o?.conversation_answered_at) continue;
    const asked = o?.conversation_ask_count ?? 0;
    if (asked >= maxAsks) continue;

    // deno-lint-ignore no-explicit-any
    const mRaw = (p as any).moments;
    const m = Array.isArray(mRaw) ? mRaw[0] : mRaw;

    out.push({
      postId: p.id,
      momentId: p.moment_id,
      ref: m?.ref ?? "",
      body: p.body,
      askCount: asked,
    });
  }
  return out;
}

/**
 * Record that these were put in front of him — whether he answered, skipped, or closed the tab.
 *
 * Called by the surface that DISPLAYS the question, not by the one that receives an answer, because
 * from Josh's side being asked and ignoring it is the same event as being asked and skipping. That
 * is what makes "skip" honest: it is not a special case, it is simply the second thing that happens
 * after an ask.
 */
export async function recordAsked(db: SupabaseClient, posts: Askable[]): Promise<void> {
  const now = new Date().toISOString();
  for (const p of posts) {
    await db.from("outcomes").upsert({
      post_id: p.postId,
      moment_id: p.momentId,
      conversation_asked_at: now,
      conversation_ask_count: p.askCount + 1,
      updated_at: now,
    });
  }
}

export type ConversationAnswer = "none" | "comment_thread" | "dm" | "call" | "client";

/** The single writer of an answer, so both surfaces record it identically. */
export async function recordAnswer(
  db: SupabaseClient,
  postId: number,
  answer: ConversationAnswer,
  who?: string | null,
): Promise<void> {
  const { data: post } = await db
    .from("posts").select("moment_id").eq("id", postId).maybeSingle();
  if (!post) return;

  await db.from("outcomes").upsert({
    post_id: postId,
    moment_id: post.moment_id,
    conversation: answer,
    conversation_who: who?.trim() || null,
    conversation_answered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/** Enough of a post to recognise which one is being asked about. */
export function firstLine(body: string, max = 120): string {
  const line = (body ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
