/**
 * The one surface Josh touches on his phone (4.1, 4.2, 4.3.4, 9.14, 10.1).
 *
 * Two rules govern this file:
 *
 *   4.1.4 — acknowledge receipt so Josh knows it landed.
 *   4.1.5 — the moment reaches the idea bank as soon as the system reasonably can.
 *
 * So this does the minimum synchronously (store the input, acknowledge) and enqueues everything
 * expensive. Telegram retries a webhook that does not answer quickly, which would double-capture a
 * voice note, so the fast path is not optional.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { noteProvider } from "../_shared/providers.ts";
import type { Awaiting } from "../_shared/types.ts";
import { admin, getSetting, logEvent, park } from "../_shared/db.ts";
import { loadSecrets, secret } from "../_shared/secrets.ts";
import { approveAccess, isApproved, requestAccess } from "../_shared/telegram-access.ts";
import {
  type BotAction,
  displayName,
  readName,
  setDisplayName,
  triageMessage,
} from "../_shared/handlers/chat.ts";
import { enqueue, json, nudge } from "../_shared/jobs.ts";
import { pushBack } from "../_shared/pushback.ts";
import { recordVerdict } from "../_shared/outcome.ts";
import { decide as decideProposal } from "../_shared/proposals.ts";
import { startNextSeedMoment } from "../_shared/handlers/interview.ts";
import { loadLibrary, parsePillars } from "../_shared/library.ts";
import { appendTurn, lastQuestionAt, loadSession } from "../_shared/session.ts";
import {
  answerCallback,
  type Button,
  downloadFile,
  esc,
  isAuthorised,
  joshChatId,
  parseCommand,
  registerCommands,
  replaceMessage,
  sendMessage,
  sendRich,
  type TelegramUpdate,
} from "../_shared/telegram.ts";
import { helpMessage, picture, ruleHelp, statusMessage } from "../_shared/home.ts";
import {
  dayButtons,
  holdPost,
  parseAction,
  recordConversation,
  schedulePost,
  startWeeklyPass,
  verdictPrompt,
} from "../_shared/weeklypass.ts";

interface Message {
  message_id: number;
  chat: { id: number };
  // Telegram sends this on every message and it was never declared, so the bot asked people what to
  // call them while already holding the answer. Optional because a channel post has no sender.
  from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  audio?: { file_id: string; duration: number; mime_type?: string };
  photo?: { file_id: string; width: number }[];
  reply_to_message?: { message_id: number };
}

Deno.serve(async (req) => {
  // Credentials come from Vault, so they load before the shared-secret check rather than after.
  // The Supabase URL and service key are the only values still read from the environment, because
  // they are what opens the connection Vault is read through.
  const db = admin();
  await loadSecrets(db);

  // Telegram will not send a secret token unless configured; when it is, reject anything else.
  const expected = secret("TELEGRAM_WEBHOOK_SECRET");
  if (expected && req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return json({ ok: false }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return json({ ok: true }); // never make Telegram retry a malformed update
  }

  // A tap on a weekly-pass button. Handled before messages because it is a different update shape.
  if (update.callback_query) {
    const cq = update.callback_query;
    const callbackChatId = cq.message?.chat.id ?? cq.from.id;
    if (!isAuthorised(callbackChatId) && !await isApproved(db, callbackChatId)) {
      return json({ ok: true });
    }

    // Acknowledged first: Telegram spins on Josh's phone until this returns.
    await answerCallback(cq.id);
    try {
      if (cq.data?.startsWith("access:approve:")) {
        const ownerChatId = joshChatId();
        if (callbackChatId !== ownerChatId) return json({ ok: true });
        const requestedChatId = Number(cq.data.slice("access:approve:".length));
        if (!Number.isSafeInteger(requestedChatId)) return json({ ok: true });
        await approveAccess(db, requestedChatId);
        await sendMessage(requestedChatId, "Your access was approved. Send /start to begin.");
        if (cq.message) {
          await replaceMessage(callbackChatId, cq.message.message_id, `Approved chat ${requestedChatId}.`);
        }
        return json({ ok: true });
      }
      await handleTap(db, cq);
    } catch (err) {
      await logEvent(db, "telegram_tap_failed", "error", {
        error: err instanceof Error ? err.message : String(err),
        data: cq.data,
      });
    }
    return json({ ok: true });
  }

  const msg = update.message as Message | undefined;
  if (!msg) return json({ ok: true });

  // Rejecting an unknown chat is correct and must stay silent to the sender (15.4). But it is also
  // what a total credential failure looks like from the outside, which is how a real message got
  // dropped while this returned 200. Recording it means the two are distinguishable.
  if (!isAuthorised(msg.chat.id) && !await isApproved(db, msg.chat.id)) {
    /*
     * A STRANGER ASKS. THEY DO NOT LET THEMSELVES IN.
     *
     * This called registerAccess, which writes status 'approved' outright — so every unknown chat
     * was admitted on its first message and then fell straight through to route() below. The
     * migration that created this table says the opposite in its own header: "they cannot reach the
     * shared workspace until the owner approves them." Two readers of one rule, disagreeing.
     *
     * It matters more here than on the desk. The desk is read-only to a visitor; the bot WRITES.
     * An admitted stranger can put material into the bank and answer interview questions as though
     * they were Josh, and 15.4 exists because that bank holds his clients' material.
     *
     * So: record the request as pending, ask the owner, and stop. requestAccess returns true only
     * when it created the row, which keeps a stranger sending ten messages from sending ten
     * notifications.
     */
    try {
      const isNew = await requestAccess(db, msg.chat.id);
      if (isNew) {
        await logEvent(db, "telegram_access_requested", "warn", { chat_id: msg.chat.id });
        await sendRich(
          joshChatId(),
          `An unknown Telegram chat (<code>${msg.chat.id}</code>) messaged the bot and is waiting ` +
            `for access. Approve only if you recognise it — an approved chat can add material and ` +
            `answer interview questions.`,
          [[{ text: "Approve this chat", data: `access:approve:${msg.chat.id}` }]],
        );
      }
    } catch (err) {
      await logEvent(db, "telegram_access_registration_failed", "error", {
        chat_id: msg.chat.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Silent to the sender either way (15.4): an unknown chat learns nothing about what this is.
    return json({ ok: true });
  }

  try {
    await route(db, msg);
    // Anything route() queued should run now, not at the top of the next minute (5.8).
    nudge();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(db, "telegram_failed", "error", { error: message });
    // 13.2 — surface it rather than swallowing it, but still tell Josh something landed.
    try {
      await sendMessage(
        msg.chat.id,
        "Something went wrong handling that, and it has been logged. Your message was not lost — " +
          "send it again if you do not hear back shortly.",
      );
    } catch { /* the send itself failing is already logged above */ }
  }

  // Always 200. Telegram retries non-2xx, and a retry would duplicate the capture.
  return json({ ok: true });
});

async function route(db: SupabaseClient, msg: Message): Promise<void> {
  const chatId = msg.chat.id;
  // Declared, so this raises nothing — but the record of what this system touches should be
  // complete, because the handover document is generated from it.
  await noteProvider(db, "telegram", "messaging");
  const text = (msg.text ?? msg.caption ?? "").trim();

  // ── Commands ────────────────────────────────────────────────────────────────
  const command = parseCommand(msg.text);
  if (command.kind === "rule") {
    await addRule(db, chatId, command.text);
    return;
  }
  if (command.kind !== "none") {
    await handleCommand(db, chatId, command.kind);
    return;
  }

  // ── An image to rebuild (10.1) ─────────────────────────────────────────────
  if (msg.photo && msg.photo.length > 0) {
    await handleImage(db, chatId, msg);
    return;
  }

  // ── Replying to something the bot sent removes all ambiguity ────────────────
  if (msg.reply_to_message) {
    const { data: sent } = await db
      .from("sent_messages")
      .select("*")
      .eq("telegram_message_id", msg.reply_to_message.message_id)
      .maybeSingle();

    if (sent?.kind === "draft" && sent.draft_id) {
      await handlePushback(db, chatId, sent.moment_id, sent.draft_id, msg, text);
      return;
    }
    if (sent?.kind === "question" && sent.moment_id) {
      await handleAnswer(db, chatId, sent.moment_id, msg, text);
      return;
    }
    // 9.12 — replying to the message that asked about names IS the answer, whatever the conversation
    // state happens to be. This is what lets a seeding sitting keep running past a moment with a
    // person in it instead of stopping to wait: the reply carries its own context.
    if (sent?.kind === "names" && sent.moment_id) {
      await handleNameClearance(
        db,
        chatId,
        { moment_id: sent.moment_id, context: {} },
        text,
      );
      return;
    }
  }

  // ── Otherwise, whatever the bot is waiting on ──────────────────────────────
  const state = await getState(db);

  // 8.1 — recording the voice interview. Handled before everything else, because while this is
  // running a voice note is library evidence rather than a moment, and filing it as a moment would
  // put twenty minutes of him talking about his career into the idea bank as a post to write.
  if (state.awaiting === "voice_guide_capture") {
    await captureVoiceGuide(db, chatId, msg, text);
    return;
  }

  if (state.awaiting === "visual_details" && state.moment_id) {
    await startVisual(db, chatId, state, text);
    return;
  }

  // 10.6 — another version, without starting again.
  if (state.awaiting === "visual_feedback" && state.moment_id) {
    if (/^(another|again|different|try again|no)\b/i.test(text)) {
      await enqueue(db, "visual", {
        moment_id: state.moment_id,
        source_path: state.context.source_path,
        taking: state.context.taking ?? "idea",
        post_doing: state.context.post_doing ?? "",
        feedback: text,
      });
      await sendMessage(chatId, "Another take coming.");
      return;
    }
    // Anything else means he is done with the image and has moved on.
    await setState(db, "nothing", null);
  }

  // 12.4 — one line on a draft, or nothing.
  //
  // THREE GUARDS, because this state is the only one in the ladder that Josh never asked for. He
  // tapped "Not this one" and the system asked a follow-up; anything he sends next is far more
  // likely to be the next thing on his mind than an answer to it. A state that swallows material is
  // the exact failure `0009` was written to prevent, so it gives way in every ambiguous case:
  //
  //   - VOICE FALLS THROUGH, guarded below. A voice note is material (4.1.2) and it is how Josh
  //     actually uses this system. A verdict is typed or it is not left.
  //   - COMMANDS AND PHOTOS never arrive here at all — both are routed before the ladder.
  //   - IT EXPIRES. Ten minutes, the same reasoning as 0015's disambiguation window: past that, a
  //     message is a new thought and treating it as a verdict loses it.
  //
  // Nothing waits on this and nothing degrades without it (12.8). Silence is a complete answer.
  if (state.awaiting === "draft_verdict") {
    const postId = Number(state.context?.post_id ?? 0);
    const draftId = state.context?.draft_id ? Number(state.context.draft_id) : null;
    const askedAt = state.updated_at ? new Date(state.updated_at as string).getTime() : 0;
    const fresh = Date.now() - askedAt <= VERDICT_WINDOW_MS;
    const typed = !msg.voice && !msg.audio && text.length > 0;

    await setState(db, "nothing", null);

    if (fresh && typed && postId && await recordVerdict(db, postId, text, draftId)) {
      await sendMessage(chatId, "Noted — that goes into what I tune against.");
      return;
    }
    // Otherwise it was never a verdict. Fall through and treat it as whatever it actually is.
  }

  // 9.12 — his answer on whether names may be used.
  if (state.awaiting === "name_clearance" && state.moment_id) {
    await handleNameClearance(db, chatId, state, text);
    return;
  }

  // 4.3.4 — picking which waiting candidate to dig into.
  if (state.awaiting === "candidate_choice") {
    const choice = Number(text.trim());
    const ids = (state.context.candidate_ids ?? []) as number[];
    if (Number.isInteger(choice) && choice >= 1 && choice <= ids.length) {
      await openCandidate(db, chatId, ids[choice - 1]);
      return;
    }
    // Not a number in range — he has moved on. Fall through and treat it as a new thought.
    await setState(db, "nothing", null);
  }

  // `seeding` is an ordinary interview that keeps going; his reply is an answer either way. The
  // state differs only so the extract step knows to open the next moment rather than stop.
  if ((state.awaiting === "answer" || state.awaiting === "seeding") && state.moment_id) {
    const session = await loadSession(db, state.moment_id);
    const last = session.turns[session.turns.length - 1];

    if (last?.role === "question") {
      const askedAt = await lastQuestionAt(db, state.moment_id);
      const ageMs = askedAt ? Date.now() - askedAt.getTime() : Infinity;

      if (ageMs <= ANSWER_WINDOW_MS) {
        // Recent question: he is in the conversation. The common case, and it stays frictionless.
        await handleAnswer(db, chatId, state.moment_id, msg, text);
        return;
      }

      // 4.1.3 lets him leave a question and come back later, so a message arriving hours afterwards
      // is at least as likely to be something new. Guessing wrong loses the material silently — the
      // new moment is never created and the thought is filed as a reply to an old question. One tap
      // costs a second and removes the guess.
      await askWhichOne(db, chatId, state.moment_id, msg, text);
      return;
    }
  }

  // ── Nothing pending: work out what this actually is ────────────────────────
  //
  // This used to be `captureNewMoment` alone, which made "anything I do not recognise is a moment"
  // the system's answer to every message. See handlers/chat.ts for what that produced.
  await triageAndHandle(db, chatId, msg, text);
}

/**
 * The default branch, which used to be a single line.
 *
 * Ordered cheapest-first so the model is consulted only for messages that genuinely need judgement.
 * Every rung above it is free and decidable, and each one was put there by something that actually
 * happened rather than something imagined.
 */
async function triageAndHandle(
  db: SupabaseClient,
  chatId: number,
  msg: Message,
  text: string,
): Promise<void> {
  const voice = msg.voice ?? msg.audio;

  // Audio is always material. Nobody records a voice note to say hello, and sending one through a
  // classifier would spend a model call to learn that.
  if (voice) {
    await captureNewMoment(db, chatId, msg, text);
    return;
  }

  if (text.length === 0) return;

  // A slash command that got this far is one the bot does not have. It used to become a moment,
  // so /ideas filed an idea-bank entry containing the word "/ideas".
  if (text.startsWith("/")) {
    await sendMessage(chatId, `I do not have that one. /help lists what I can do.`);
    return;
  }

  /*
   * NOBODY IS ASKED THEIR NAME. TELEGRAM ALREADY SENT IT.
   *
   * The first version asked "what should I call you?" and would not proceed until it got an answer
   * it liked. Four messages in a row were answered with that same question, and none of the answers
   * stuck, because the write was an UPDATE against a row the owner chat has never had.
   *
   * Both halves of that were wrong. The bug was the UPDATE; the DESIGN was asking at all. Every
   * message carries from.first_name — the field existed, was simply never declared in the type, and
   * the bot interrogated people while holding the answer in its hand.
   *
   * So the name is learned silently on first contact and nothing is ever blocked on it.
   */
  const first = await ensureKnown(db, chatId, msg);

  // "what is my chat id" — reasonable, and unanswerable by the triage model because the chat id is
  // deliberately not in its snapshot. Free and certain.
  if (/\bchat\s*id\b/i.test(text)) {
    await sendMessage(chatId, `This chat's id is ${chatId}.`);
    return;
  }

  /*
   * Chatter is not captured. Chatter is still ANSWERED.
   *
   * The first version treated those as the same decision and said nothing at all — three greetings
   * in a row got silence, which reads as a dead bot rather than a tactful one. They are different
   * questions. isChatter exists so a greeting does not become a permanent idea-bank entry (6.3); it
   * was never a reason to ignore somebody.
   *
   * A greeting opens a conversation and wants a reply. An acknowledgement CLOSES one — "thanks",
   * "ok", a thumbs up — and answering it starts a loop that only ends when one side gives up.
   */
  if (isChatter(text)) {
    await setState(db, "nothing", null);
    if (first) {
      await sendRich(chatId, esc(orientation(first)), await quickButtons(db));
    } else if (isGreeting(text)) {
      await sendRich(
        chatId,
        esc(await greetingReply(db, await displayName(db, chatId))),
        await quickButtons(db),
      );
    }
    return;
  }

  const name = await displayName(db, chatId);
  const { intent, action, reply } = await triageMessage(db, text, name);

  /*
   * "Interview me", "what's waiting?", "review my drafts" — things the bot has always been able to do,
   * but only if you knew the slash command. Said in plain words they used to become ideas in the
   * bank. Now they do the thing.
   */
  if (intent === "action" && action !== "none") {
    if (reply) await sendMessage(chatId, reply);
    await handleCommand(db, chatId, ACTION_TO_COMMAND[action]);
    await logEvent(db, "telegram_action_by_words", "info", { chat_id: chatId, action });
    return;
  }

  if (intent === "question" && reply) {
    // Every answer ends with something to tap. A reply you can only read is a dead end; the menu is
    // what turns "how does this work?" into actually starting.
    await sendRich(chatId, esc(reply), await quickButtons(db));
    await logEvent(db, "telegram_question_answered", "info", {
      chat_id: chatId,
      question: text.slice(0, 200),
    });
    return;
  }

  if (intent === "chatter") {
    await setState(db, "nothing", null);
    return;
  }

  await captureNewMoment(db, chatId, msg, text);
}

/** The words the model hears, mapped to the commands the bot already had. One list, no new paths. */
const ACTION_TO_COMMAND: Record<Exclude<BotAction, "none">, string> = {
  start_interview: "interview_me",
  show_waiting: "candidates",
  review_drafts: "review",
  status: "status",
  help: "help",
  stop: "stop",
};

/**
 * The same buttons /help shows, attached to an answer.
 *
 * Reused from helpMessage rather than written again, so a button added to the menu appears here too
 * and the two can never offer different things.
 */
async function quickButtons(db: SupabaseClient): Promise<Button[][]> {
  const help = helpMessage(await picture(db));
  // The first two rows — review, status, ask me, what's waiting. The rest are for people who already
  // know what a voice guide is, and a wall of eight buttons under a short answer reads as a menu
  // with a sentence attached rather than an answer with options.
  return help.buttons.slice(0, 2);
}

/** A message held while the bot asks whether it was an answer or a new thought. */
interface PendingMessage {
  text: string;
  message_id: number;
  voice_file_id: string | null;
  voice_duration: number | null;
  voice_mime: string | null;
}

/**
 * Act on a held message once Josh has said what it was.
 *
 * Reconstructs enough of a Telegram message for the normal handlers, so there is one capture path
 * and one answer path rather than duplicates that drift apart. The `file_id` survives the wait, so
 * a voice note held here is still downloadable and its audio is not lost (4.1.2).
 */
async function applyPending(
  db: SupabaseClient,
  chatId: number,
  momentId: number,
  pending: PendingMessage,
  as: "answer" | "new",
): Promise<void> {
  const rebuilt: Message = {
    message_id: pending.message_id,
    chat: { id: chatId },
    text: pending.text || undefined,
    voice: pending.voice_file_id
      ? {
        file_id: pending.voice_file_id,
        duration: pending.voice_duration ?? 0,
        mime_type: pending.voice_mime ?? undefined,
      }
      : undefined,
  };

  if (as === "answer") {
    await handleAnswer(db, chatId, momentId, rebuilt, pending.text);
  } else {
    await captureNewMoment(db, chatId, rebuilt, pending.text);
  }
  nudge();
}

/** 4.2.1 — a prompted session, started on his request. */
async function startPromptedSession(db: SupabaseClient, chatId: number): Promise<void> {
  const { data: moment } = await db.from("moments").insert({
    source: "prompted_session",
    status: "captured",
  }).select("id, ref").single();
  if (!moment) return;

  await db.from("raw_inputs").insert({
    moment_id: moment.id,
    kind: "text",
    text_body: "(prompted session — Josh asked to be run through questions)",
  });
  await enqueue(db, "interview_step", { moment_id: moment.id });
  await setState(db, "answer", moment.id);
  nudge();
}

/**
 * How long after a question a message is assumed to be its answer.
 *
 * Long enough to cover a normal back-and-forth with interruptions; short enough that tomorrow's
 * unrelated thought is not filed as a belated reply.
 */
const ANSWER_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * How long the 12.4 follow-up stays open.
 *
 * Much shorter than the answer window, and deliberately so. An interview question is something Josh
 * chose to engage with, so a belated reply is likely. The verdict question is one HE never asked
 * for — the system asked it — so the longer it stays open the more likely the next message is a new
 * thought being quietly eaten. Ten minutes covers "he types back straight away" and nothing else.
 */
const VERDICT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Ask whether this is a late answer or a new thought, holding the message until he says.
 *
 * The message is stored rather than acted on, so nothing is lost while the question sits there. A
 * voice note keeps its Telegram `file_id`, which stays valid, so the audio can still be fetched once
 * he taps.
 */
async function askWhichOne(
  db: SupabaseClient,
  chatId: number,
  momentId: number,
  msg: Message,
  text: string,
): Promise<void> {
  const voice = msg.voice ?? msg.audio;

  const { data: moment } = await db
    .from("moments").select("ref").eq("id", momentId).maybeSingle();

  const { data: turn } = await db
    .from("interview_turns")
    .select("body")
    .eq("moment_id", momentId)
    .eq("role", "question")
    .order("turn_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  await db.from("conversation_state").update({
    awaiting: "disambiguate",
    moment_id: momentId,
    context: {
      pending: {
        text,
        message_id: msg.message_id,
        voice_file_id: voice?.file_id ?? null,
        voice_duration: voice?.duration ?? null,
        voice_mime: voice?.mime_type ?? null,
      },
    },
    updated_at: new Date().toISOString(),
  }).eq("id", true);

  await sendMessage(
    chatId,
    `Quick check — I still had a question open on ${moment?.ref ?? "an earlier moment"}:\n\n` +
      `"${(turn?.body ?? "").slice(0, 200)}"\n\n` +
      `Is this about that, or something new?`,
    [[
      { text: "That question", data: `ans:${momentId}` },
      { text: "Something new", data: "new:" },
    ]],
  );
}

/* ── Capture ──────────────────────────────────────────────────────────────── */

async function captureNewMoment(
  db: SupabaseClient,
  chatId: number,
  msg: Message,
  text: string,
): Promise<void> {
  const voice = msg.voice ?? msg.audio;
  if (!voice && text.length === 0) return;

  // A courtesy reply is not a moment. Saying "okay thanks" after a conversation ends created a
  // whole idea-bank entry containing the words "Okay thanks", and 6.3 means nothing the system
  // creates can ever be removed — so junk accumulates permanently. Voice notes are exempt: nobody
  // records audio to say thanks.
  if (!voice && isChatter(text)) {
    await setState(db, "nothing", null);
    return;
  }

  const { data: moment, error } = await db.from("moments").insert({
    source: "raw_capture",
    status: "captured",
  }).select("id, ref").single();
  if (error || !moment) throw new Error(`could not create moment: ${error?.message}`);

  if (voice) {
    const { bytes } = await downloadFile(voice.file_id);
    const path = `${moment.id}/${msg.message_id}.ogg`;
    const { error: upload } = await db.storage
      .from("voice-notes")
      .upload(path, new Blob([bytes], { type: voice.mime_type ?? "audio/ogg" }), { upsert: true });
    if (upload) throw new Error(`could not store audio: ${upload.message}`);

    // 4.1.2 — both the audio and the transcript are kept. The transcript follows in the job.
    const { data: raw } = await db.from("raw_inputs").insert({
      moment_id: moment.id,
      kind: "voice",
      audio_path: path,
      duration_seconds: voice.duration,
      telegram_message_id: msg.message_id,
      text_body: text.length > 0 ? text : null,
    }).select("id").single();

    await enqueue(db, "transcribe", { raw_input_id: raw!.id, moment_id: moment.id });
    // 4.1.4 — he knows it landed, immediately, without waiting for transcription.
    //
    // Says what happens next, which the old one did not. "Got it (14s). Saved as M-000033." is
    // accurate and tells a person nothing: the reference is the least useful thing in the sentence
    // and it was the whole sentence.
    await sendMessage(
      chatId,
      `Got that — ${voice.duration}s. Transcribing it now, then I will ask you a couple of ` +
        `questions about it. (${moment.ref})`,
    );
  } else {
    await db.from("raw_inputs").insert({
      moment_id: moment.id,
      kind: "text",
      text_body: text,
      telegram_message_id: msg.message_id,
    });
    await enqueue(db, "interview_step", { moment_id: moment.id });
    await sendMessage(
      chatId,
      `Got it. I will ask you a couple of questions about this one in a moment — answer them ` +
        `whenever suits. (${moment.ref})`,
    );
  }

  await setState(db, "answer", moment.id);
}

/**
 * Acknowledgements, not material. Matched whole-string and deliberately narrow: "lost a deal today"
 * is short too, and must still become a moment. Only messages that are ENTIRELY courtesy are dropped.
 */
export function isChatter(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;

  // A bare @handle: somebody told to message @userinfobot who pasted it here instead. It happened
  // twice and both are permanent entries in the bank, because 6.3 does not care how it got there.
  if (/^@[A-Za-z0-9_]{3,}$/.test(t)) return true;

  // A typo correction on its own line — "post*", "*posts". Only when the whole message is one
  // starred word: "post* ideas" is somebody correcting themselves mid-thought and is material.
  if (/^\*?[\p{L}]+\*$|^\*[\p{L}]+$/u.test(t)) return true;

  // Emoji-only replies ("👍") are acknowledgements too.
  if (/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u.test(t)) return true;

  // Chatter is a message made ENTIRELY of courtesy words, checked token by token. A single-token
  // regex misses "okay thanks" — which is the exact phrase that created a junk moment.
  //
  // Any word outside the set means there is something real in there and it becomes a moment, so
  // "no one asked about pricing" and "ok so the demo fell over" both survive.
  const COURTESY = new Set([
    "ok", "okay", "k", "kk", "thanks", "thank", "you", "thankyou", "ty", "ta", "cool", "nice",
    "great", "good", "got", "it", "sure", "fine", "yep", "yup", "yeah", "yes", "no", "nope",
    "done", "perfect", "lovely", "cheers", "np", "worries", "alright", "brilliant", "super",
    // GREETINGS, absent until "Hello" became M-000030 and then M-000033. The set was built from
    // acknowledgement-after-the-fact — "okay thanks" — and at that point nobody had said hello to
    // it. A list assembled from one incident only covers that incident.
    "hi", "hey", "hello", "hiya", "yo", "morning", "afternoon", "evening", "gm", "howdy",
    "there", "sorry", "please", "welcome", "bye", "goodbye", "night",
  ]);

  const words = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => COURTESY.has(w));
}

/* ── Answering a question ─────────────────────────────────────────────────── */

async function handleAnswer(
  db: SupabaseClient,
  chatId: number,
  momentId: number,
  msg: Message,
  text: string,
): Promise<void> {
  let body = text;
  let audioPath: string | null = null;

  const voice = msg.voice ?? msg.audio;
  if (voice) {
    // 4.2.4 — spoken answers keep the thread going.
    const { bytes } = await downloadFile(voice.file_id);
    audioPath = `${momentId}/answer-${msg.message_id}.ogg`;
    await db.storage.from("voice-notes").upload(
      audioPath,
      new Blob([bytes], { type: voice.mime_type ?? "audio/ogg" }),
      { upsert: true },
    );
    const { transcribe } = await import("../_shared/stt.ts");
    const heard = await transcribe(bytes, voice.mime_type ?? "audio/ogg");
    body = heard.text;
    await noteProvider(db, heard.provider.split(":")[0], "transcription");
  }

  if (!body.trim()) return;

  await appendTurn(db, momentId, {
    role: "answer",
    body,
    question_key: null,
    depth: null,
    is_pushback: false,
    // deno-lint-ignore no-explicit-any
    ...(audioPath ? { audio_path: audioPath } as any : {}),
  });

  await enqueue(db, "interview_step", { moment_id: momentId });
  await setState(db, "answer", momentId);
}

/* ── Push-back on a draft (9.14) ──────────────────────────────────────────── */

async function handlePushback(
  db: SupabaseClient,
  chatId: number,
  momentId: number,
  draftId: number,
  msg: Message,
  text: string,
): Promise<void> {
  const voice = msg.voice ?? msg.audio;

  // 9.14 — "by voice or typed". The voice half was silently broken: `route()` hands this
  // `msg.text ?? msg.caption ?? ""`, so a voice reply arrived as an empty string and the old
  // version returned without a word. Josh would have recorded his objection, watched it be
  // received, and seen nothing happen.
  if (voice) {
    const { bytes } = await downloadFile(voice.file_id);
    const path = `${momentId}/pushback-${msg.message_id}.ogg`;
    const { error: upload } = await db.storage
      .from("voice-notes")
      .upload(path, new Blob([bytes], { type: voice.mime_type ?? "audio/ogg" }), { upsert: true });
    if (upload) throw new Error(`could not store push-back audio: ${upload.message}`);

    // 4.1.2's principle applies here too: the audio is kept, not just the words. What he objected
    // to is worth as much as the objection when the library is being tuned later.
    const { data: raw } = await db.from("raw_inputs").insert({
      moment_id: momentId,
      kind: "voice",
      audio_path: path,
      duration_seconds: voice.duration,
      telegram_message_id: msg.message_id,
    }).select("id").single();

    await enqueue(db, "transcribe", {
      raw_input_id: raw!.id,
      moment_id: momentId,
      draft_id: draftId,
      then: "pushback",
    });
    await sendMessage(chatId, `Got it (${voice.duration}s) — listening to that now.`);
    return;
  }

  // 9.15 — a revision goes back through the gate like any other draft. `pushBack` is shared with
  // the voice path above so the two cannot drift apart.
  if (await pushBack(db, momentId, draftId, text)) {
    await sendMessage(chatId, "On it — I will run the revision back through the checks.");
  }
}

/**
 * Open a candidate the automatic inputs surfaced (4.3.4).
 *
 * Triage already chose the question worth opening with, and stored it as the first turn. So it gets
 * ASKED, rather than thrown away in favour of a freshly generated one. That matters three ways: the
 * question was written while the transcript or session was in front of the model and is better for
 * it; Josh gets one message instead of a filler line followed by a question; and it costs nothing
 * where regenerating costs a model call.
 *
 * If triage left no question — it should not, but a stored row can always be missing — fall back to
 * the interview engine rather than sending nothing.
 */
async function openCandidate(
  db: SupabaseClient,
  chatId: number,
  momentId: number,
): Promise<void> {
  await db.from("moments").update({ status: "captured" }).eq("id", momentId);
  await setState(db, "answer", momentId);

  const { data: opening } = await db
    .from("interview_turns")
    .select("body")
    .eq("moment_id", momentId)
    .eq("role", "question")
    .order("turn_no")
    .limit(1)
    .maybeSingle();

  if (!opening?.body) {
    await enqueue(db, "interview_step", { moment_id: momentId });
    return;
  }

  const messageId = await sendMessage(chatId, opening.body);
  if (messageId) {
    await db.from("sent_messages").insert({
      telegram_message_id: messageId,
      kind: "question",
      moment_id: momentId,
    });
  }
}

/* ── The weekly pass, by tap (clause 11 step 07) ──────────────────────────── */

async function handleTap(
  db: SupabaseClient,
  cq: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } },
): Promise<void> {
  const action = parseAction(cq.data);
  const chatId = cq.message?.chat.id ?? joshChatId();
  const messageId = cq.message?.message_id;

  switch (action.kind) {
    case "schedule": {
      const raw = cq.data!.split(":")[2];
      const when = await schedulePost(
        db,
        action.postId,
        raw === "next-mon" ? "next-mon" : action.days,
      );
      // The message is replaced rather than added to, so the thread becomes a record of decisions
      // instead of a backlog of drafts with dead buttons under them.
      if (messageId) {
        await replaceMessage(chatId, messageId, `Scheduled for ${when}.`);
      }

      // 12.4, the positive half — "This one nailed it." Worth as much as the negative, because it
      // tells the system which of its guesses were RIGHT, and nothing else in the loop can say so:
      // an unedited approval shows the draft was acceptable, never what made it good.
      //
      // Once per pass. Five approvals producing five questions is the nagging 12.8 rules out
      // everywhere else, and it is how a question stops being read.
      if (!await askedPositiveRecently(db)) {
        const { data: sched } = await db
          .from("posts").select("draft_id").eq("id", action.postId).maybeSingle();
        const ask = verdictPrompt(false);
        await setState(db, "draft_verdict", null, {
          post_id: action.postId,
          draft_id: sched?.draft_id ?? null,
        });
        await sendMessage(chatId, ask.text, ask.buttons);
        await logEvent(db, "verdict_asked", "info", { post_id: action.postId, form: "positive" });
      }
      return;
    }

    case "pick":
      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          "Which day?",
          dayButtons(action.postId),
        );
      }
      return;

    // 12.4 — the single richest signal in the system, and it used to record nothing.
    //
    // The system guessed, Josh said no. What was wrong with it is the most direct evidence available
    // of what to change, it costs him one line, and until now the tap reverted the post and threw
    // the reason away. Asked here rather than offered as a button he has to find: the web app has
    // had a verdict box since the first build and has collected exactly none.
    case "hold": {
      await holdPost(db, action.postId);

      const { data: held } = await db
        .from("posts").select("draft_id").eq("id", action.postId).maybeSingle();

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          "Left as a draft. It stays in the calendar until you want it.",
        );
      }

      const ask = verdictPrompt(true);
      await setState(db, "draft_verdict", null, {
        post_id: action.postId,
        draft_id: held?.draft_id ?? null,
      });
      await sendMessage(chatId, ask.text, ask.buttons);
      await logEvent(db, "verdict_asked", "info", { post_id: action.postId, form: "negative" });
      return;
    }

    case "rewrite": {
      /*
       * REWRITES HAPPEN IN CLAUDE. THIS USED TO SEND A LINK TO THE DESK.
       *
       * "Open it here to rewrite: <link>" pointed at a textarea on the web app, and for a while at
       * a dead deployment. The desk is now a read-only view, and drafting moved to Claude — so the
       * button says how a rewrite actually happens, and both routes end in the same place: a
       * pending draft job carrying his note, which Claude picks up through next_work.
       */
      const { data: post } = await db
        .from("posts").select("draft_id, drafts(moment_id, moments(ref))").eq("id", action.postId)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const ref = (post as any)?.drafts?.moments?.ref as string | undefined;

      await sendMessage(
        chatId,
        `Two ways to rewrite ${ref ?? "this one"}:\n\n` +
          `Reply to the draft above with what you would change. I will queue the rewrite with your ` +
          `note attached.\n\n` +
          `Or open Claude and say "rewrite ${ref ?? "this draft"}" to work through it there.`,
      );
      return;
    }

    // ── Disambiguation: the held message was an answer after all ─────────────
    case "answer": {
      const state = await getState(db);
      const pending = (state.context?.pending ?? null) as PendingMessage | null;
      await setState(db, "answer", action.momentId);

      if (messageId) await replaceMessage(chatId, messageId, "Right — treating that as the answer.");
      if (pending) await applyPending(db, chatId, action.momentId, pending, "answer");
      return;
    }

    // ── Disambiguation: it was something new ─────────────────────────────────
    case "newthought": {
      const state = await getState(db);
      const pending = (state.context?.pending ?? null) as PendingMessage | null;
      await setState(db, "nothing", null);

      if (messageId) await replaceMessage(chatId, messageId, "Got it — starting a new one.");
      if (pending) await applyPending(db, chatId, 0, pending, "new");
      return;
    }

    // ── Declining the candidates in favour of the prompt set (4.2) ───────────
    case "prompted": {
      if (messageId) {
        await replaceMessage(chatId, messageId, "Fine — let me ask you some questions instead.");
      }
      await startPromptedSession(db, chatId);
      return;
    }

    // 5.10 — Josh correcting the pillar the interview chose.
    case "pillar": {
      if (action.index < 0) {
        if (messageId) await replaceMessage(chatId, messageId, "Left as it was.");
        return;
      }
      const lib = await loadLibrary(db, "interview");
      const names = parsePillars(lib.sections.pillars ?? "");
      const chosen = names[action.index];
      if (!chosen) return;

      await db.from("moments").update({
        pillar: chosen,
        updated_at: new Date().toISOString(),
      }).eq("id", action.momentId);

      if (messageId) await replaceMessage(chatId, messageId, `Refiled under ${chosen}.`);
      return;
    }

    // 6.4 — the promise made in every park message, finally with something behind it.
    case "reopen": {
      await db.from("moments").update({
        status: "captured",
        parked_reason: null,
        // A new session on an old moment: 5.3 and 5.8 count from here, not from the first capture.
        reopened_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", action.momentId);

      // Point the conversation at it so what he says next lands on THIS row rather than opening a
      // new one — which is what used to happen, leaving the parked moment orphaned.
      await setState(db, "answer", action.momentId);

      // And ask him something, rather than only waiting. Pointing the state at the moment is not
      // enough on its own: the routing rule that files a message as an answer requires an open
      // question, so without one his next message would fall through and open a brand new moment —
      // the exact failure re-opening exists to fix. Asking is also what 6.4 means by "goes back
      // into the queue": the interviewer picks it up where it left off.
      await enqueue(db, "interview_step", { moment_id: action.momentId });
      nudge();

      const { data: reopened } = await db
        .from("moments").select("ref").eq("id", action.momentId).maybeSingle();

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          "Reopened " + (reopened?.ref ?? "it") + ". One question coming — tell me what you remember.",
        );
      }
      return;
    }

    /*
     * The four ways out of an interview, from the daily roundup or from any question.
     *
     * All four are deliberately cheap: none of them calls a model except `skipq`, which has to ask
     * something else and cannot know what without one. A button that costs a request is a button
     * that stops working when the free tier runs out, and these are exactly the buttons that must
     * work on the day he has stopped replying.
     */

    // "Answer" — he wants to deal with this one now. Point the conversation at it and show him the
    // question again rather than generating a fresh one: re-asking would spend a model call to
    // replace a question he has already read, and might replace it with a worse one.
    case "resume": {
      const { data: q } = await db
        .from("interview_turns")
        .select("body")
        .eq("moment_id", action.momentId)
        .eq("role", "question")
        .order("turn_no", { ascending: false })
        .limit(1)
        .maybeSingle();

      await setState(db, "answer", action.momentId);
      await logEvent(db, "interview_resumed_by_josh", "info", { moment_id: action.momentId });

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          q?.body ? `${q.body as string}\n\n(Answer whenever — text or voice.)` : "Tell me about that one.",
        );
      }
      return;
    }

    // "Skip" — the question is wrong, not the moment. Recorded as a turn so the interviewer can see
    // he declined it and asks something else; without the turn it would have no way to know and
    // would be free to ask the same thing again, which is the nagging the prompt warns about.
    case "skipq": {
      await appendTurn(db, action.momentId, {
        role: "answer",
        body: "(skipped that question)",
        question_key: null,
        depth: null,
        is_pushback: false,
      });
      await enqueue(db, "interview_step", { moment_id: action.momentId });
      nudge();
      await logEvent(db, "interview_question_skipped", "info", { moment_id: action.momentId });

      if (messageId) await replaceMessage(chatId, messageId, "Fair enough — let me try a different one.");
      return;
    }

    // "That is enough, write it up" — clause 5 already calls a scene with no lesson a real outcome.
    // This is Josh being able to say so, instead of the system deciding it for him after a
    // fortnight of silence. Extraction decides whether what is there is material or a park.
    case "enough": {
      await enqueue(db, "interview_extract", { moment_id: action.momentId });
      nudge();
      await logEvent(db, "interview_ended_by_josh", "info", { moment_id: action.momentId });

      if (messageId) {
        await replaceMessage(chatId, messageId, "Got it — I will write it up with what I have.");
      }
      return;
    }

    // "Park it" — 6.3, so nothing is deleted. The reason names him, because a moment parked by the
    // system and one parked by Josh are different facts and the bank should not blur them.
    case "parkit": {
      await park(db, action.momentId, "You parked this one. Send me more about it any time.");
      await setState(db, "nothing", null);
      await logEvent(db, "moment_parked", "info", {
        moment_id: action.momentId,
        reason: "parked by Josh from a button",
      });

      if (messageId) await replaceMessage(chatId, messageId, "Parked. It stays in the bank.");
      return;
    }

    // 10.2 — the third question, asked rather than guessed.
    case "imgpick": {
      const { data: state } = await db
        .from("conversation_state").select("context").eq("id", true).maybeSingle();
      const sourcePath = (state?.context as { source_path?: string } | null)?.source_path;
      if (!sourcePath) {
        if (messageId) await replaceMessage(chatId, messageId, "I have lost track of that image — send it again.");
        return;
      }

      const { data: options } = await db
        .from("moments")
        .select("id, ref, pillar, material(the_moment)")
        .not("status", "in", '("parked","published")')
        .eq("killed", false)
        .order("captured_at", { ascending: false })
        .limit(6);

      if (!options || options.length === 0) {
        if (messageId) await replaceMessage(chatId, messageId, "There is nothing else open to put it with.");
        return;
      }

      const rows = options.map((o) => {
        // deno-lint-ignore no-explicit-any
        const mat = (o as any).material;
        const one = Array.isArray(mat) ? mat[0] : mat;
        const label = (one?.the_moment ?? o.pillar ?? "").toString().slice(0, 24);
        return [{ text: label ? `${o.ref} — ${label}` : o.ref, data: `img:${o.id}` }];
      });

      if (messageId) {
        await replaceMessage(chatId, messageId, "Which one does it go with?", rows);
      }
      return;
    }

    case "imgmoment": {
      const { data: state } = await db
        .from("conversation_state").select("context").eq("id", true).maybeSingle();
      const sourcePath = (state?.context as { source_path?: string } | null)?.source_path;

      // The raw input followed the guess, so it moves with the correction. Leaving it behind would
      // file the image against a moment it has nothing to do with, and 6.3 means it stays there.
      if (sourcePath) {
        await db.from("raw_inputs")
          .update({ moment_id: action.momentId })
          .eq("image_path", sourcePath);
      }

      await setState(db, "visual_details", action.momentId, { source_path: sourcePath });

      const { data: m } = await db
        .from("moments").select("ref").eq("id", action.momentId).maybeSingle();

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          `Right — with ${m?.ref ?? "that one"}.

` +
            `What are you taking from it: the idea, the structure, or just the look? And what is ` +
            `the post doing?`,
        );
      }
      return;
    }

    // 12.10 — his call on a library change, made where he already is.
    // 12.4 — "nothing specific" is a real answer, not a failure to answer. Offering it is what
    // stops the question sitting there looking like it needs something.
    case "noverdict": {
      await setState(db, "nothing", null);
      if (messageId) {
        await replaceMessage(chatId, messageId, "Fair enough. Nothing waiting on you.");
      }
      return;
    }

    // A tap on the help or status menu. Routed through handleCommand so a tap and a typed command
    // cannot drift apart — there is one implementation of "review", not two.
    case "menu": {
      if (action.go === "rule") {
        await sendRich(chatId, ruleHelp());
        return;
      }
      const map: Record<string, string> = {
        review: "review",
        status: "status",
        ask: "interview_me",
        candidates: "candidates",
        voiceguide: "voiceguide",
        seed: "seed",
        help: "help",
      };
      const kind = map[action.go];
      if (kind) await handleCommand(db, chatId, kind);
      return;
    }

    case "proposal": {
      const result = await decideProposal(db, action.proposalId, action.approve);

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          !result.ok
            ? `I could not apply that: ${result.error}`
            : action.approve
            ? `Done — ${result.sectionKey.replace(/_/g, " ")} updated${
              result.version ? `, library v${result.version}` : ""
            }. It applies to the next draft, and you can roll it back from the library any time.`
            : `Left it as it was.`,
        );
      }
      return;
    }

    // 9.10 — clearance is granted per name and per post. One tap, one name.
    case "name": {
      await db.from("moment_names").update({
        cleared: action.cleared,
        cleared_at: action.cleared ? new Date().toISOString() : null,
      }).eq("id", action.nameId);

      const { data: n } = await db
        .from("moment_names").select("name, moment_id").eq("id", action.nameId).maybeSingle();

      // Once nothing is left uncleared, stop waiting on it — otherwise the next unrelated message
      // gets read as an answer to a question that is finished with.
      if (n?.moment_id) {
        const { count: left } = await db
          .from("moment_names")
          .select("*", { count: "exact", head: true })
          .eq("moment_id", n.moment_id)
          .eq("cleared", false);

        if ((left ?? 0) === 0) {
          const { data: st } = await db
            .from("conversation_state").select("awaiting, moment_id").eq("id", true).maybeSingle();
          if (st?.awaiting === "name_clearance" && st.moment_id === n.moment_id) {
            await setState(db, "nothing", null);
          }
        }
      }

      if (messageId) {
        await answerCallback(
          cq.id,
          action.cleared ? `${n?.name ?? "Name"} is fine to use` : `I will not name ${n?.name ?? "them"}`,
        );
      }
      return;
    }

    // 8.8 — which section the rule belongs in, when its own words did not say.
    case "rulesection": {
      const { data: st } = await db
        .from("conversation_state").select("context").eq("id", true).maybeSingle();
      const pending = (st?.context as { pending_rule?: string } | null)?.pending_rule;

      await db.from("conversation_state").update({
        context: {},
        updated_at: new Date().toISOString(),
      }).eq("id", true);

      const key = RULE_SECTIONS[action.index];
      if (!pending || !key) {
        if (messageId) await replaceMessage(chatId, messageId, "I have lost track of that rule — send it again.");
        return;
      }

      await appendRule(db, key, pending);

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          `Added to ${sectionName(key)}:

"${pending}"

It applies to the next draft. Edit or ` +
            `roll it back in the library any time.`,
        );
      }
      return;
    }

    // 8.1 — his call on whether a typed line belongs in the voice guide.
    case "voiceguide": {
      const { data: st } = await db
        .from("conversation_state").select("context").eq("id", true).maybeSingle();
      const pending = (st?.context as { pending_voice_guide?: string } | null)?.pending_voice_guide;

      await db.from("conversation_state").update({
        context: {},
        updated_at: new Date().toISOString(),
      }).eq("id", true);

      if (!pending) {
        if (messageId) await replaceMessage(chatId, messageId, "I have lost track of that one.");
        return;
      }

      if (!action.keep) {
        if (messageId) await replaceMessage(chatId, messageId, "Left it out. Keep talking.");
        return;
      }

      const { data: section } = await db
        .from("library_sections").select("body").eq("key", "voice_transcript").maybeSingle();
      const stamp = new Date().toISOString().slice(0, 10);

      await db.from("library_sections").update({
        body: `${(section?.body ?? "").trimEnd()}

---

## Added ${stamp}

${pending}
`,
      }).eq("key", "voice_transcript");

      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          `Added ${pending.split(/s+/).filter(Boolean).length} words to the voice interview.`,
        );
      }
      return;
    }

    case "candidate":
      if (messageId) await replaceMessage(chatId, messageId, "Right, let me ask you about that one.");
      await openCandidate(db, chatId, action.momentId);
      return;

    case "conversation": {
      await recordConversation(db, action.postId, action.answer);
      const said: Record<string, string> = {
        none: "Noted — nothing came of it.",
        comment_thread: "Noted — a comment thread.",
        dm: "Noted — a DM.",
        call: "Noted — a call.",
        client: "Noted — a client. That is the one that matters.",
      };
      if (messageId) {
        await replaceMessage(
          chatId,
          messageId,
          said[action.answer] ?? "Noted.",
        );
      }
      return;
    }

    default:
      return;
  }
}

/* ── Names (9.12) ─────────────────────────────────────────────────────────── */

/**
 * 9.10 makes permission per post, so a blanket "yes" here clears these names for THIS moment only.
 * Anything ambiguous leaves them uncleared: 9.12 says if permission is not given, the system
 * anonymises or parks — it does not quietly ship a version that identifies them.
 */
async function handleNameClearance(
  db: SupabaseClient,
  chatId: number,
  state: { moment_id: number | null; context: Record<string, unknown> },
  text: string,
): Promise<void> {
  // Two ways in, and they know different things.
  //
  // The conversation state carries `name_ids` because it was set when the question was asked. A
  // REPLY to the question carries only the moment — which is the whole point of the reply route: it
  // works when the conversation has moved on to something else, so a seeding sitting is not stopped
  // by a moment that mentions someone. Resolve from the moment when the context is empty, or the
  // reply answers a question about no names at all.
  let ids = (state.context.name_ids ?? []) as number[];

  if (ids.length === 0 && state.moment_id) {
    const { data: open } = await db
      .from("moment_names")
      .select("id")
      .eq("moment_id", state.moment_id)
      .eq("cleared", false);
    ids = (open ?? []).map((n) => n.id);
  }

  if (ids.length === 0) return;

  const { data: names } = await db
    .from("moment_names")
    .select("id, name")
    .in("id", ids);

  const lowered = text.toLowerCase().trim();
  const now = new Date().toISOString();
  let clearedCount = 0;

  if (/^(yes|yep|yeah|sure|fine|ok|okay|go ahead|all)\b/.test(lowered)) {
    await db.from("moment_names").update({ cleared: true, cleared_at: now, cleared_note: text })
      .in("id", ids);
    clearedCount = ids.length;
  } else if (/^(no|nope|don't|dont|not|none)\b/.test(lowered)) {
    clearedCount = 0;
  } else {
    // He named the ones that are fine.
    for (const n of names ?? []) {
      if (lowered.includes(n.name.toLowerCase())) {
        await db.from("moment_names").update({ cleared: true, cleared_at: now, cleared_note: text })
          .eq("id", n.id);
        clearedCount++;
      }
    }
  }

  // Only release the conversation if it was actually waiting on THIS. A reply arriving mid-sitting
  // answers its own question and must not end the sitting — clearing the state here is what silently
  // stopped a cold start at the first moment with a person in it.
  const { data: current } = await db
    .from("conversation_state").select("awaiting, moment_id").eq("id", true).maybeSingle();
  if (current?.awaiting === "name_clearance" && current.moment_id === state.moment_id) {
    await setState(db, "nothing", null);
  }

  await sendMessage(
    chatId,
    clearedCount === 0
      ? "Understood — I will write it without naming anyone, and without details that would identify them."
      : clearedCount === ids.length
      ? "Noted, I can use them in this post."
      : `Noted — ${clearedCount} of ${ids.length} cleared. The rest stay anonymous.`,
  );
}

/* ── Images (clause 10) ───────────────────────────────────────────────────── */

async function handleImage(db: SupabaseClient, chatId: number, msg: Message): Promise<void> {
  const largest = msg.photo!.reduce((a, b) => (a.width > b.width ? a : b));
  const { bytes } = await downloadFile(largest.file_id);

  // Attach to the moment most likely to want it: the most recent one still in play.
  const { data: moment } = await db
    .from("moments")
    .select("id, ref")
    .not("status", "in", '("parked","published")')
    .eq("killed", false)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!moment) {
    await sendMessage(
      chatId,
      "Send me the thought this image goes with first, then send the image — I need to know what " +
        "the post is doing before I can rebuild it usefully.",
    );
    return;
  }

  const path = `${moment.id}/ref-${msg.message_id}.jpg`;
  await db.storage.from("images").upload(path, new Blob([bytes], { type: "image/jpeg" }), {
    upsert: true,
  });
  await db.from("raw_inputs").insert({
    moment_id: moment.id,
    kind: "image",
    image_path: path,
    telegram_message_id: msg.message_id,
  });

  await setState(db, "visual_details", moment.id, { source_path: path });

  // 10.2 asks THREE things, and the third was being guessed rather than asked: "what he is taking
  // from it, what the post is doing, and which moment it goes with."
  //
  // The guess — the most recent moment still in play — is usually right and worth keeping as the
  // default, because making him pick from a list every time would be worse than the occasional
  // correction. But a wrong guess binds the image to the wrong post silently, and he would find out
  // when the wrong picture went out under his name. One button turns the assumption into an answer.
  const sent = await sendMessage(
    chatId,
    `Got the image — I will put it with ${moment.ref}.\n\n` +
      `What are you taking from it: the idea, the structure, or just the look?\n` +
      `And what is the post doing?`,
    [[{ text: `Not ${moment.ref} — a different one`, data: "imgpick:" }]],
  );
  await recordSent(db, sent, "visual_prompt", moment.id);
}

async function startVisual(
  db: SupabaseClient,
  chatId: number,
  state: { moment_id: number | null; context: Record<string, unknown> },
  text: string,
): Promise<void> {
  const lowered = text.toLowerCase();
  const taking = lowered.includes("structure")
    ? "structure"
    : lowered.includes("look") || lowered.includes("style")
    ? "look"
    : "idea";

  await enqueue(db, "visual", {
    moment_id: state.moment_id,
    source_path: state.context.source_path,
    taking,
    post_doing: text,
  });
  // Held so 10.6 works: "another" reruns with the same reference and intent rather than starting
  // the whole exchange again.
  await setState(db, "visual_feedback", state.moment_id, {
    source_path: state.context.source_path,
    taking,
    post_doing: text,
  });
  await sendMessage(chatId, `Rebuilding it, taking the ${taking}. One moment.`);
}

/* ── Commands ─────────────────────────────────────────────────────────────── */

async function handleCommand(db: SupabaseClient, chatId: number, kind: string): Promise<void> {
  switch (kind) {
    case "help": {
      // Registered here rather than in a setup script, because a setup script is a thing someone has
      // to remember to run. Idempotent, one request, and not awaited — the help message must not wait
      // on it, and a missing menu is cosmetic.
      registerCommands();

      const p = await picture(db);
      const help = helpMessage(p);
      await sendRich(chatId, help.html, help.buttons);
      return;
    }

    case "interview_me": {
      // 4.3.4 — "When Josh next opens a session, the system must raise waiting candidates and run
      // the follow-up interview on them." Anything the calls or Claude Code turned up gets offered
      // before we fall back to the prompt set, because a real moment beats a cold question.
      if (await offerCandidates(db, chatId, { quietIfNone: true })) return;

      // 4.2.1 — starts on his request, in the same place, with no scheduling.
      await startPromptedSession(db, chatId);
      return;
    }

    case "candidates":
      await offerCandidates(db, chatId, { quietIfNone: false });
      return;

    case "review":
      // Clause 11 step 07, done where Josh already is (12.7).
      await startWeeklyPass(db, chatId);
      return;

    case "voiceguide": {
      // 8.1 — "the voice guide comes from a recorded interview where he talks at length in his own
      // words, and that transcript is the source of truth." It is on the critical path with no date
      // attached (8.2), so the least this can do is make starting it a single command.
      await setState(db, "voice_guide_capture", null);
      await sendMessage(
        chatId,
        "Talk to me. Not about how you write — just tell me things.\n\n" +
          "Stories about work, what you have changed your mind on, what a client said that stuck. " +
          "Twenty minutes of that is worth more than an hour describing your style.\n\n" +
          "Record as many notes as you like and they all append. /stop when you have had enough.\n\n" +
          "This becomes the source of truth for how you sound — not your old posts, which were " +
          "written with a lot of AI help and drifted.",
      );
      return;
    }

    case "seed": {
      // Clause 6 — "a long, deliberate interview aimed at filling the bank with twenty to thirty
      // mined moments before anything else runs". A sitting, not a schedule: it starts when he says
      // so and ends when he says so, and what is already banked counts towards it.
      const target = await getSetting(db, "seed_target", 25);
      const { count: mined } = await db
        .from("moments").select("*", { count: "exact", head: true })
        .in("status", ["mined", "queued", "drafted", "gated", "scheduled", "published"]);

      await sendMessage(
        chatId,
        `${mined ?? 0} of ${target} moments in the bank.

` +
          "I will keep going, one straight into the next, until we get there. /stop whenever you " +
          "have had enough — everything you have given me is kept either way.",
      );
      await startNextSeedMoment(db);
      nudge();
      return;
    }

    case "status": {
      const p = await picture(db);
      const st = statusMessage(p);
      await sendRich(chatId, st.html, st.buttons);
      return;
    }

    case "stop": {
      // 4.2.5 — he can stop at any point and everything captured is kept.
      const state = await getState(db);
      if (state.moment_id) {
        await enqueue(db, "interview_extract", { moment_id: state.moment_id });
      }
      const wasSeeding = state.awaiting === "seeding";
      await setState(db, "nothing", null);
      await sendMessage(
        chatId,
        wasSeeding
          ? "Stopped the seeding session there. Everything you gave me is saved — /seed picks it " +
            "up again from where the bank stands."
          : "Stopped there. Everything you gave me is saved.",
      );
      return;
    }
  }
}

/**
 * 8.8 — a rule, added in seconds, from wherever he is.
 *
 * The library is editable in the app (8.5) and that is the right place to rewrite a section. It is
 * the wrong place for "stop using the word journey", which is a thought he has while walking: find
 * the section among fourteen, expand it, scroll a thousand characters, get the markdown right, save.
 * On a phone that is the same miserable textarea this build already refused to use for rewriting a
 * post — and 8.8 says under a minute precisely "because that is how it will actually get
 * maintained".
 *
 * Where the section is obvious from the words, it goes straight in. Where it is not, he taps. The
 * appended line is marked with the date so a rule added in haste can be found later.
 */
async function addRule(db: SupabaseClient, chatId: number, text: string): Promise<void> {
  if (!text) {
    await sendMessage(
      chatId,
      "Give me the rule after the command — /rule never use the word journey.\n\n" +
        "I will work out which part of the library it belongs in, or ask if it is not obvious.",
    );
    return;
  }

  const guess = guessSection(text);

  if (guess) {
    await appendRule(db, guess, text);
    await sendMessage(chatId, `Added to ${sectionName(guess)}. It applies to the next draft.`);
    return;
  }

  await db.from("conversation_state").update({
    context: { pending_rule: text },
    updated_at: new Date().toISOString(),
  }).eq("id", true);

  const rows = chunkButtons(
    RULE_SECTIONS.map((k, i) => ({ text: sectionName(k), data: `sect:${i}` })),
    2,
  );

  await sendMessage(chatId, `"${text}"

Which part of the library?`, rows);
}

/** The sections a one-line rule can sensibly go in. Deliberately not all fourteen. */
const RULE_SECTIONS = [
  "hooks",
  "closes",
  "formatting",
  "banned_phrases",
  "frameworks",
  "gate_rules",
  "audience",
  "voice_guide",
] as const;

function sectionName(key: string): string {
  return key.replace(/_/g, " ");
}

/**
 * Where a rule obviously belongs, from its own words.
 *
 * Deliberately conservative: a wrong guess puts a rule somewhere he will never find it, and asking
 * costs one tap. Silence here means "ask", not "pick the most likely".
 */
function guessSection(text: string): string | null {
  // Plain phrase matching rather than a regular expression.
  //
  // Not a style preference: the regex version returned null in production for input it matched
  // locally under the same Deno version, and chasing that through the bundler was costing more
  // than the feature is worth. Phrase matching cannot be mangled by an escape, a heredoc or a
  // minifier, and for "which section does this rule belong in" it is entirely adequate.
  //
  // Deliberately conservative. A wrong guess files a rule where he will never find it again;
  // returning null costs one tap. When in doubt this must say nothing.
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const has = (...phrases: string[]) => phrases.some((p) => t.includes(` ${p} `));

  if (has("never say", "never use", "never write", "banned", "stop using", "avoid the word")) {
    return "banned_phrases";
  }
  if (has("hook", "hooks", "opener", "first line", "opening line", "open with")) return "hooks";
  if (has("close", "closes", "closing", "ending", "cta", "end with", "call to action", "sign off")) {
    return "closes";
  }
  if (has("character", "characters", "emoji", "hashtag", "hashtags", "paragraph", "paragraphs", "length", "formatting", "line break", "line breaks")) {
    return "formatting";
  }
  if (has("reject", "fail the gate", "do not send", "gate")) return "gate_rules";
  return null;
}

async function appendRule(db: SupabaseClient, key: string, text: string): Promise<void> {
  const { data: section } = await db
    .from("library_sections").select("body").eq("key", key).maybeSingle();

  const stamp = new Date().toISOString().slice(0, 10);
  const line = text.replace(/^[-*]s*/, "").trim();

  await db.from("library_sections").update({
    body: `${(section?.body ?? "").trimEnd()}

- ${line}  _(added ${stamp})_
`,
  }).eq("key", key).eq("immutable", false);
}

function chunkButtons<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/**
 * 8.1 — a recording for the voice guide, rather than a moment.
 *
 * Typed text is accepted too: he may have had the interview transcribed elsewhere, and refusing a
 * paste because it did not arrive as audio would be pedantry.
 */
async function captureVoiceGuide(
  db: SupabaseClient,
  chatId: number,
  msg: Message,
  text: string,
): Promise<void> {
  const voice = msg.voice ?? msg.audio;

  if (!voice) {
    if (!text.trim()) return;

    // 8.1 asks for a recorded interview in which Josh TALKS. A line typed while capture is running
    // is far more often a stray thought than guide content — two of his questions to me ended up in
    // the section the drafter reads as evidence of how he sounds, because anything typed went
    // straight in. Voice is unambiguous and stays automatic; typed text is asked about.
    //
    // The pasted-transcript case the section invites still works: one tap.
    await db.from("conversation_state").update({
      context: { pending_voice_guide: text },
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    await sendMessage(
      chatId,
      `Add that to the voice interview?

"${text.slice(0, 200)}${text.length > 200 ? "…" : ""}"`,
      [[
        { text: "Yes, it is mine", data: "vgy:" },
        { text: "No, ignore it", data: "vgn:" },
      ]],
    );
    return;
  }

  const { bytes } = await downloadFile(voice.file_id);
  const path = `voice-guide/${msg.message_id}.ogg`;
  const { error: upload } = await db.storage
    .from("voice-notes")
    .upload(path, new Blob([bytes], { type: voice.mime_type ?? "audio/ogg" }), { upsert: true });
  if (upload) throw new Error(`could not store voice guide audio: ${upload.message}`);

  const { data: rec } = await db.from("library_recordings").insert({
    section_key: "voice_transcript",
    audio_path: path,
    duration_seconds: voice.duration,
    telegram_message_id: msg.message_id,
  }).select("id").single();

  await enqueue(db, "transcribe", { recording_id: rec!.id, then: "voice_guide" });
  await sendMessage(chatId, `Got it (${voice.duration}s). Keep going — /stop when you are done.`);
}

/**
 * 4.3.4 + 7.5 — raise waiting candidates, "with only the strongest few raised in any one session.
 * The rest wait their turn."
 *
 * Returns true if candidates were offered, so the caller knows not to start a cold prompted session.
 */
async function offerCandidates(
  db: SupabaseClient,
  chatId: number,
  opts: { quietIfNone: boolean },
): Promise<boolean> {
  const { data: setting } = await db
    .from("settings").select("value").eq("key", "candidates_per_session").maybeSingle();
  const limit = Number(setting?.value ?? 3);

  const { data } = await db
    .from("moments")
    .select("id, ref, source, strength, notes")
    .eq("status", "half_mined")
    .eq("killed", false)
    .order("strength", { ascending: false, nullsFirst: false })
    .order("captured_at", { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) {
    if (!opts.quietIfNone) {
      await sendMessage(
        chatId,
        "Nothing waiting from your calls or Claude Code. A quiet week is a normal week.",
      );
    }
    return false;
  }

  const lines = data
    .map((c, i) => `${i + 1}. ${(c.notes ?? c.ref).split("\n")[0]}`)
    .join("\n\n");

  // One tap per candidate, and — importantly — a way to decline.
  //
  // Without the last button, /ask could never reach the prompt set: candidates arrive continuously
  // from calls and Claude Code, so there is nearly always one waiting, and the command returned
  // early every time. Clause 4.2 calls the prompt set "the input that fills the well when nothing
  // obvious has happened", and it was unreachable in practice.
  const buttons = data.map((c, i) => [{ text: `${i + 1}`, data: `cand:${c.id}` }]);
  buttons.push([{ text: "Something else — just ask me questions", data: "prompt:" }]);

  const messageId = await sendMessage(
    chatId,
    `A few things came up that might be worth writing about:\n\n${lines}\n\n` +
      `Tap one, or ask me for questions instead. These will keep either way.`,
    buttons,
  );

  // Ids are still held in state so a typed "2" works as well as a tap.
  await db.from("conversation_state").update({
    awaiting: "candidate_choice",
    moment_id: null,
    context: { candidate_ids: data.map((c) => c.id) },
    updated_at: new Date().toISOString(),
  }).eq("id", true);

  if (messageId) {
    await db.from("sent_messages").insert({ telegram_message_id: messageId, kind: "candidates" });
  }
  return true;
}

/* ── State helpers ────────────────────────────────────────────────────────── */

async function getState(db: SupabaseClient) {
  const { data } = await db.from("conversation_state").select("*").eq("id", true).single();
  return data ?? { awaiting: "nothing", moment_id: null, context: {} };
}

async function setState(
  db: SupabaseClient,
  awaiting: Awaiting,
  momentId: number | null,
  context: Record<string, unknown> = {},
): Promise<void> {
  await db.from("conversation_state").update({
    awaiting,
    moment_id: momentId,
    context,
    updated_at: new Date().toISOString(),
  }).eq("id", true);
}

async function recordSent(
  db: SupabaseClient,
  messageId: number | void,
  kind: string,
  momentId: number | null,
  draftId: number | null = null,
): Promise<void> {
  if (typeof messageId !== "number") return;
  await db.from("sent_messages").insert({
    telegram_message_id: messageId,
    kind,
    moment_id: momentId,
    draft_id: draftId,
  });
}

/**
 * Has the positive 12.4 question already gone out this pass?
 *
 * Read from `system_events` rather than tracked in `conversation_state`, because the state is
 * overwritten constantly by everything else in the ladder and would forget. The event log is already
 * the record of what the system said to Josh and when, so the answer is there for the asking — and
 * it stays visible afterwards, which a private counter would not be.
 */
async function askedPositiveRecently(db: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("system_events")
    .select("*", { count: "exact", head: true })
    .eq("kind", "verdict_asked")
    .eq("detail->>form", "positive")
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

/**
 * Learn who this is, once, without asking.
 *
 * Returns their name only on FIRST contact, so the orientation is sent once and never again. A
 * returning chat gets null and the conversation simply continues, which is what a returning chat
 * wants.
 */
async function ensureKnown(
  db: SupabaseClient,
  chatId: number,
  msg: Message,
): Promise<string | null> {
  const existing = await displayName(db, chatId);
  if (existing) return null;

  // Telegram's own name for them. readName is kept for the rare case where it is missing — a
  // channel post, or a client that strips it — and even then nothing is blocked on the answer.
  const given = (msg.from?.first_name ?? "").trim();
  const name = given ? given.slice(0, 40) : readName(msg.text ?? "") ?? "";
  if (!name) return null;

  await setDisplayName(db, chatId, name);
  return name;
}

/**
 * What to say once, to somebody who has just arrived.
 *
 * Three sentences, because the bot's whole job has to be guessable from its first message and the
 * previous version explained nothing — it asked a question and then asked it again.
 */
function orientation(name: string): string {
  return `Hello ${name}. Send me anything worth remembering and I will ask a few questions to ` +
    `turn it into a post — a voice note while you are walking is the intended way, and half a ` +
    `sentence is enough to start.\n\n` +
    `You can also just ask me things: what is waiting on you, what is ready to write, what ` +
    `happened to a draft. /help has the rest.`;
}

/**
 * A greeting opens a conversation. An acknowledgement closes one.
 *
 * Both are chatter and neither becomes a moment, but they want opposite replies: "hi" wants an
 * answer, "thanks" wants to be left alone. Treating them alike meant three greetings in a row got
 * silence.
 */
export function isGreeting(text: string): boolean {
  const words = text.trim().toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  const OPENERS = new Set([
    "hi", "hey", "hello", "hiya", "yo", "howdy", "morning", "afternoon", "evening", "gm",
    "there", "good", "you",
  ]);
  // "good" and "you" are in the set so "good morning" and "hey you" match, but a message made only
  // of those is not a greeting — "good" on its own is somebody agreeing with something.
  const STANDALONE = new Set(["hi", "hey", "hello", "hiya", "yo", "howdy", "gm", "morning"]);
  return words.every((w) => OPENERS.has(w)) && words.some((w) => STANDALONE.has(w));
}

/**
 * What to say back, which depends on whether anything is actually waiting for them.
 *
 * A bot that answers "hello" with "hello" has wasted the exchange. If there is something on their
 * plate this is the cheapest moment to mention it, and if there is not, the honest answer is an
 * invitation rather than a status report nobody asked for.
 */
async function greetingReply(db: SupabaseClient, name: string | null): Promise<string> {
  const who = name ? ` ${name}` : "";
  const p = await picture(db);

  const waiting: string[] = [];
  if (p.candidates > 0) waiting.push(`${p.candidates} waiting on a few questions from you`);
  if (p.draftsWaiting > 0) waiting.push(`${p.draftsWaiting} draft(s) to look at`);
  if (p.readyToWrite > 0) waiting.push(`${p.readyToWrite} ready to write up`);

  if (waiting.length === 0) {
    return `Hello${who}. Nothing waiting on you — send me anything worth remembering and I will ` +
      `take it from there.`;
  }
  return `Hello${who}. There is ${waiting.join(", and ")}. Say the word and I will bring it up, ` +
    `or send me something new.`;
}
