/**
 * Telling Josh a moment has been parked — with the way back attached.
 *
 * Its own module because both park paths need it and they live in different handlers: the
 * interviewer parks when there is no moment behind a thought, and the drafter parks after three
 * attempts fail the gate (9.8). Putting it in either one would make the other import the wrong
 * thing.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { joshChatId, sendMessage } from "./telegram.ts";

/**
 * 6.4 — parking with a real way back.
 *
 * "A moment must be re-openable. Josh adds to an old entry and it goes back into the queue."
 *
 * The park messages already told him he could add to it later. Nothing implemented that, and there
 * was no linkage either — more material just created a new moment while the old one stayed parked
 * forever, which 6.3 guarantees it would. The button closes both halves: it reopens the moment AND
 * points the conversation at it, so what he says next lands on the right row.
 */
export async function sendParked(
  db: SupabaseClient,
  momentId: number,
  text: string,
): Promise<void> {
  const messageId = await sendMessage(joshChatId(), text, [
    [{ text: "Add to this one", data: `reopen:${momentId}` }],
  ]);

  if (messageId) {
    await db.from("sent_messages").insert({
      telegram_message_id: messageId,
      kind: "other",
      moment_id: momentId,
    });
  }
}
