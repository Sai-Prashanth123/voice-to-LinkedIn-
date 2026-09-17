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

export type BotAction =
  | "none"
  | "start_interview"
  | "show_waiting"
  | "review_drafts"
  | "status"
  | "help"
  | "stop";

export interface Triaged {
  intent: "capture" | "question" | "action" | "chatter";
  action: BotAction;
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
    .select("title, notes, material(the_moment)")
    .eq("killed", false)
    .eq("status", "half_mined")
    .order("id", { ascending: false })
    .limit(6);

  const { data: ready } = await db
    .from("moments")
    .select("title, pillar, material(the_moment)")
    .eq("killed", false)
    .in("status", ["mined", "queued"])
    .order("id", { ascending: false })
    .limit(6);

  const line = (m: Record<string, unknown>) => {
    const material = m.material as { the_moment?: string } | { the_moment?: string }[] | null;
    const one = Array.isArray(material) ? material[0] : material;
    const summary = String(one?.the_moment ?? m.notes ?? "").replace(/\s+/g, " ").trim();
    return `  ${m.title ? `"${m.title}"` : "(unnamed idea)"}${summary ? ` — ${summary.slice(0, 140)}` : " — (nothing extracted yet)"}`;
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

/**
 * What the bot knows about ITSELF.
 *
 * The first version knew only the data. Asked "how do I start?" or "what do you do?", it had nothing
 * to say, because nothing in its prompt described the product it was part of — so the most basic
 * question a new person asks was the one it was least able to answer.
 *
 * This is the product, described once, in the words a person would use. The facts in it are the
 * real behaviour of this system; if the behaviour changes, this must change with it.
 */
const GUIDE = `WHAT THIS BOT IS

It turns the things that actually happen to him at work into LinkedIn posts that sound like him —
not like a marketing team. It does that by listening first and writing second.

HOW IT WORKS, IN ORDER

1. He sends a thought. A voice note while walking is best; a typed half-sentence is fine; a photo
   with a caption works too. Nothing needs to be polished.
2. The bot asks him a few short questions about it — what actually happened, who said what, what
   changed for him. At most eight, usually three or four. He can answer whenever suits, days later.
   Every question has buttons: skip it, "that's enough, write it up", or park the idea.
3. His answers become material, and a post is drafted from ONLY what he said. Nothing is invented.
4. Every draft is checked eight ways before he sees it — above all, "could anyone else have written
   this?" A draft that could have come from anyone is rejected.
5. He reviews it: approve, ask for a rewrite, pick a day, or say not this one.

WHAT HE CAN SAY OR TAP

- "interview me" / "ask me questions"   -> starts questions, on a waiting idea if there is one
- "what's waiting?"                      -> the ideas that need his answers
- "review my drafts"                     -> drafts ready for him
- "status"                               -> where everything stands
- "help"                                 -> the menu with buttons
- "stop" / "done"                        -> ends the current set of questions
- /rule followed by a rule               -> teaches it something about how he writes

He can also use it from Claude — the same system, with the same questions and drafts, through the
Content System connector.

WHAT IT WILL NOT DO

Invent a detail, a number or a quote. Post anything without him. Write about something he has not
told it about.`;

const SYSTEM = `You are the Telegram assistant for a personal content system. A message has
arrived. Decide what it is, then — when it calls for a reply — write one that feels like talking to
a sharp, warm colleague who knows the system inside out.

${GUIDE}

CLASSIFY THE MESSAGE

capture  — a thought or something that happened to him, however short. "lost a deal today" is
           material. This is the point of the whole system. When torn between capture and
           question, choose capture: a swallowed thought is invisible, a wrong reply is merely wrong.

question — he is asking something. About how the bot works, what it does, how to start, what to do
           next, or about what is waiting in the snapshot. Answer it.

action   — he wants the bot to DO one of the things it can do. Set the matching action:
           start_interview ("interview me", "ask me something", "start a conversation about my
           moment"), show_waiting, review_drafts, status, help, stop. Still write a short reply that
           says what is about to happen.

chatter  — a greeting, thanks, a typo correction. Leave the reply empty.

HOW TO WRITE A REPLY

- Warm, direct and brief. Two to four short sentences. It is a chat, not an email.
- Use his name when you have it, once, naturally — not in every line.
- Answer the actual question first. No preamble, no "Great question".
- End with the ONE most useful next step, phrased as something he can just do or say.
- Plain words. Never say "moment", "material", "idea bank", "triage" or "extraction" — say "idea",
  "your answers", "your ideas". Refer to a specific idea by its name in quotes. Never use or invent a code like M-000024.
- No headings, no bullet lists unless he asked for a list, no emoji, no sign-off.
- Speak as "I". Never "the bot" or "the system" about yourself.
- For an ACTION, one short sentence saying what is happening now — "Pulling up your oldest idea."
  No question at the end: the action itself sends the next message, and a question from you as well
  gives him two things to answer at once.

NEVER PROMISE ANYTHING THE GUIDE DOES NOT STATE

No claims about privacy, security, who can see his material, storage, deletion, pricing or timing.
An earlier version told him "your voice notes stay between us", which was invented and is not true.
When a question touches one of those, answer everything the guide DOES cover and hand off only the
part it does not. "What will you do with my voice notes?" is mostly a product question — answer how
they become posts — and only "who can see them" goes to Thought Pilot. Deflecting the whole question
because one word in it was "voice notes" is its own failure: it answers nothing.

ABOUT HIS DATA

Anything about what is waiting, ready or drafted comes from the SNAPSHOT below and nowhere else. You
may count and list what is there. You may not estimate or invent. If the snapshot does not hold the
answer, say plainly what you cannot see and where he would find it — the desk, for instance.`;

/**
 * One call, one decision. Returns `capture` on any failure — the safe direction, because a thought
 * wrongly filed is recoverable and a thought silently dropped is not.
 */
export async function triageMessage(
  db: SupabaseClient,
  text: string,
  name: string | null = null,
): Promise<Triaged> {
  // A switch that does not need a deploy. If the free tier is exhausted, or the replies turn out to
  // be worse than silence, this turns the model call off and the bot goes back to pure capture.
  const enabled = await getSetting(db, "bot_chat_enabled", true);
  if (!enabled) return { intent: "capture", action: "none", reply: "" };

  try {
    const context = await snapshot(db);

    const out = await callStructured(ChatTriageSchema, {
      model: MODELS.HAIKU,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `HIS NAME: ${name ?? "(not known)"}\n\nTHE MESSAGE\n\n${text}\n\n---\n\n` +
          `THE SNAPSHOT\n\n${context}`,
      }],
      effort: "low",
      maxTokens: 700,
      purpose: "chat_triage",
    }, { db });

    return {
      intent: out.intent as Triaged["intent"],
      action: (out.action ?? "none") as BotAction,
      reply: (out.reply ?? "").trim(),
    };
  } catch {
    // Deliberately silent to the caller and deliberately biased. A model outage must not start
    // dropping his thoughts on the floor, so an unreachable classifier means "treat it as material"
    // — which is exactly the behaviour that existed before this file.
    return { intent: "capture", action: "none", reply: "" };
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
  /*
   * UPSERT, NOT UPDATE. THIS WAS A BUG AND IT LOOPED FOREVER.
   *
   * telegram_access only holds chats that ASKED for access. The owner chat never asks — it is
   * authorised by being in the TELEGRAM_CHAT_ID list, and no row is ever written for it. So an
   * UPDATE here matched nothing, returned no error, and the name was silently discarded:
   *
   *   "hi"        -> Thanks hi. Send me anything worth remembering...
   *   "what is my chat id" -> Before we start, what should I call you?
   *   "Prashanth" -> Thanks Prashanth...
   *   "start a new conversation about my moment" -> Before we start, what should I call you?
   *
   * Every message answered the same question and none of the answers stuck. An UPDATE that matches
   * nothing is the quietest failure in SQL — it is indistinguishable from success at the call site.
   */
  const now = new Date().toISOString();
  await db
    .from("telegram_access")
    .upsert({
      chat_id: chatId,
      display_name: name,
      // The owner is approved by configuration; writing the row must not imply it needed approving,
      // and it must not leave a chat that DID need it sitting at pending.
      status: "approved",
      approved_at: now,
      updated_at: now,
    }, { onConflict: "chat_id" });
}
