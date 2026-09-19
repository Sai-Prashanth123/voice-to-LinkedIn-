/**
 * Ideas are named by the person who had them (migration 0037).
 *
 * Every surface used to call an idea by a minted number — "Got it. (M-000035)" — and "rewrite
 * M-000024" was a sentence only the system could say. Ideas have names instead, and the name is what
 * Telegram, Claude and the desk all show.
 *
 * WHO CHOOSES IT (0037, then 0038)
 *
 * First the person did, and nothing moved until they had: no interview question, a greeting re-asked,
 * an answer refused. A label had become a toll gate on every thought. So the handle is now derived
 * from their own words at capture (autoName), said out loud, and changed whenever they say "call it
 * X" — which is one message instead of one on every idea.
 *
 * The derivation still invents nothing: it reuses their nouns and reaches no conclusion the interview
 * has not reached. The name is how a person finds an idea. It is never material and never appears in
 * a draft.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callText, MODELS } from "./llm.ts";

export const MAX_NAME = 80;

/** How an idea is referred to in a sentence. Never the internal ref. */
export function ideaLabel(m: { title?: string | null } | null | undefined): string {
  return m?.title ? `"${m.title}"` : "an idea you have not named yet";
}

/** Tidy what the person typed into a name: trimmed, one line, no wrapping quotes. */
export function cleanName(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘«]+|["'”’»]+$/g, "")
    .replace(/[.!]+$/, "")
    .trim();
}

export type NameResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/** Store a name for an idea, refusing an empty, overlong or already-used one. */
export async function setIdeaName(
  db: SupabaseClient,
  momentId: number,
  raw: string,
): Promise<NameResult> {
  const name = cleanName(raw);
  if (name.length === 0) return { ok: false, reason: "That name is empty. A few words is enough." };
  if (name.length > MAX_NAME) {
    return {
      ok: false,
      reason: `That is ${name.length} characters, which reads more like the story than its name. ` +
        `Something under ${MAX_NAME} characters you will recognise later?`,
    };
  }

  const { data: taken } = await db
    .from("moments")
    .select("id")
    .ilike("title", name.replace(/[%_\\]/g, (c) => `\\${c}`))
    .eq("killed", false)
    .neq("id", momentId)
    .limit(1);
  if (taken && taken.length > 0) {
    return { ok: false, reason: `You already have an idea called "${name}". A different name for this one?` };
  }

  const { error } = await db
    .from("moments")
    .update({ title: name, updated_at: new Date().toISOString() })
    .eq("id", momentId);

  if (error) {
    // 23505: the unique index caught a race the check above missed.
    if (error.code === "23505") {
      return { ok: false, reason: `You already have an idea called "${name}". A different name for this one?` };
    }
    throw new Error(`could not name idea ${momentId}: ${error.message}`);
  }
  return { ok: true, name };
}

/** One line of what the idea is, so the person knows which one they are naming. Their words first. */
export async function ideaGist(db: SupabaseClient, momentId: number): Promise<string> {
  const { data: raw } = await db
    .from("raw_inputs")
    .select("text_body, transcript")
    .eq("moment_id", momentId)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  const said = (raw?.text_body ?? raw?.transcript ?? "").trim();
  // "(prompted session — …)" is a placeholder the system wrote, not something they said.
  if (said && !said.startsWith("(")) return said.slice(0, 220);

  const { data: answer } = await db
    .from("interview_turns")
    .select("body")
    .eq("moment_id", momentId)
    .eq("role", "answer")
    .order("turn_no", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (answer?.body && !answer.body.startsWith("(")) return answer.body.trim().slice(0, 220);

  const { data: m } = await db
    .from("moments")
    .select("notes, material(the_moment)")
    .eq("id", momentId)
    .maybeSingle();
  const material = Array.isArray(m?.material) ? m?.material[0] : m?.material;
  return String((material as { the_moment?: string } | null)?.the_moment ?? m?.notes ?? "").split("\n")[0].slice(0, 220);
}

const NAMER_SYSTEM =
  `You give a short handle to something a person just told you, so they can find it again later.

Reply with the handle ALONE: three to six words, no quotes, no full stop, no explanation.

It must be built from THEIR words. Use the nouns they used. Do not add a conclusion they did not
reach, an adjective they did not use, or a lesson. "CFO reads the first line" is a handle. "The power
of concise communication" is a headline about a post nobody has written, and is wrong.

If what they sent is too thin to name, reply with the most concrete few words in it.`;

/**
 * Name an idea from what the person said, without asking them.
 *
 * WHY THE SYSTEM NAMES IT
 *
 * The first version asked, and kept asking: no interview question until a name was typed, a greeting
 * re-asked, an answer refused. That turned a label into a toll gate on every thought. So the handle
 * is derived, said out loud in the acknowledgement, and changed by saying "call it X" — which is one
 * message instead of one every time.
 *
 * WHAT IT MAY NOT DO
 *
 * Invent. The handle is built from their own nouns, never a conclusion they have not reached: the
 * interview exists precisely because the system does not know what the story means yet, and a name
 * that guessed would be the first fabrication in the chain. It is also never used inside a draft —
 * it is how a person finds an idea, not material.
 *
 * NEVER FAILS. A capture that threw because a naming model was rate limited would lose the thought,
 * so every failure falls back to the first few words of what they said.
 */
export async function autoName(
  db: SupabaseClient,
  momentId: number,
  text: string,
): Promise<string | null> {
  const said = (text ?? "").trim() || await ideaGist(db, momentId);
  if (!said) return null;

  let candidate = "";
  try {
    candidate = await callText({
      model: MODELS.HAIKU,
      system: NAMER_SYSTEM,
      messages: [{ role: "user", content: said.slice(0, 1500) }],
      maxTokens: 40,
      purpose: "idea_name",
      momentId,
    }, { db });
  } catch {
    // Left for the fallback below. A name is never worth failing a capture over.
  }

  const wanted = cleanName(candidate).split("\n")[0] || firstWords(said);
  return await nameWithoutClashing(db, momentId, wanted.slice(0, MAX_NAME));
}

/** Their opening words, cut at a word boundary. The fallback when the model is unavailable. */
export function firstWords(said: string): string {
  const flat = said.replace(/\s+/g, " ").trim();
  if (flat.length <= 48) return flat;
  const cut = flat.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

/**
 * Store it, stepping around a name that is already taken.
 *
 * Two ideas can genuinely be about the same thing, and refusing the second one's name would mean
 * either failing the capture or asking — which is the behaviour this replaces.
 */
async function nameWithoutClashing(
  db: SupabaseClient,
  momentId: number,
  base: string,
): Promise<string | null> {
  for (let n = 1; n <= 9; n++) {
    const attempt = n === 1 ? base : `${base.slice(0, MAX_NAME - 4)} (${n})`;
    const result = await setIdeaName(db, momentId, attempt);
    if (result.ok) return result.name;
  }
  return null;
}
