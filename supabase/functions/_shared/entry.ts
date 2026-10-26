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

/**
 * Two more things a claim may rest on, added 14 October 2026.
 *
 * WHY THE TEN FIELDS WERE NOT ENOUGH
 *
 * Until now a claim could only cite one of the ten fields above, which are a SUMMARY of what Josh
 * said, written by a model. Three consequences, all of them visible in his drafts:
 *
 *   His own words were not citable. He pastes a paragraph; the extractor rewrites it into ten
 *   fields; a claim must then quote the rewrite rather than the thing he actually typed. A detail
 *   that did not survive the summary cannot reach a post at all, however plainly he said it.
 *
 *   A topic with no scene was refused outright. "Write about why tool-built TAMs miss SMB" has no
 *   moment, no detail and no realisation, so applyExtraction parked it with "not enough to write
 *   from" — correct when the only source is one message, wrong when he has a receipts file full of
 *   his own career, method and numbers.
 *
 *   The receipts file says it may be used as a source and the server refused it, because it is not
 *   one of the ten. It is not even in the library: the live rulebook has fourteen sections and
 *   receipts is not among them.
 *
 * WHAT HAS NOT CHANGED, AND MUST NOT
 *
 * Every claim is still checked word for word against the text it names. Widening WHERE a fact may
 * come from is not the same as relaxing WHETHER it is checked, and 9.4 is untouched: if the span is
 * not in the source it names, nothing is stored. These two sources are his own words — what he
 * typed, and what he has told us about himself — so "never invent" means exactly what it did.
 *
 * The published archive is still absent, and still must be: clause 8a.
 */
export const EXTRA_SOURCES = [
  /** What he actually typed, stored as he wrote it, with no ten-field split. */
  "his_words",
  /** His career, method and numbers, as he has given them to us over time. */
  "receipts",
] as const;

/** Everything a claim may name. The ten first, because that is the order the drafter reads. */
export const CLAIMABLE_FIELDS = [...SOURCE_FIELDS, ...EXTRA_SOURCES] as const;

/**
 * WHERE A QUOTE MAY COME FROM, which is narrower than where a fact may come from.
 *
 * The quote check searched the union of all twelve fields, so a quoted sentence verified if it
 * appeared ANYWHERE in the entry — including in a persona or strategy document Josh had pasted into
 * raw_inputs, which lands in `his_words`. That is exactly how a made-up `"$40K a year for ZoomInfo"`
 * quote reached a TAM draft on 21 October, after which he filed the rule himself:
 *
 *   "Real quotes only. A quote needs a confirmed speaker who actually said it. Never take a quote
 *    from a persona or strategy document."
 *
 * A quote is a claim about who SAID something, so it may only rest on the field that records
 * speech. A line sitting in `the_lesson` or `reader_takeaway` is a conclusion somebody drew, not a
 * thing anybody said, and putting quotation marks round it invents a speaker.
 *
 * `his_words` IS DELIBERATELY NOT ON THIS LIST, and that is the whole fix.
 *
 * The first version of this included it, on the reasoning that what Josh typed is a legitimate
 * source for a quote. It is not, for this check: `his_words` is the raw paste from raw_inputs,
 * whatever he put there — and on 21 October what he put there was a strategy document. So including
 * it reopens the exact hole. A test asserts the live shape of that failure, and it is what caught
 * the first version.
 *
 * This is stricter than it looks and it is meant to be. A genuine quote has a home: the extraction
 * step records what somebody said in `their_actual_words`, verbatim by schema. If a quote is in the
 * paste and not in that field, the answer is to put it in that field, not to widen this list. And a
 * sentence that is a conclusion rather than something said has an easier fix still — drop the
 * quotation marks. The failure message says both.
 *
 * This narrows the quote check only. Numbers and every other claim still read the full entry.
 */
export const QUOTE_SOURCE_FIELDS = ["their_actual_words"] as const;

export type ExtraSources = Partial<Record<(typeof EXTRA_SOURCES)[number], string | null>>;

/**
 * Where each extra source lives, named once so the two runtimes cannot drift.
 *
 * Deno reaches the database through SupabaseClient and Node through its own wrapper, so the two
 * loaders genuinely have to be separate functions. What they must NOT disagree on is which rows
 * they load — that is the shape of every "two readers of one rule" bug this repository has paid
 * for, from isSupplied to NEEDS_SOURCE. So the table and key are here, and a test asserts both
 * loaders use them.
 */
export const RECEIPTS_SECTION = "receipts";
export const HIS_WORDS_TABLE = "raw_inputs";

/**
 * @param extra the wider sources, when the caller has them. Callers that pass nothing get exactly
 *              what they got before this existed, which is why the twelve existing call sites did
 *              not have to change.
 */
export function sourceEntry(material: MaterialLike, extra: ExtraSources = {}): Record<string, string> {
  const entry: Record<string, string> = {};
  if (material) {
    for (const f of SOURCE_FIELDS) {
      const v = (material as Record<string, unknown>)[f];
      if (typeof v === "string" && v.trim().length > 0) entry[f] = v;
    }
  }
  for (const f of EXTRA_SOURCES) {
    const v = extra[f];
    if (typeof v === "string" && v.trim().length > 0) entry[f] = v;
  }
  return entry;
}
