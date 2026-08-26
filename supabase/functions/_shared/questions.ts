/**
 * 4.2.6 — "Where a question keeps producing nothing, the system must try asking it a different way
 * rather than dropping it. A question that lands stays as it is. A question that does not gets
 * rephrased, not retired."
 *
 * This is a small learning loop, separate from clause 12's, and easy to miss: it needs per-question
 * yield tracked across sessions, and a rephrasing step. Without it the prompt set decays silently —
 * a question that never lands keeps being asked, forever, in the same words.
 *
 * There is deliberately no way to retire a question here. The table has no `retired` column, and
 * nothing in this file removes a row. That is the requirement, made structural.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { budgetRemaining, callText, MODELS } from "./llm.ts";

export interface Question {
  key: string;
  current_text: string;
  original_text: string;
  asked: number;
  produced_material: number;
  rephrase_count: number;
}

/** A question that has been asked this many times with nothing to show for it gets reworded. */
const REPHRASE_AFTER = 4;

/**
 * Keep `question_stats` in step with the prompt set Josh maintains in the library.
 *
 * New questions are added; existing ones keep their history and their current (possibly rephrased)
 * wording, so editing an unrelated line in the library does not reset what we have learned. Removing
 * a line from the library does NOT delete its row — 6.3 and 4.2.6 both point the same way.
 */
export async function syncQuestions(db: SupabaseClient, promptSet: string): Promise<Question[]> {
  const parsed = parsePromptSet(promptSet);

  for (const q of parsed) {
    const { data: existing } = await db
      .from("question_stats")
      .select("key")
      .eq("key", q.key)
      .maybeSingle();

    if (!existing) {
      await db.from("question_stats").insert({
        key: q.key,
        original_text: q.text,
        current_text: q.text,
        depth: q.depth,
      });
    }
  }

  const { data } = await db.from("question_stats").select("*").order("key");
  return (data ?? []) as Question[];
}

/**
 * Lines that look like questions, keyed by a stable hash of the ORIGINAL wording so a rephrase does
 * not orphan its own history.
 */
export function parsePromptSet(
  promptSet: string,
): { key: string; text: string; depth: string | null }[] {
  const out: { key: string; text: string; depth: string | null }[] = [];
  let depth: string | null = null;

  for (const raw of promptSet.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // A markdown heading naming a depth lets a question be tagged with the rung it probes.
    if (line.startsWith("#")) {
      const h = line.replace(/^#+\s*/, "").toLowerCase();
      if (h.includes("scene")) depth = "scene";
      else if (h.includes("time")) depth = "time_anchored";
      else if (h.includes("perspective") || h.includes("earned")) depth = "earned_perspective";
      else depth = null;
      continue;
    }

    const text = line.replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (text.length < 8) continue;
    if (!text.includes("?") && !/^(tell|describe|walk|what|who|when|where|why|how)/i.test(text)) {
      continue;
    }
    out.push({ key: hash(text), text, depth });
  }
  return out;
}

function hash(text: string): string {
  // FNV-1a: short, stable, and no crypto import needed for what is only a dictionary key.
  let h = 0x811c9dc5;
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalised.length; i++) {
    h ^= normalised.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `q_${(h >>> 0).toString(36)}`;
}

export async function recordAsked(db: SupabaseClient, key: string): Promise<void> {
  if (!key) return;
  const { data } = await db.from("question_stats").select("asked").eq("key", key).maybeSingle();
  if (!data) return;
  await db.from("question_stats").update({
    asked: data.asked + 1,
    last_asked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("key", key);
}

/**
 * Credit every question asked in a session that produced usable material.
 *
 * Crediting the whole session rather than trying to attribute material to one question is the honest
 * choice: in a conversation, an answer three turns later often belongs to a question asked earlier,
 * and pretending otherwise would produce confident nonsense.
 */
export async function creditSession(db: SupabaseClient, momentId: number): Promise<void> {
  const { data: turns } = await db
    .from("interview_turns")
    .select("question_key")
    .eq("moment_id", momentId)
    .not("question_key", "is", null);

  const keys = [...new Set((turns ?? []).map((t) => t.question_key as string))];
  for (const key of keys) {
    const { data } = await db
      .from("question_stats")
      .select("produced_material")
      .eq("key", key)
      .maybeSingle();
    if (!data) continue;
    await db.from("question_stats").update({
      produced_material: data.produced_material + 1,
      updated_at: new Date().toISOString(),
    }).eq("key", key);
  }
}

/**
 * Reword the questions that keep producing nothing. Never drops one.
 * Returns how many were rephrased, for the ops report.
 */
export async function rephraseDeadQuestions(db: SupabaseClient): Promise<number> {
  const { data: dead } = await db
    .from("question_stats")
    .select("*")
    .gte("asked", REPHRASE_AFTER)
    .eq("produced_material", 0)
    .limit(5);

  if (!dead || dead.length === 0) return 0;

  // Rewording is the lowest-value work the system does and it must behave like it.
  //
  // A rate limit in the middle of this loop threw, propagated, and returned 500 from the whole daily
  // ops run — so a failed reword silenced the error alerts, the queue warning and the silence check,
  // which is everything clause 13 exists to deliver. The optional side-task took down the message.
  //
  // Two guards. It declines to start when the provider's minute is already spent, and a failure on
  // one question is that question's problem: the loop carries on and tomorrow tries again. Nothing
  // is lost either way, because 4.2.6 forbids ever dropping a question.
  const budget = await budgetRemaining(db);
  if (budget !== null && budget < 800) return 0;

  let rephrased = 0;
  for (const q of dead as Question[]) {
    const attempts = q.rephrase_count;
    let text: string;
    try {
      text = await callText({
      model: MODELS.SONNET,
      system:
        `You reword interview questions that are not working.\n\n` +
        `This question has been asked ${q.asked} times and has never produced anything usable. The ` +
        `subject matter is right — it is being kept, not dropped — but the wording is not landing.\n\n` +
        `Return ONLY the reworded question. No preamble, no explanation, no quotes around it.\n\n` +
        `Make it more concrete and more conversational. A question that asks someone to generalise ` +
        `usually fails; one that asks for a specific occasion usually works. Keep it short enough to ` +
        `answer while walking.`,
        messages: [{
          role: "user",
          content: `Original: ${q.original_text}\n` +
            `Currently asked as: ${q.current_text}\n` +
            `Previous rewordings tried: ${attempts}`,
        }],
        effort: "low",
        maxTokens: 300,
        purpose: "rephrase_question",
      }, { db });
    } catch {
      // Tomorrow will do. The question is untouched and still in the prompt set, which is the whole
      // guarantee of 4.2.6 — it is never dropped, only reworded, and a failed reword changes nothing.
      continue;
    }

    const cleaned = text.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].trim();
    if (!cleaned || cleaned.length < 8) continue;

    await db.from("question_stats").update({
      current_text: cleaned,
      rephrase_count: attempts + 1,
      // Reset the counter so the new wording gets a fair run before being judged.
      asked: 0,
      last_rephrased_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("key", q.key);
    rephrased++;
  }
  return rephrased;
}
