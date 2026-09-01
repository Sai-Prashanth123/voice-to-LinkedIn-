/**
 * WHICH SERVICES THIS SYSTEM USES, AND WHETHER JOSH HAS BEEN TOLD (clauses 15.1, 15.3).
 *
 *   15.3 "Where a new tool is added later, Josh should be told AT THE TIME rather than finding it on
 *         a statement."
 *
 * WHY THIS EXISTS RATHER THAN A CORRECTED DOCUMENT
 *
 * The tool list in `docs/01-recommendations.md` named Anthropic and OpenAI. Neither was ever keyed.
 * Groq and Hugging Face — absent from that list, absent from the cost model, absent from everything
 * Josh has seen — had been running the drafter, the gate and the dedup embeddings for days, and the
 * cost model was still billing that work to Anthropic at $25 a month.
 *
 * Correcting the document fixes today and nothing else. The list drifted because nothing anywhere
 * failed when it stopped being true, and the next provider swap would do it again — quietly, in the
 * same place, for the same reason. So the same rule the rest of this build follows applies here:
 * enforce it rather than restate it.
 *
 * Two mechanisms, and they cover different failures:
 *
 *   1. `providers_seen` fills at the point of use, and `worker-ops` tells Josh about anything on it
 *      that is not declared below. That catches a provider going live without him being told.
 *   2. `providers.test.ts` fails when DECLARED and the tool table in the recommendations disagree.
 *      That catches the document and the code drifting apart.
 *
 * RECORDED AT THE POINT OF USE, NEVER INFERRED. Groq serves a model called `openai/gpt-oss-120b`.
 * Any rule smart enough to attribute that correctly is a rule that will be confidently wrong about
 * the next one, and being confidently wrong about who is billing you is worse than not knowing.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * The services Josh has been told about, as data rather than prose.
 *
 * This IS the tool list. `docs/01-recommendations.md` renders it for a human and the test keeps the
 * two identical; if they ever disagree, the test fails rather than Josh finding out from a bill.
 */
export const DECLARED: Record<string, string> = {
  supabase: "The idea bank, the library, the queue, scheduling, file storage and sign-in",
  anthropic: "The interview, the drafter, the gate, triage and the learning loop. Declared from the " +
    "start and still not keyed, which is why no draft has yet cleared the gate",
  groq: "Doing Anthropic's work on a free tier while no Anthropic key exists. Added mid-build",
  huggingface: "Embeddings for the retelling check, and a second free-tier model provider. Added " +
    "mid-build",
  gemini: "A third free-tier model provider, and the first with room for the whole gate in one " +
    "pass. Added at Josh's request",
  openai: "A fallback for embeddings and for transcription. Not keyed, and never yet used",
  deepgram: "Turning voice notes and recordings into text",
  telegram: "Where moments are captured and questions get asked",
  linkedin: "Publishing, and post analytics once the Community Management review is approved",
  vercel: "Hosting The desk — the calendar, the bank, the library and the weekly pass",
  github: "Where the code lives, and what a rebuild is restored from",
};

/** Everything a caller may pass as a purpose, so a typo cannot invent a category. */
export type ProviderPurpose =
  | "drafting"
  | "gate"
  | "interview"
  | "triage"
  | "learning"
  | "visual"
  | "embeddings"
  | "transcription"
  | "publishing"
  | "messaging";

/**
 * Record that a service was actually used.
 *
 * Never throws and never blocks. This is bookkeeping attached to real work, and the rule that
 * governs `record()` in `llm.ts` governs it too: accounting must not be able to take down the thing
 * it is accounting for.
 */
export async function noteProvider(
  db: SupabaseClient | undefined,
  provider: string,
  purpose: ProviderPurpose,
): Promise<void> {
  if (!db || !provider) return;
  try {
    await db.rpc("note_provider", { p_provider: provider, p_purpose: purpose });
  } catch {
    // Deliberately silent. A missed row costs one day's delay in an announcement; a thrown error
    // costs the draft.
  }
}

export interface UndeclaredProvider {
  provider: string;
  purposes: string[];
  firstSeen: string;
}

/**
 * What is running that Josh was never told about.
 *
 * Excludes anything already announced: 15.3 asks that he be told at the time, not every morning.
 * Same rule as `system_events.notified_at` — the alert that repeats daily is the alert that stops
 * being read, which is the failure clause 13 exists to prevent.
 */
export async function undeclared(db: SupabaseClient): Promise<UndeclaredProvider[]> {
  const { data } = await db
    .from("providers_seen")
    .select("provider, purposes, first_seen_at")
    .is("announced_at", null)
    .order("first_seen_at");

  return (data ?? [])
    .filter((p) => !(p.provider in DECLARED))
    .map((p) => ({
      provider: p.provider as string,
      purposes: (p.purposes ?? []) as string[],
      firstSeen: p.first_seen_at as string,
    }));
}

/** Mark them told, so the next run stays quiet. */
export async function markAnnounced(db: SupabaseClient, providers: string[]): Promise<void> {
  if (providers.length === 0) return;
  await db.from("providers_seen")
    .update({ announced_at: new Date().toISOString() })
    .in("provider", providers);
}

/**
 * The message itself. 15.3 wants Josh told what it is and what it does, not merely that a name
 * appeared — "Groq" on its own is exactly the statement-line the clause is written against.
 */
export function announcement(found: UndeclaredProvider[]): string {
  const lines = found.map((p) => {
    const since = new Date(p.firstSeen).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
    });
    const doing = p.purposes.length > 0 ? p.purposes.join(", ") : "not yet clear";
    return `  ${p.provider} — ${doing}. First used ${since}.`;
  });

  return `${found.length === 1 ? "A service is" : `${found.length} services are`} in use that ` +
    `${found.length === 1 ? "is" : "are"} not on the tool list I gave you:\n\n` +
    `${lines.join("\n")}\n\n` +
    `Telling you now rather than letting it turn up on a statement. If you would rather it was not ` +
    `there, say so and I will take it out.`;
}
