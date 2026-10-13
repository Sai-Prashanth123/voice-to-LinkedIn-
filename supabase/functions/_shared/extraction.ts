/**
 * Checking the idea bank entry itself, which nothing has ever done.
 *
 * THE HOLE THIS CLOSES
 *
 * claims.ts verifies every assertion in a draft against the entry, span by span, with zero
 * tolerance (9.4). That guarantee rests entirely on the entry being true — and the entry is written
 * by a model that was asked nicely not to invent things. EXTRACT_SYSTEM says it in as many words:
 *
 *   "every field you fill becomes the source of truth that a later draft is checked against"
 *
 * Nothing checked it. A quote tidied into something better at extraction time becomes the verbatim
 * source a draft is then rigorously verified against, and every downstream check agrees the post is
 * clean. The most careful part of this system is built on the least checked part of it.
 *
 * WHAT CAN BE CHECKED, AND WHAT DELIBERATELY CANNOT
 *
 * Extraction SUMMARISES. "The CFO stopped me halfway through the deck" is a condensation of several
 * turns, and demanding it appear verbatim in the transcript would reject every honest extraction
 * ever made. So the prose fields are not checked, and pretending otherwise would be worse than not
 * checking at all.
 *
 * What IS checked is exactly the three rules EXTRACT_SYSTEM states as absolutes, each of which is a
 * factual claim about the source rather than a summary of it:
 *
 *   1. their_actual_words "must be VERBATIM. If he paraphrased what someone said, leave it empty."
 *   2. "Do not add numbers he did not give you. Do not round the ones he did."
 *   3. "Do not name anyone he did not name."
 *
 * Those three are where fabrication actually does damage: an invented quote reaches a post as a
 * quotation, an invented number reaches it as a fact, and an invented name reaches 9.10.
 *
 * Import-free on purpose, the same as entry.ts and acceptance.ts, so the Node side reads the same
 * rules the Edge Function enforces rather than a second copy of them.
 */

import { extractNumbers, normalise } from "./claims.ts";

/** The text fields of an extraction, as the schema defines them. */
export const PROSE_FIELDS = [
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

export interface ExtractionLike {
  their_actual_words?: string | null;
  names?: { name?: string | null }[] | null;
  [field: string]: unknown;
}

export interface ExtractionVerdict {
  ok: boolean;
  /** Plain-language failures, in the shape the rest of the system reports them. */
  failures: string[];
  /** What was checked, so a caller can say what it proved rather than implying more. */
  checked: string[];
  /** Named so nobody reads a pass as "the whole extraction was verified". */
  not_checked: string[];
}

/**
 * What Josh himself said: what he sent, then his answers. The interviewer's questions are left out,
 * because a number the interviewer used is not one he gave.
 */
export function joshSaid(seed: string, turns: { role: string; body: string }[]): string {
  return [seed, ...turns.filter((t) => t.role === "answer").map((t) => t.body)].join("\n\n");
}

/**
 * Numbers he gave that appear in no field of the entry.
 *
 * The other half of rule 2. "Do not add numbers" was checked; dropping them was not, and the entry
 * is the only thing a draft may cite. On 13 Oct 2026 two extractions of the same interview each
 * lost "10 years", "six months", "30%" and "$16", so the post that interview existed to produce
 * could not state a single one of them.
 */
export function missingNumbers(extracted: ExtractionLike, said: string): string[] {
  const carried = new Set(
    PROSE_FIELDS.flatMap((f) => (typeof extracted[f] === "string" ? extractNumbers(extracted[f] as string) : [])),
  );
  return extractNumbers(said ?? "").filter((n) => !carried.has(n));
}

/**
 * @param extracted what the model produced
 * @param source    everything it was shown: what Josh sent, plus the interview transcript
 * @param said      Josh's words alone (joshSaid). When given, every number in it must be carried.
 */
export function verifyExtraction(
  extracted: ExtractionLike,
  source: string,
  said?: string,
): ExtractionVerdict {
  const failures: string[] = [];
  const haystack = normalise(source ?? "");

  // ── 1. The quote, which must be his words and not a tidied version of them ──────────────────
  //
  // Trailing sentence punctuation is allowed to differ, the same latitude claims.ts gives and for
  // the same reason: a quotation takes the punctuation of the sentence it sits in. Interior words
  // are untouched.
  const quote = String(extracted.their_actual_words ?? "").trim();
  if (quote.length > 0) {
    const key = normalise(quote).replace(/[.,;:!?]+$/, "").trim();
    if (key.length > 0 && !haystack.includes(key)) {
      failures.push(
        `their_actual_words is "${quote}", which does not appear in what Josh said. ` +
          `A quote that was paraphrased must be left empty (5.9).`,
      );
    }
  }

  // ── 2. Numbers, across every prose field ───────────────────────────────────────────────────
  //
  // An invented statistic in the entry is worse than one in a draft: the draft's would be caught by
  // the claim ledger, and this one becomes the thing the ledger checks against.
  const sourceNumbers = new Set(extractNumbers(source ?? ""));
  const invented = new Set<string>();
  for (const field of PROSE_FIELDS) {
    const value = extracted[field];
    if (typeof value !== "string" || value.length === 0) continue;
    for (const n of extractNumbers(value)) {
      if (!sourceNumbers.has(n)) invented.add(n);
    }
  }
  if (invented.size > 0) {
    failures.push(
      `The extraction records ${[...invented].map((n) => `"${n}"`).join(", ")}, which Josh ` +
        `never gave. Numbers are not to be added or rounded (5.9).`,
    );
  }

  // ── 3. Names ───────────────────────────────────────────────────────────────────────────────
  //
  // A name that was never said cannot be cleared by anyone, because there is nobody to ask. It
  // would sit uncleared forever and block a moment that never needed clearing.
  const unsaid: string[] = [];
  for (const entry of extracted.names ?? []) {
    const name = String(entry?.name ?? "").trim();
    if (name.length === 0) continue;
    if (!haystack.includes(normalise(name))) unsaid.push(name);
  }
  if (unsaid.length > 0) {
    failures.push(
      `The extraction names ${unsaid.join(", ")}, who Josh never mentioned. ` +
        `Nobody may be named who was not named (5.9).`,
    );
  }

  // ── 4. Numbers he gave, which must not be dropped ──────────────────────────────────────────
  const dropped = said === undefined ? [] : missingNumbers(extracted, said);
  if (dropped.length > 0) {
    failures.push(
      `Josh gave ${dropped.map((n) => `"${n}"`).join(", ")}, which no field of the extraction ` +
        `carries. A number left out of the entry can never reach a post (5.9).`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    checked: [
      "their_actual_words appears verbatim in the source",
      "every number appears in the source",
      "every recorded name appears in the source",
      ...(said === undefined ? [] : ["every number Josh gave is carried into the entry"]),
    ],
    // Said out loud, because a verdict that implies more than it proved is the failure mode this
    // whole file exists to fix.
    not_checked: [
      "the prose fields, which legitimately summarise and cannot be matched verbatim",
      "whether a field that should be empty was filled with something plausible",
    ],
  };
}
