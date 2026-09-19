/**
 * Ideas are named by the person who had them (migration 0037).
 *
 * Every surface used to call an idea by a minted number — "Got it. (M-000035)" — and "rewrite
 * M-000024" was a sentence only the system could say. Now the person names each idea right after
 * capturing it, the interview waits until they have, and the name is what everything shows.
 *
 * Nothing here invents a name. An unnamed idea is shown as unnamed and asked about, because a name
 * the system picked would be the system deciding what the story is about before anyone asked.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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

/** The question that asks for a name. */
export function namePrompt(gist: string, justCaptured: boolean): string {
  const opener = justCaptured ? "Got it." : "One of your ideas has no name yet:";
  const quoted = gist ? `\n\n"${gist}${gist.length >= 220 ? "…" : ""}"` : "";
  return justCaptured
    ? `${opener} What should we call this idea? A few words you will recognise later.`
    : `${opener}${quoted}\n\nWhat should we call it? A few words you will recognise later.`;
}

/** The oldest live idea still waiting for a name, for asking about existing ideas one at a time. */
export async function nextUnnamed(db: SupabaseClient): Promise<number | null> {
  const { data } = await db
    .from("moments")
    .select("id")
    .is("title", null)
    .eq("killed", false)
    // Published is done with; parked is not in play. A parked idea is named if it is ever reopened,
    // because the reopen asks the same question every other interview does. Asking for a name for
    // eight parked ideas the moment someone says hello is how a good idea becomes a chore.
    .not("status", "in", "(published,parked)")
    // Newest first: the idea most likely to still be in their head.
    .order("captured_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}
