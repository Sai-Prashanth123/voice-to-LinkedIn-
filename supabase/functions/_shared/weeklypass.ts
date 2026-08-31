/**
 * THE WEEKLY PASS, IN TELEGRAM (clause 11 step 07, and 12.5).
 *
 * 12.7 is the reason this lives here rather than only in the web app:
 *
 *   "This question must sit inside the weekly pass Josh already does. Never a separate task, a
 *    reminder, or a second place to go. A separate habit will not survive."
 *
 * Josh is in Telegram every day sending voice notes. A pass that happens there costs him almost
 * nothing to start. A web app he has to remember to open is precisely the separate habit the spec
 * warns about.
 *
 * WHAT DELIBERATELY DOES NOT HAPPEN HERE
 *
 * Rewriting a post. Editing 1,000 characters in a chat box is miserable, and pretending otherwise
 * would make the common case worse to serve a rare one. "Rewrite" hands him a link to the web app
 * for that one post.
 *
 * That split follows the acceptance criterion itself: 17a targets "five of the last six drafts need
 * only light editing". In a working week Josh mostly approves. Heavy editing is the exception, and
 * the exception is what gets the extra tap.
 *
 * R3 IS UNTOUCHED. Nothing here publishes. Approving sets a date and marks the post ready, which is
 * exactly what 11.2 requires — and the database refuses to record a published post that Josh never
 * marked ready, however this code behaves.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { secret } from "./secrets.ts";
import { embedOne } from "./db.ts";
import {
  type ConversationAnswer,
  firstLine as postFirstLine,
  postsToAskAbout,
  recordAnswer,
  recordAsked,
} from "./conversation.ts";
import { openProposals, summarise } from "./proposals.ts";
import { recordEditDiff } from "./outcome.ts";
import { type Button, replaceMessage, sendMessage } from "./telegram.ts";

/** Callback payloads are capped at 64 bytes, so they stay terse. */
export type Action =
  | { kind: "schedule"; postId: number; days: number }
  | { kind: "pick"; postId: number }
  | { kind: "rewrite"; postId: number }
  | { kind: "hold"; postId: number }
  | { kind: "conversation"; postId: number; answer: string }
  /* Disambiguating a message that arrived long after the question it might be answering. */
  | { kind: "answer"; momentId: number }
  | { kind: "newthought" }
  /* Declining the offered candidates in favour of the prompt set (4.2). */
  | { kind: "prompted" }
  | { kind: "candidate"; momentId: number }
  /* 5.10 — correcting the pillar the interview chose. index -1 means leave it. */
  | { kind: "pillar"; momentId: number; index: number }
  /* 6.4 — bringing a parked moment back into the queue. */
  | { kind: "reopen"; momentId: number }
  /* 8.8 — which library section a rule typed in Telegram belongs to. */
  | { kind: "rulesection"; index: number }
  /* 8.1 — whether a line typed during voice capture belongs in the voice guide. */
  | { kind: "voiceguide"; keep: boolean }
  /* 9.10 — clearing one name, for one post. Per name, never a blanket yes. */
  | { kind: "name"; nameId: number; cleared: boolean }
  /* 12.10 — approving or rejecting a library change, inside the weekly pass. */
  | { kind: "proposal"; proposalId: number; approve: boolean }
  /* 12.4 — declining to leave a verdict. An explicit "nothing" beats a question left hanging. */
  | { kind: "noverdict" }
  /* A tap on the help menu. Runs the command rather than describing it. */
  | { kind: "menu"; go: string }
  /* 10.2 — the third question: which moment the image goes with. */
  | { kind: "imgmoment"; momentId: number }
  | { kind: "imgpick" }
  | { kind: "unknown" };

export function parseAction(data: string | undefined): Action {
  if (!data) return { kind: "unknown" };
  const [verb, a, b] = data.split(":");

  // Verbs that carry no id.
  if (verb === "new") return { kind: "newthought" };
  if (verb === "prompt") return { kind: "prompted" };
  if (verb === "imgpick") return { kind: "imgpick" };
  if (verb === "nv") return { kind: "noverdict" };
  // menu:review, menu:ask, ... — the second segment is the command to run.
  if (verb === "menu") return { kind: "menu", go: a ?? "" };
  if (verb === "vgy") return { kind: "voiceguide", keep: true };
  if (verb === "vgn") return { kind: "voiceguide", keep: false };

  const id = Number(a);
  if (!Number.isInteger(id)) return { kind: "unknown" };

  switch (verb) {
    case "sch":
      return { kind: "schedule", postId: id, days: Number(b) || 0 };
    case "pick":
      return { kind: "pick", postId: id };
    case "rw":
      return { kind: "rewrite", postId: id };
    case "hold":
      return { kind: "hold", postId: id };
    case "conv":
      return { kind: "conversation", postId: id, answer: b ?? "none" };
    case "ans":
      return { kind: "answer", momentId: id };
    case "cand":
      return { kind: "candidate", momentId: id };
    case "reopen":
      return { kind: "reopen", momentId: id };
    case "img":
      return { kind: "imgmoment", momentId: id };
    case "prop":
      return { kind: "proposal", proposalId: id, approve: b === "y" };
    case "name":
      return { kind: "name", nameId: id, cleared: b === "y" };
    case "sect":
      return { kind: "rulesection", index: id };
    case "pil":
      return { kind: "pillar", momentId: id, index: Number(b) };
    default:
      return { kind: "unknown" };
  }
}

/**
 * Start the pass.
 *
 * Order matters: the conversation question comes FIRST, before the drafts. It is the signal the
 * spec calls "the only one that connects a post to the business", and it is also the one most
 * easily skipped — so it is asked while Josh is fresh, not after he has worked through five drafts.
 */
export async function startWeeklyPass(db: SupabaseClient, chatId: number): Promise<void> {
  // 12.10 — first, because it is the only thing here that changes how everything gets written, and
  // because a proposal Josh never sees is a proposal he never approves. It is raised inside the pass
  // he already does rather than as a reminder, for the same reason as the question below (12.7).
  const proposed = await sendProposals(db, chatId);
  const asked = await askConversationQuestion(db, chatId);
  const sent = await sendDrafts(db, chatId);

  if (!proposed && !asked && sent === 0) {
    await sendMessage(
      chatId,
      "Nothing waiting, and nothing to ask you about.\n\n" +
        "If the material has not been there this week, fewer posts is the right outcome — not " +
        "something to make up for.",
    );
  }
}

/** 12.5 / 12.6 — one question, covering the last few weeks. Buttons, because 12.4 says seconds. */
async function askConversationQuestion(db: SupabaseClient, chatId: number): Promise<boolean> {
  const askable = await postsToAskAbout(db);
  if (askable.length === 0) return false;

  for (const post of askable) {
    await sendMessage(
      chatId,
      `Did this lead to a conversation?

"${postFirstLine(post.body)}"`,
      [
        [
          { text: "Nothing", data: `conv:${post.postId}:none` },
          { text: "Comments", data: `conv:${post.postId}:comment_thread` },
        ],
        [
          { text: "A DM", data: `conv:${post.postId}:dm` },
          { text: "A call", data: `conv:${post.postId}:call` },
          { text: "A client", data: `conv:${post.postId}:client` },
        ],
      ],
    );
  }

  // Recorded as ASKED the moment it is shown, not when he answers. 12.8: being asked and ignoring it
  // is the same event as being asked and skipping, and a post raised twice stops being raised —
  // whichever surface did the raising.
  await recordAsked(db, askable);
  return true;
}

/**
 * 12.9 / 12.10 — what the system wants to change, with the evidence, and two buttons.
 *
 * Deliberately capped at three. The point of raising these inside the weekly pass is that they cost
 * him almost nothing; a wall of proposals is a separate task wearing a disguise.
 */
async function sendProposals(db: SupabaseClient, chatId: number): Promise<boolean> {
  const proposals = await openProposals(db, 3);
  if (proposals.length === 0) return false;

  for (const p of proposals) {
    await sendMessage(
      chatId,
      `I would like to change how I write.

${summarise(p)}`,
      [[
        { text: "Do it", data: `prop:${p.id}:y` },
        { text: "No", data: `prop:${p.id}:n` },
      ]],
    );
  }
  return true;
}

/** Every draft waiting, each with its own controls. */
async function sendDrafts(db: SupabaseClient, chatId: number): Promise<number> {
  const { data: drafts } = await db
    .from("posts")
    .select("id, body, visual_id, moments!inner(ref, pillar)")
    .eq("status", "draft")
    .order("id");

  if (!drafts || drafts.length === 0) return 0;

  for (const post of drafts) {
    // deno-lint-ignore no-explicit-any
    const m = embedOne<{ ref: string; pillar: string | null }>((post as any).moments);
    const header = [m?.ref, m?.pillar, post.visual_id ? "image attached" : null]
      .filter(Boolean).join(" · ");

    await sendMessage(
      chatId,
      `${header}\n${"─".repeat(24)}\n\n${post.body}`,
      draftButtons(post.id),
    );
  }
  return drafts.length;
}

/**
 * Dates as relative buttons rather than a picker. A date picker in a chat is several taps and a
 * mental calculation; "tomorrow" is one tap and no thinking.
 */
export function draftButtons(postId: number): Button[][] {
  return [
    [
      { text: "Tomorrow 9am", data: `sch:${postId}:1` },
      { text: "In 2 days", data: `sch:${postId}:2` },
    ],
    [
      { text: "Next Monday", data: `sch:${postId}:next-mon` },
      { text: "Pick a day", data: `pick:${postId}` },
    ],
    [
      { text: "Rewrite it", data: `rw:${postId}` },
      { text: "Not this one", data: `hold:${postId}` },
    ],
  ];
}

/** Buttons for choosing a specific day, up to a fortnight out. */
export function dayButtons(postId: number): Button[][] {
  const rows: Button[][] = [];
  for (let week = 0; week < 2; week++) {
    const row: Button[] = [];
    for (let d = 1; d <= 4; d++) {
      const days = week * 4 + d;
      const when = new Date(Date.now() + days * 86_400_000);
      row.push({
        text: when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }),
        data: `sch:${postId}:${days}`,
      });
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 11.2 / R3 — marking ready and setting a date is the whole of Josh's authorisation. Publishing
 * happens later, on that date, and only because this row exists.
 */
export async function schedulePost(
  db: SupabaseClient,
  postId: number,
  days: number | "next-mon",
): Promise<string> {
  const when = new Date();
  if (days === "next-mon") {
    const ahead = (8 - when.getDay()) % 7 || 7;
    when.setDate(when.getDate() + ahead);
  } else {
    when.setDate(when.getDate() + days);
  }
  when.setHours(9, 0, 0, 0);

  await db.from("posts").update({
    status: "scheduled",
    marked_ready_at: new Date().toISOString(),
    scheduled_for: when.toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", postId);

  // 12.2 — the difference between what the system wrote and what Josh approved, taken HERE rather
  // than at publish. It needs no LinkedIn, and 12.3 says the automatic signals must be enough on
  // their own. Approving from Telegram means the body is untouched, which is itself the measurement:
  // an unedited approval is the strongest evidence the draft was right.
  await recordEditDiff(db, postId, "approved");

  return when.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export async function holdPost(db: SupabaseClient, postId: number): Promise<void> {
  await db.from("posts").update({
    status: "draft",
    scheduled_for: null,
    marked_ready_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", postId);
}

export async function recordConversation(
  db: SupabaseClient,
  postId: number,
  answer: string,
): Promise<void> {
  // One writer, in _shared/conversation.ts. The web app calls the same one — a conversation recorded
  // in Telegram and a conversation recorded in the app must be the same row written the same way,
  // or the two surfaces disagree about what Josh has already told us.
  await recordAnswer(db, postId, answer as ConversationAnswer);
}

/** Rewrite hands off to the web app, where a textarea beats a chat box. */
export function rewriteLink(postId: number): string {
  // Through secret(), not Deno.env: everything else in this system keeps its configuration in
  // Vault, and a value stored there was invisible to a direct env read.
  const base = secret("APP_URL") ?? "";
  return base ? `${base}/?post=${postId}` : "";
}

export { replaceMessage };

function firstLine(body: string): string {
  const line = body.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * 12.4 — "a one-line verdict on a draft in a couple of seconds. If it takes longer he will not do
 * it."
 *
 * Asked on the taps Josh already makes rather than as a control of its own, because a verdict button
 * he has to notice is a verdict he never leaves. Live evidence for that: the web app has had a
 * verdict box since the first build and has collected exactly none.
 *
 * The negative form is asked on every rejection. "Not this one" is the single richest signal in the
 * system — the system guessed, he said no — and it used to record nothing at all. The positive form
 * is asked once per pass, because five approvals producing five questions is the nagging 12.8 rules
 * out everywhere else.
 */
export function verdictPrompt(rejected: boolean): { text: string; buttons: Button[][] } {
  return {
    text: rejected
      ? "Left as a draft. What was wrong with it? One line is plenty — or ignore this, nothing is " +
        "waiting on you."
      : "Anything that made that one work? One line, and I will write more like it — or ignore " +
        "this, it is not a question you have to answer.",
    buttons: [[{ text: rejected ? "Nothing specific" : "Skip", data: "nv" }]],
  };
}
