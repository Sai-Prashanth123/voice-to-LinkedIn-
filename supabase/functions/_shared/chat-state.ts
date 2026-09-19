/**
 * What the bot is waiting on, per chat (migration 0038).
 *
 * `conversation_state` was one row with `id boolean primary key check (id)` — a literal singleton.
 * Two people in two chats shared one `awaiting` and one `moment_id`, so a second person starting an
 * interview overwrote the first, and the next answer landed on a stranger's idea. Now that any chat
 * is admitted without approval, that stops being theoretical.
 *
 * The webhook and the interview handler both reach for this, so it lives here rather than in either.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Awaiting } from "./types.ts";
import { joshChatId } from "./telegram.ts";

export interface ChatState {
  chat_id: number;
  awaiting: Awaiting;
  moment_id: number | null;
  context: Record<string, unknown>;
  /** When this chat last changed what it is waiting on. The answer window is measured from it. */
  updated_at?: string;
}

const EMPTY = (chatId: number): ChatState => ({
  chat_id: chatId,
  awaiting: "nothing",
  moment_id: null,
  context: {},
});

/** What this chat is waiting on. A chat with no row yet is waiting on nothing. */
export async function getState(db: SupabaseClient, chatId: number): Promise<ChatState> {
  const { data } = await db
    .from("conversation_state")
    .select("chat_id, awaiting, moment_id, context, updated_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  return (data as ChatState | null) ?? EMPTY(chatId);
}

/**
 * Upsert rather than update: the row for a chat is created the first time that chat is waiting on
 * anything. An UPDATE matched zero rows for every chat but the first, silently — which is how the
 * display-name bug behaved before it was found.
 */
export async function setState(
  db: SupabaseClient,
  chatId: number,
  awaiting: Awaiting,
  momentId: number | null,
  context: Record<string, unknown> = {},
): Promise<void> {
  await db.from("conversation_state").upsert({
    chat_id: chatId,
    awaiting,
    moment_id: momentId,
    context,
    updated_at: new Date().toISOString(),
  }, { onConflict: "chat_id" });
}

/**
 * Where an idea's messages belong.
 *
 * A question used to go to `joshChatId()` whoever had captured the idea, so on any second chat the
 * question went to the owner and the state waited on the person who would never see it. Anything
 * that did not arrive through Telegram (a call transcript, a Claude session) has no chat of its own,
 * and those go to the owner, which is what the owner is for.
 */
export async function chatForMoment(db: SupabaseClient, momentId: number): Promise<number> {
  const { data } = await db
    .from("moments").select("chat_id").eq("id", momentId).maybeSingle();
  const chatId = data?.chat_id as number | null | undefined;
  return typeof chatId === "number" ? chatId : joshChatId();
}

/** Every chat waiting on an answer to this idea. Used to keep a chat's state honest after a change. */
export async function statesFor(db: SupabaseClient, momentId: number): Promise<ChatState[]> {
  const { data } = await db
    .from("conversation_state")
    .select("chat_id, awaiting, moment_id, context")
    .eq("moment_id", momentId);
  return (data as ChatState[] | null) ?? [];
}
