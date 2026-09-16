/**
 * Deciding what a message IS, before deciding what to do with it.
 *
 * WHY THIS EXISTS
 *
 * `route()` was an ordered ladder of guards ending in `captureNewMoment`. Anything that matched no
 * guard became a moment. That is the correct default for a capture tool and the wrong one for
 * anything a person would call a bot, and the difference showed up the first time somebody used it
 * like one:
 *
 *   "Hello"                                    -> Got it. Saved as M-000033.
 *   "post*"                                    -> Got it. Saved as M-000034.
 *   "Can you give me a post idea?"             -> saved, then INTERVIEWED about his own question
 *   "Can you give me any new post ideas from
 *    pipeline?"                                -> 200 OK, and silence
 *
 * Five of the nine newest entries in the idea bank are a greeting, a bot handle typed twice and a
 * typo correction. 6.3 forbids deleting any of them.
 *
 * WHAT IT DOES NOT DO
 *
 * Invent. The reply is written from a snapshot read out of the database at call time, and the
 * instruction is to say so when the answer is not in it. Same discipline `claims_trace` applies to a
 * draft: a confident wrong number about Josh's own business is worse than "I don't have that".
 *
 * WHY THE CHEAP GUARDS COME FIRST
 *
 * One model call per unmatched message is a real cost on a tier that is already the reason a gate
 * check fails. A courtesy reply and an unknown slash command are both decidable without one, so they
 * are decided without one. The call happens only for messages that are genuinely ambiguous — which
 * is the only place it was ever needed.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { callStructured, MODELS } from "../llm.ts";
import { ChatTriageSchema } from "../schemas.ts";
import { getSetting } from "../db.ts";
import { picture } from "../home.ts";

export interface Triaged {
  intent: "capture" | "question" | "chatter";
  reply: string;
}

/**
 * What the bot is allowed to know when it answers.
 *
 * Deliberately small and deliberately live. It is rebuilt per message rather than cached, because
 * the one thing worse than not answering "what's waiting on me" is answering it with yesterday's
 * number.
 */
export async function snapshot(db: SupabaseClient): Promise<string> {
  const p = await picture(db);

  // The same filter offerCandidates uses, so the list and the count cannot disagree.
  const { data: waiting } = await db
    .from("moments")
    .select("ref, notes, material(the_moment)")
    .eq("killed", false)
    .eq("status", "half_mined")
    .order("id", { ascending: false })
    .limit(6);

  const { data: ready } = await db
    .from("moments")
    .select("ref, pillar, material(the_moment)")
    .eq("killed", false)
    .in("status", ["mined", "queued"])
    .order("id", { ascending: false })
    .limit(6);

  const line = (m: Record<string, unknown>) => {
    const material = m.material as { the_moment?: string } | { the_moment?: string }[] | null;
    const one = Array.isArray(material) ? material[0] : material;
    const summary = String(one?.the_moment ?? m.notes ?? "").replace(/\s+/g, " ").trim();
    return `  ${m.ref}${summary ? ` — ${summary.slice(0, 140)}` : " — (nothing extracted yet)"}`;
  };

  return [
    `COUNTS`,
    `  ready to write: ${p.readyToWrite}`,
    `  waiting on an interview with him: ${p.candidates}`,
    `  still being asked about: ${p.unanswered}`,
    `  drafts waiting for his review: ${p.draftsWaiting}`,
    `  parked: ${p.parked}`,
    `  library sections not filled in: ${p.librarySectionsEmpty}`,
    `  last capture: ${p.lastCaptureDaysAgo === null ? "never" : `${p.lastCaptureDaysAgo} days ago`}`,
    ``,
    `READY TO WRITE`,
    (ready ?? []).length ? (ready ?? []).map(line).join("\n") : "  (none)",
    ``,
    `WAITING ON AN INTERVIEW`,
    (waiting ?? []).length ? (waiting ?? []).map(line).join("\n") : "  (none)",
    ``,
    `NOT IN THIS SNAPSHOT: published posts, engagement numbers, anything about his clients, and`,
    `anything outside this system. Say you do not have it rather than guessing at it.`,
  ].join("\n");
}

const SYSTEM = `You are the Telegram bot for a content system that turns what Josh actually said
into LinkedIn posts. A message has arrived. Decide what it is, and reply only if it is a question.

CLASSIFY IT AS ONE OF THREE THINGS

capture  — a thought, an observation, a fragment of something that happened to him. This is the
           point of the system and the bias is towards it. "lost a deal today" is four words and is
           material. When it is genuinely a toss-up between capture and question, choose capture:
           a swallowed thought is invisible, a wrong reply is merely wrong.

question — he is asking the SYSTEM something. What is waiting, what is ready, what happened to a
           draft, what should he do next, what is blocked. These must never become idea-bank
           entries: the system once saved "Can you give me a post idea?" as a moment and then
           interviewed him about it.

chatter  — a greeting, an acknowledgement, a typo correction, a stray handle. "Hello", "thanks",
           "post*", "@userinfobot". Not material, not a question, and nothing to store.

IF IT IS A QUESTION

Answer it from the snapshot below and from nothing else. You may count, list and compare what is
there. You may not estimate, extrapolate, or recall anything about Josh from outside it.

If the snapshot does not contain the answer, say which part you cannot see and what would show it —
"I can see what's waiting but not what's published; the desk has that." Never fill the gap.

Write the way a colleague would in a chat: short, plain, no headings, no bullet lists unless you are
genuinely listing moments, and no sign-off. Two or three sentences is usually right. Refer to
moments by their ref (M-000024) because that is what he can act on.

IF IT IS NOT A QUESTION

Leave the reply empty. Something else handles it.`;

/**
 * One call, one decision. Returns `capture` on any failure — the safe direction, because a thought
 * wrongly filed is recoverable and a thought silently dropped is not.
 */
export async function triageMessage(db: SupabaseClient, text: string): Promise<Triaged> {
  // A switch that does not need a deploy. If the free tier is exhausted, or the replies turn out to
  // be worse than silence, this turns the model call off and the bot goes back to pure capture.
  const enabled = await getSetting(db, "bot_chat_enabled", true);
  if (!enabled) return { intent: "capture", reply: "" };

  try {
    const context = await snapshot(db);

    const out = await callStructured(ChatTriageSchema, {
      model: MODELS.HAIKU,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `THE MESSAGE\n\n${text}\n\n---\n\nTHE SNAPSHOT\n\n${context}`,
      }],
      effort: "low",
      maxTokens: 500,
      purpose: "chat_triage",
    }, { db });

    return {
      intent: out.intent as Triaged["intent"],
      reply: (out.reply ?? "").trim(),
    };
  } catch {
    // Deliberately silent to the caller and deliberately biased. A model outage must not start
    // dropping his thoughts on the floor, so an unreachable classifier means "treat it as material"
    // — which is exactly the behaviour that existed before this file.
    return { intent: "capture", reply: "" };
  }
}

/* ── Who the chat belongs to ──────────────────────────────────────────────────────────────────
 *
 * No onboarding flow and no `awaiting` state, on purpose: `conversation_state` is still one row
 * shared by every chat, so adding a state to it would be building on the bug rather than around it.
 * A chat with no name has its next message read as the answer. That is the whole mechanism.
 */

export async function displayName(db: SupabaseClient, chatId: number): Promise<string | null> {
  const { data } = await db
    .from("telegram_access")
    .select("display_name")
    .eq("chat_id", chatId)
    .maybeSingle();
  return (data?.display_name as string | null) ?? null;
}

/** A name, or null if what arrived was plainly not one. */
export function readName(text: string): string | null {
  const cleaned = text.trim().replace(/^(i'?m|my name is|it'?s|this is|call me)\s+/i, "").trim();
  // One or two words, letters and the punctuation names actually contain. A sentence is not a name,
  // and treating one as a name would lose a real thought to a greeting.
  if (!/^[\p{L}][\p{L}'’.-]*(\s+[\p{L}][\p{L}'’.-]*)?$/u.test(cleaned)) return null;
  if (cleaned.length > 40) return null;
  return cleaned.replace(/\.$/, "");
}

export async function setDisplayName(
  db: SupabaseClient,
  chatId: number,
  name: string,
): Promise<void> {
  await db
    .from("telegram_access")
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq("chat_id", chatId);
}
