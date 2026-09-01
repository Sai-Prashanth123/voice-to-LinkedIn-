/**
 * The exact set of fields the drafter is allowed to see (9.1: "only the idea bank entry and the
 * reference library"). Built here, in one place, so no worker can widen it by accident — and so the
 * claim ledger verifies against precisely what the drafter was given.
 *
 * Note what is absent: the published archive. Clause 8a is explicit that it must never inform how a
 * post is written.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IMPORTS NOTHING
 *
 * It used to live in db.ts, which imports the Supabase client and so can only be read by Deno. When
 * the MCP server needed to assemble the same entry for Claude Code, that left two choices: copy the
 * field list into Node, or move it somewhere both can read. A copy would have been the worse kind
 * of duplicate — the two lists would diverge, and the symptom would be a drafter shown a field the
 * claim ledger does not verify against, or a claim rejected for resting on material the drafter was
 * never given. Neither would look like a field-list problem.
 *
 * Import-free on purpose, the same as acceptance.ts: Node 22+ strips the types and reads it
 * verbatim, so there is exactly one list.
 */

/**
 * Loose on purpose — Deno passes a typed Material, Node passes a PostgREST row.
 *
 * `object` rather than `Record<string, unknown>`: an interface without an index signature is not
 * assignable to a Record, so the stricter-looking type would have rejected the only caller that
 * existed before this file did.
 */
export type MaterialLike = object | null | undefined;

/** Order matters: it is the order the drafter reads them in. */
export const SOURCE_FIELDS = [
  "the_moment",
  "the_detail",
  "the_realisation",
  "the_lesson",
  "what_happened_before",
  "who_was_there",
  "their_actual_words",
  "how_he_felt",
  "what_changed",
  "reader_takeaway",
] as const;

export function sourceEntry(material: MaterialLike): Record<string, string> {
  const entry: Record<string, string> = {};
  if (!material) return entry;
  for (const f of SOURCE_FIELDS) {
    const v = (material as Record<string, unknown>)[f];
    if (typeof v === "string" && v.trim().length > 0) entry[f] = v;
  }
  return entry;
}
