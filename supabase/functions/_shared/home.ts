/**
 * WHAT THE BOT LOOKS LIKE WHEN JOSH IS NOT MID-TASK.
 *
 * Two surfaces, one picture behind both: `/help`, which used to be a wall of text listing commands,
 * and `/status`, which used to be three counts with no way to act on any of them.
 *
 * THE PROBLEM WITH THE OLD VERSIONS
 *
 * Both described the system rather than offering it. Reading "/review — this week's drafts" and then
 * having to type `/review` is two steps where one would do, and it puts the burden of remembering
 * nine commands on the person least likely to be at a keyboard. Telegram has buttons; a help screen
 * that does not use them is a printed manual.
 *
 * So both are built from the same live read and both end in something tappable. `/help` offers what
 * he can do; `/status` says what is actually waiting and offers the one thing worth doing about it.
 *
 * WHY THE COUNTS ARE NOT DECORATION
 *
 * Every number here is one Josh can act on, and the buttons underneath change with them — an empty
 * queue offers a session, a full one offers the review. A status screen with a fixed set of buttons
 * would be a menu with statistics printed above it.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Button, esc } from "./telegram.ts";

export interface Picture {
  draftsWaiting: number;
  readyToWrite: number;
  parked: number;
  unanswered: number;
  candidates: number;
  librarySectionsEmpty: number;
  voiceGuideMissing: boolean;
  lastCaptureDaysAgo: number | null;
}

/** One read, shared by both surfaces so they can never disagree about where things stand. */
export async function picture(db: SupabaseClient): Promise<Picture> {
  const [drafts, ready, parked, moments, sections, latest, candidates] = await Promise.all([
    db.from("posts").select("*", { count: "exact", head: true }).eq("status", "draft"),
    db.from("moments").select("*", { count: "exact", head: true })
      .eq("killed", false).in("status", ["mined", "queued"]),
    db.from("moments").select("*", { count: "exact", head: true })
      .eq("killed", false).eq("status", "parked"),
    // Mid-interview only. `half_mined` is what offerCandidates surfaces, so counting it here too
    // would report the same moments twice under two different names.
    db.from("moments").select("*", { count: "exact", head: true })
      .eq("killed", false).eq("status", "captured"),
    db.from("library_sections").select("key, body"),
    db.from("moments").select("captured_at").eq("killed", false)
      .order("captured_at", { ascending: false }).limit(1).maybeSingle(),
    // There is no "candidate" status. A waiting candidate IS a half_mined moment — the same filter
    // offerCandidates uses, so the count and the list can never disagree.
    db.from("moments").select("*", { count: "exact", head: true })
      .eq("killed", false).eq("status", "half_mined"),
  ]);

  // A section still carrying its "FOR JOSH" preamble has not been filled in. The voice guide is
  // called out separately because 8.1 puts it on the critical path and nothing else here is.
  const rows = sections.data ?? [];
  const empty = rows.filter((s) =>
    /FOR JOSH|DELIBERATELY EMPTY/i.test(String(s.body ?? ""))
  ).length;
  const guide = rows.find((s) => s.key === "voice_guide");
  const guideMissing = /DELIBERATELY EMPTY/i.test(String(guide?.body ?? ""));

  const capturedAt = latest.data?.captured_at as string | undefined;
  const days = capturedAt
    ? Math.floor((Date.now() - new Date(capturedAt).getTime()) / 86_400_000)
    : null;

  return {
    draftsWaiting: drafts.count ?? 0,
    readyToWrite: ready.count ?? 0,
    parked: parked.count ?? 0,
    unanswered: moments.count ?? 0,
    candidates: candidates.count ?? 0,
    librarySectionsEmpty: empty,
    voiceGuideMissing: guideMissing,
    lastCaptureDaysAgo: days,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * `/status` — what is waiting, and the one thing worth doing about it.
 *
 * Ordered by what Josh can act on soonest rather than by what is easiest to count. Drafts first,
 * because approving one takes a tap; the library last, because filling it is a sit-down job.
 */
export function statusMessage(p: Picture): { html: string; buttons: Button[][] } {
  const lines: string[] = ["<b>Where things stand</b>", ""];

  lines.push(
    p.draftsWaiting > 0
      ? `📝  <b>${plural(p.draftsWaiting, "draft", "drafts")}</b> waiting for you`
      : "📝  No drafts waiting",
  );
  lines.push(
    p.readyToWrite > 0
      ? `✍️  ${plural(p.readyToWrite, "moment", "moments")} mined and ready to write`
      : "✍️  Nothing mined and ready to write",
  );
  if (p.unanswered > 0) lines.push(`💬  ${plural(p.unanswered, "moment", "moments")} part-way through`);
  if (p.candidates > 0) lines.push(`👀  ${plural(p.candidates, "candidate", "candidates")} waiting from calls and Claude Code`);
  if (p.parked > 0) lines.push(`📦  ${plural(p.parked, "moment", "moments")} parked — kept, not lost`);

  if (p.lastCaptureDaysAgo !== null && p.lastCaptureDaysAgo >= 3) {
    lines.push("", `<i>Nothing captured in ${p.lastCaptureDaysAgo} days. A quiet week is fine — ` +
      `this is only so it is not a surprise.</i>`);
  }

  // The library is the one thing here that changes how everything gets written, so it is said last
  // and said plainly rather than buried in a count.
  if (p.voiceGuideMissing) {
    lines.push("", "⚠️  <b>The voice guide is still empty.</b> It is the one input everything else " +
      "leans on — /voiceguide and just talk for a bit.");
  } else if (p.librarySectionsEmpty > 0) {
    lines.push("", `📚  ${plural(p.librarySectionsEmpty, "library section", "library sections")} ` +
      `still waiting on you.`);
  }

  const buttons: Button[][] = [];
  const row: Button[] = [];
  if (p.draftsWaiting > 0) row.push({ text: `Review ${p.draftsWaiting}`, data: "menu:review" });
  if (p.candidates > 0) row.push({ text: "What's waiting", data: "menu:candidates" });
  // Offered when there is nothing to review — the useful next move is making more material.
  if (row.length < 2) row.push({ text: "Ask me questions", data: "menu:ask" });
  buttons.push(row);
  if (p.voiceGuideMissing) buttons.push([{ text: "Record the voice guide", data: "menu:voiceguide" }]);

  return { html: lines.join("\n"), buttons };
}

/**
 * `/help` — what he can do, as things he can tap.
 *
 * The commands still work by typing, and the native menu lists them all. This exists for the case
 * where he does not know what he wants yet, so it leads with what is waiting rather than with a
 * list of verbs.
 */
export function helpMessage(p: Picture): { html: string; buttons: Button[][] } {
  const waiting = p.draftsWaiting > 0
    ? `You have <b>${plural(p.draftsWaiting, "draft", "drafts")}</b> waiting.`
    : "Nothing is waiting on you right now.";

  const html = [
    "<b>Send me anything, any time.</b>",
    "",
    "A voice note or a typed thought is all it takes. I will ask you about it afterwards, whenever " +
    "you have a minute — you never have to finish in one go.",
    "",
    waiting,
    "",
    "<b>Or pick one of these:</b>",
  ].join("\n");

  const buttons: Button[][] = [
    [
      { text: p.draftsWaiting > 0 ? `📝 Review ${p.draftsWaiting}` : "📝 Review drafts", data: "menu:review" },
      { text: "📊 Status", data: "menu:status" },
    ],
    [
      { text: "✍️ Ask me questions", data: "menu:ask" },
      { text: "👀 What's waiting", data: "menu:candidates" },
    ],
    [
      { text: "🎙 Voice guide", data: "menu:voiceguide" },
      { text: "🌱 Long sitting", data: "menu:seed" },
    ],
    [{ text: "＋ How to add a rule", data: "menu:rule" }],
  ];

  return { html, buttons };
}

/** Shown when he taps "How to add a rule" — the one command that takes an argument. */
export function ruleHelp(): string {
  return [
    "<b>Adding a rule</b>",
    "",
    "Type <code>/rule</code> and then the rule itself, in your own words:",
    "",
    `<code>${esc("/rule never use the word journey")}</code>`,
    `<code>${esc("/rule open with a scene, not a question")}</code>`,
    "",
    "I will ask which part of the library it belongs in, and it applies to the very next draft. " +
    "No deploy, nothing to wait for.",
  ].join("\n");
}
