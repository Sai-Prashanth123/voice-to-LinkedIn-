/**
 * The weekly sweep — set 2 of Josh's prompt set, which had never run.
 *
 * His own header table says what it is for: "Refill the bank when nothing obvious has happened.
 * Once a week, ten minutes." Five questions, designed to produce five candidates from an ordinary
 * week where nothing dramatic happened.
 *
 * Nothing scheduled it. The queue tick, triage, selection, publishing, metrics, the daily note and
 * the learning loop all had cron entries; the one job that REFILLS the bank did not — and the bank
 * is now eight ideas, every one of them parked, with nothing waiting to be written.
 *
 * WHAT IT DOES NOT DO
 *
 * Ask a model anything. The five questions are Josh's words, read from the question bank in document
 * order and sent one at a time. A sweep that paraphrased his questions would be the system deciding
 * what to ask about his week, which is the opposite of the point.
 *
 * WHY EACH ANSWER IS ONLY CAPTURED
 *
 * Five answers do not start five interviews. That would be five conversations at once, every one of
 * them shallow, and 4.4.3's lesson — a version that surfaces ten things a day is worse than none —
 * applies just as well to questions. They are captured, named from his own words, and at the end he
 * is shown what came out of it and taps the one worth digging into.
 */

import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import { getState, setState } from "../_shared/chat-state.ts";
import { joshChatId, sendMessage } from "../_shared/telegram.ts";
import { parsePromptSet, recordAsked, syncQuestions } from "../_shared/questions.ts";
import { loadLibrary } from "../_shared/library.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Sunday-to-Sunday, so a Monday run is never blocked by the previous Monday's. */
const ONCE_EVERY_HOURS = 6 * 24;

Deno.serve(async (req) => {
  const db = admin();
  await loadSecrets(db);

  // A sweep asked for by name skips the weekly cap and the enabled switch: he is standing there
  // asking for it, and refusing would be the system explaining its own schedule back to him.
  let onDemandChat: number | null = null;
  try {
    const body = await req.json();
    if (body?.chat_id) onDemandChat = Number(body.chat_id);
  } catch { /* the cron sends no body */ }

  // On request: that chat only. On the schedule: everyone the bot talks to.
  //
  // The scheduled path used to fall back to joshChatId(), the first id in TELEGRAM_CHAT_ID, which is
  // the operator's chat — so Monday's sweep would have gone to us and Josh would have been told a
  // second time that set 2 was not asking him anything.
  if (onDemandChat) return await sweep(db, onDemandChat, true);

  const { data: chats } = await db
    .from("telegram_access")
    .select("chat_id")
    .eq("status", "approved");

  const targets = new Set<number>((chats ?? []).map((c) => Number(c.chat_id)));
  try {
    targets.add(joshChatId());
  } catch { /* no TELEGRAM_CHAT_ID configured: the approved list is the whole audience */ }

  const results = [];
  for (const chatId of targets) {
    const res = await sweep(db, chatId, false);
    results.push({ chat_id: chatId, ...(await res.json()) });
  }
  return json({ ok: true, chats: results.length, results });
});

async function sweep(db: SupabaseClient, chatId: number, onDemand: boolean): Promise<Response> {
  if (!onDemand && !(await getSetting(db, "weekly_sweep_enabled", true))) {
    return json({ ok: true, swept: false, reason: "weekly_sweep_enabled is false" });
  }

  // Not into the middle of something. A sweep arriving while he is answering an interview question
  // would put two conversations in one chat, and the answer would land on whichever the bot happened
  // to be waiting on — which is exactly the collision 0038 removed.
  const state = await getState(db, chatId);
  if (state.awaiting !== "nothing") {
    return json({ ok: true, swept: false, reason: `chat is mid-${state.awaiting}` });
  }

  if (!onDemand) {
    // Per chat, not per system: two people each get their own week.
    const since = new Date(Date.now() - ONCE_EVERY_HOURS * 3_600_000).toISOString();
    const { count } = await db
      .from("system_events")
      .select("*", { count: "exact", head: true })
      .eq("kind", "weekly_sweep_started")
      .eq("detail->>chat_id", String(chatId))
      .gte("created_at", since);
    if ((count ?? 0) > 0) return json({ ok: true, swept: false, reason: "already swept this week" });
  }

  const questions = await sweepQuestions(db);
  if (questions.length === 0) {
    await logEvent(db, "weekly_sweep_empty", "warn", {
      note: "No questions are tagged `sweep`. Set 2 may have been edited out of the prompt set.",
    });
    return json({ ok: true, swept: false, reason: "no sweep questions in the prompt set" });
  }

  const [first, ...rest] = questions;

  await sendMessage(
    chatId,
    `The weekly sweep — five questions, ten minutes, whenever suits.\n\n` +
      `Anything that comes out of them I keep as an idea; say "nothing" to any you have no answer ` +
      `to.\n\n1. ${first.text}`,
  );
  await recordAsked(db, first.key);

  await setState(db, chatId, "sweep", null, {
    asked: first.key,
    asked_no: 1,
    total: questions.length,
    remaining: rest.map((q) => ({ key: q.key, text: q.text })),
    captured: [],
  });

  await logEvent(db, "weekly_sweep_started", "info", {
    chat_id: chatId,
    questions: questions.length,
    on_demand: onDemand,
  });

  return json({ ok: true, swept: true, questions: questions.length });
}

/** Set 2, in document order. Josh's words, as the library holds them. */
async function sweepQuestions(db: SupabaseClient): Promise<{ key: string; text: string }[]> {
  const library = await loadLibrary(db, "interview");
  const promptSet = library.sections.prompt_set ?? "";

  // Synced first, so a question Josh added to set 2 this morning is asked this morning.
  await syncQuestions(db, promptSet);

  const { data } = await db
    .from("question_stats")
    .select("key, current_text")
    .eq("set_key", "sweep");
  const byKey = new Map((data ?? []).map((q) => [q.key, q.current_text as string]));

  // Document order rather than database order: his five are a sequence, opening with the easiest.
  return parsePromptSet(promptSet)
    .filter((q) => q.set === "sweep" && byKey.has(q.key))
    .map((q) => ({ key: q.key, text: byKey.get(q.key)! }));
}
