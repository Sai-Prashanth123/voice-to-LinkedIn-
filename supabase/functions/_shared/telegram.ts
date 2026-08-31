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
  // Deliberately plain text: Markdown parsing fails on stray underscores and asterisks in Josh's own
  // words, and a failed send is worse than an unformatted one. `sendRich` is the opt-in for messages
  // we author ourselves and escape.
  return await send(chatId, text, buttons);
}

/** The one implementation both send paths share, so they cannot drift on truncation or buttons. */
async function send(
  chatId: number,
  text: string,
  buttons?: Button[][],
  parseMode?: "HTML",
): Promise<number> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    // Telegram rejects messages over 4096 characters outright, which would lose a long draft.
    text: text.length > 4096 ? `${text.slice(0, 4090)}\n[…]` : text,
    disable_web_page_preview: true,
  };
  if (parseMode) body.parse_mode = parseMode;

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
 * HTML-escape anything that is not ours.
 *
 * Telegram HTML mode needs exactly three characters escaped, which is why it is safe where Markdown
 * is not: Markdown breaks on stray underscores and asterisks, and those appear constantly in real
 * writing. A draft containing "3 < 5" would silently fail to send otherwise.
 *
 * EVERY piece of Josh's own text passed to sendRich must go through this. His words are the one
 * thing in the system guaranteed not to be written for a parser.
 */
export function esc(text: string): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A formatted message. Separate from `sendMessage` on purpose.
 *
 * Forty call sites pass Josh's raw words straight through, and switching them all to a parse mode
 * would mean one unescaped angle bracket in a draft loses the message. So formatting is opt-in: a
 * caller that wants bold headers uses this and escapes its inputs, and everything else keeps the
 * plain-text guarantee it was written with.
 *
 * FALLS BACK RATHER THAN FAILING. If Telegram rejects the markup, the tags are stripped and it is
 * sent as plain text. An ugly message beats a missing one — the whole reason the original code
 * avoided Markdown.
 */
export async function sendRich(
  chatId: number,
  html: string,
  buttons?: Button[][],
): Promise<number> {
  try {
    return await send(chatId, html, buttons, "HTML");
  } catch {
    const plain = html.replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return await send(chatId, plain, buttons);
  }
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

/* HELP_TEXT lived here. Replaced by helpMessage() in home.ts: a wall of text listing commands
   asks Josh to read nine verbs and then type one, where a button does it in a tap. */

/**
 * THE COMMAND MENU (setMyCommands).
 *
 * Typing "/" in Telegram used to show nothing at all, so every command had to be memorised or dug
 * out of a wall of help text. That is the single clearest signal of an unfinished bot, and it is one
 * API call to fix.
 *
 * Registered here rather than in a setup script because a setup script is a thing someone has to
 * remember to run — the same reasoning that put the cc-agent scheduler behind an installer. This is
 * idempotent and costs one request, so it can simply happen.
 *
 * The descriptions are what Josh reads while deciding what to tap, so they say what the command DOES
 * for him, not what it is called.
 */
export const COMMAND_MENU: { command: string; description: string }[] = [
  { command: "review", description: "This week's drafts — approve or schedule them" },
  { command: "status", description: "Where everything stands right now" },
  { command: "ask", description: "Run me through some questions" },
  { command: "candidates", description: "What's waiting from calls and Claude Code" },
  { command: "seed", description: "A long sitting — fill the bank in one go" },
  { command: "voiceguide", description: "Talk, and I keep how you sound" },
  { command: "rule", description: "Add a rule, e.g. /rule never say journey" },
  { command: "stop", description: "End this session, keeping everything" },
  { command: "help", description: "Everything I can do" },
];

/**
 * Publish the menu and the ☰ button beside the message box.
 *
 * Never throws. This is polish, and polish must not be able to take down a capture — the rule that
 * governs `answerCallback` and the provider recording governs this too.
 */
export async function registerCommands(): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token()}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: COMMAND_MENU }),
    });
    await fetch(`https://api.telegram.org/bot${token()}/setChatMenuButton`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menu_button: { type: "commands" } }),
    });
  } catch {
    // Silent by design. A missing menu is a worse-looking bot, not a broken one.
  }
}
