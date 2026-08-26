/**
 * Telegram — the one surface Josh touches on his phone (clause 16 decision 1).
 *
 * It carries five jobs, all of which the spec says happen "in the same place":
 *   4.1  dump a raw thought (voice or typed)
 *   4.2  ask to be interviewed
 *   4.3.4 raising waiting candidates from the automatic inputs
 *   9.14 pushing back on a draft while he is in the session
 *   10.1 sending an image to be rebuilt
 *
 * Chosen over WhatsApp because a bot can message him at any time. WhatsApp's 24-hour business
 * window would silently break 4.3.4 — the system could not raise a candidate unless Josh happened
 * to have messaged that day.
 */

import { secret } from "./secrets.ts";
export interface TelegramUpdate {
  update_id: number;
  /** A tap on an inline button. Carries the message it was attached to, so it can be edited. */
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
  };
  message?: {
    message_id: number;
    date: number;
    chat: { id: number };
    from?: { id: number; is_bot: boolean };
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration: number; mime_type?: string };
    audio?: { file_id: string; duration: number; mime_type?: string };
    photo?: { file_id: string; width: number; height: number }[];
    document?: { file_id: string; mime_type?: string; file_name?: string };
  };
}

function token(): string {
  const t = secret("TELEGRAM_BOT_TOKEN");
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

/** Only Josh may talk to this bot. */
export function isAuthorised(chatId: number): boolean {
  const allowed = secret("TELEGRAM_CHAT_ID");
  return !!allowed && String(chatId) === allowed;
}

export function joshChatId(): number {
  const id = secret("TELEGRAM_CHAT_ID");
  if (!id) throw new Error("TELEGRAM_CHAT_ID is not set");
  return Number(id);
}

/** A row of tappable buttons under a message. `data` is capped at 64 bytes by Telegram. */
export interface Button {
  text: string;
  data: string;
}

/**
 * Returns the sent message id, so a reply to it can be mapped back to what it was about.
 *
 * `buttons` carry the weekly pass. Clause 12.7 says the pass must happen where Josh already is,
 * because "a separate habit will not survive" — and a tap is the shortest possible distance between
 * reading a draft and approving it.
 */
export async function sendMessage(
  chatId: number,
  text: string,
  buttons?: Button[][],
): Promise<number> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    // Telegram rejects messages over 4096 characters outright, which would lose a long draft.
    text: text.length > 4096 ? `${text.slice(0, 4090)}\n[…]` : text,
    // Deliberately plain text: Markdown parsing fails on stray underscores and asterisks in
    // Josh's own words, and a failed send is worse than an unformatted one.
    disable_web_page_preview: true,
  };

  if (buttons?.length) {
    body.reply_markup = {
      inline_keyboard: buttons.map((row) =>
        row.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) }))
      ),
    };
  }

  const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`telegram sendMessage failed: ${res.status} ${await res.text()}`);
  const result = await res.json();
  return result?.result?.message_id ?? 0;
}

/**
 * Every tap must be acknowledged within seconds or Telegram shows a spinner on Josh's phone until
 * it times out. Called first, before any real work.
 */
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text?.slice(0, 200) }),
  }).catch(() => {
    // A failed acknowledgement is cosmetic. Never let it stop the actual work.
  });
}

/**
 * Replace a message in place once it has been acted on, so the thread reads as a record of what was
 * decided rather than a wall of stale drafts with dead buttons under them.
 */
export async function replaceMessage(
  chatId: number,
  messageId: number,
  text: string,
  buttons?: Button[][],
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: text.length > 4096 ? `${text.slice(0, 4090)}\n[…]` : text,
    disable_web_page_preview: true,
  };
  if (buttons?.length) {
    body.reply_markup = {
      inline_keyboard: buttons.map((row) =>
        row.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) }))
      ),
    };
  }
  await fetch(`https://api.telegram.org/bot${token()}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export async function sendPhoto(chatId: number, bytes: Uint8Array<ArrayBuffer>, caption: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([bytes], { type: "image/png" }), "visual.png");
  const res = await fetch(`https://api.telegram.org/bot${token()}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`telegram sendPhoto failed: ${res.status}`);
}

/** Resolve a file_id and download the bytes. */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; path: string }> {
  const meta = await fetch(`https://api.telegram.org/bot${token()}/getFile?file_id=${fileId}`);
  if (!meta.ok) throw new Error(`telegram getFile failed: ${meta.status}`);
  const { result } = await meta.json();
  const path: string = result.file_path;

  const bin = await fetch(`https://api.telegram.org/file/bot${token()}/${path}`);
  if (!bin.ok) throw new Error(`telegram file download failed: ${bin.status}`);
  return { bytes: new Uint8Array(await bin.arrayBuffer()), path };
}

/**
 * Josh's commands. Everything that is not a command is material.
 * Kept to a handful — anything he has to remember, he will not use.
 */
export type Command =
  | { kind: "interview_me" }
  | { kind: "candidates" }
  | { kind: "review" }
  | { kind: "status" }
  /* Clause 6 cold start — the long deliberate sitting that fills the bank. */
  | { kind: "seed" }
  /* 8.1 — the recorded interview the voice guide is built from. */
  | { kind: "voiceguide" }
  /* 8.8 — adding a rule to the library in seconds, where he already is. */
  | { kind: "rule"; text: string }
  | { kind: "stop" }
  | { kind: "help" }
  | { kind: "none" };

export function parseCommand(text: string | undefined): Command {
  if (!text) return { kind: "none" };
  const t = text.trim().toLowerCase();
  if (!t.startsWith("/")) return { kind: "none" };
  const cmd = t.split(/\s+/)[0];

  // 8.8 — "Josh must be able to add a rule in under a minute, because that is how it will actually
  // get maintained."
  //
  // Handled before the switch because it carries an argument: the whole rule is the rest of the
  // line, so adding one is a single message rather than a trip to a laptop, a search through
  // fourteen collapsed sections and a scroll to the end of a markdown document. Same reasoning as
  // 12.7 putting the weekly pass in Telegram — a thing that needs a separate habit does not survive.
  //
  // Sliced from the ORIGINAL text, not the lowercased copy: a rule about capitalisation would
  // otherwise arrive with its own point removed.
  if (cmd === "/rule") {
    return { kind: "rule", text: text.trim().slice("/rule".length).trim() };
  }

  switch (cmd) {
    case "/ask":
    case "/interview":
      return { kind: "interview_me" };
    case "/candidates":
    case "/waiting":
      return { kind: "candidates" };
    case "/review":
    case "/week":
    case "/drafts":
      return { kind: "review" };
    case "/seed":
      return { kind: "seed" };
    case "/voiceguide":
    case "/voice":
      return { kind: "voiceguide" };
    case "/status":
      return { kind: "status" };
    case "/stop":
    case "/done":
      return { kind: "stop" };
    case "/help":
    case "/start":
      return { kind: "help" };
    default:
      return { kind: "none" };
  }
}

export const HELP_TEXT =
  `Send me anything, any time.

A voice note or a typed thought is all it takes — I will ask you about it afterwards, whenever you
have a minute. You do not need to finish the conversation in one go.

  /review      this week's drafts — approve or schedule them here
  /ask         run me through some questions
  /candidates  show what is waiting from calls and Claude Code
  /seed        a long sitting, one moment straight into the next, to fill the bank
  /voiceguide  talk, and I keep it as the source for how you sound
  /rule        add a rule to the library, e.g. /rule never use the word journey
  /status      how the queue is looking
  /stop        end the current session, keeping everything so far

Send me an image or a diagram and I will ask what you want taken from it, then rebuild it in your
brand.`;
