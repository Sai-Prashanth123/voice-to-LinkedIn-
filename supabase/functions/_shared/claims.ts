/**
 * THE CLAIM LEDGER — deterministic verification of clause 9.4.
 *
 *   "Every factual claim, quote, number and name in the draft must trace to something in the idea
 *    bank entry. Nothing else may appear."
 *
 * Asking a model "is anything made up here?" is a judgement call, and acceptance test 6 allows zero
 * tolerance. So the drafter is required to emit a ledger alongside the post: every claim it makes,
 * with the verbatim span of the idea bank entry that claim rests on. This module then checks those
 * spans mechanically. A fabricated quote, number or name has no span to point at and fails here,
 * before any model opinion is involved.
 *
 * Three checks run independently of the ledger, because a drafter that invents something is unlikely
 * to volunteer it as a claim:
 *   1. every number in the draft must appear somewhere in the source entry
 *   2. every double-quoted string in the draft must appear in the source entry
 *   3. no uncleared name may appear (9.10)
 *
 * Pure functions, no I/O, no model calls. Runs in Deno (Edge Functions) and Node.
 */

export type ClaimKind = "quote" | "number" | "name" | "event" | "detail";

export interface Claim {
  /** What the draft asserts. */
  claim: string;
  kind: ClaimKind;
  /** Which field of the idea bank entry it rests on, e.g. "their_actual_words". */
  source_field: string;
  /** The verbatim span from that field. Must appear in it. */
  source_span: string;
}

/** The subset of the idea bank entry a draft is allowed to draw on. */
export type SourceEntry = Record<string, string | null | undefined>;

export interface NameClearance {
  name: string;
  cleared: boolean;
}

export interface ClaimVerdict {
  claim: Claim;
  ok: boolean;
  reason?: string;
}

export interface VerificationResult {
  ok: boolean;
  verdicts: ClaimVerdict[];
  unsourcedNumbers: string[];
  unsourcedQuotes: string[];
  unclearedNames: string[];
  /** Plain-language failures, suitable for the gate's rejection reason (9.8). */
  failures: string[];
}

/** A span shorter than this cannot meaningfully evidence anything. */
const MIN_SPAN_LENGTH = 4;

/**
 * Normalise for comparison without being so lenient that a paraphrase passes as a quote.
 * Case, whitespace, smart punctuation and unicode form only.
 */
export function normalise(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A quote, ready to be looked for in the source.
 *
 * Same normalisation as everything else, plus ONE extra allowance: sentence punctuation at the very
 * end is dropped. A quotation takes the punctuation of the sentence it sits in, so a source holding
 *
 *     if Dan goes, we start from zero
 *
 * is quoted correctly as `"if Dan goes, we start from zero."` — and the strict check called that a
 * fabricated quote and failed the draft. Seen live on M-000008, where the claim ledger rejected a
 * quote that was verbatim apart from a full stop the writer could not have omitted.
 *
 * That is the only latitude given. Interior words are untouched, nothing is stemmed, and a
 * paraphrase still fails — 9.4 has zero tolerance at acceptance and a check that quietly accepted
 * "near enough" would be worse than no check. Trailing punctuation is not near enough; it is the
 * same words.
 */
function quoteKey(quote: string): string {
  return normalise(quote).replace(/[.,;:!?]+$/, "").trim();
}

/** Everything the draft was allowed to see, as one haystack. */
export function concatSources(entry: SourceEntry): string {
  return Object.values(entry).filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");
}

const NUMBER_RE = /(?:[$£€]\s?)?\d[\d,]*(?:\.\d+)?\s?%?/g;

/**
 * Written-out numerals, because "seven out of ten deals" is exactly the shape of invented statistic
 * a language model reaches for, and it contains no digits at all.
 *
 * "one" is deliberately absent: in English it is overwhelmingly a pronoun or article ("one of the
 * things", "no one"), and flagging it would reject honest drafts constantly. From "two" upward the
 * non-numeric usage is rare enough that a flag is nearly always correct.
 */
const WORD_NUMBERS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30",
  forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000", million: "1000000", dozen: "12",
};

const WORD_NUMBER_RE = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "gi");

/**
 * Numeric tokens, canonicalised so that "1,200" / "1200" and "ten" / "10" all compare equal.
 * Draft and source go through the same extractor, so a source saying "three calls" covers a draft
 * saying "3 calls".
 */
export function extractNumbers(text: string): string[] {
  const digits = (text.match(NUMBER_RE) ?? []).map(canonicaliseNumber);
  const words = (text.match(WORD_NUMBER_RE) ?? []).map((w) => WORD_NUMBERS[w.toLowerCase()]);
  return [...new Set([...digits, ...words])].filter((n) => n.length > 0);
}

function canonicaliseNumber(token: string): string {
  return token.replace(/[$£€,\s]/g, "").replace(/%$/, "");
}

/**
 * Double-quoted strings only. Single quotes are indistinguishable from apostrophes in prose and
 * would produce false positives on every possessive.
 */
export function extractQuotedStrings(text: string): string[] {
  const normalised = text
    .replace(/[“”‟″]/g, '"');
  const out: string[] = [];
  const re = /"([^"\n]{2,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalised)) !== null) out.push(m[1].trim());
  return [...new Set(out)];
}

function verifyOne(claim: Claim, entry: SourceEntry): ClaimVerdict {
  const span = (claim.source_span ?? "").trim();

  if (span.length === 0) {
    return { claim, ok: false, reason: "no source span given" };
  }
  if (span.length < MIN_SPAN_LENGTH && !/^\d+$/.test(span)) {
    return { claim, ok: false, reason: `source span "${span}" is too short to evidence anything` };
  }

  const fieldValue = entry[claim.source_field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    return {
      claim,
      ok: false,
      reason: `source field "${claim.source_field}" is empty or does not exist in the entry`,
    };
  }

  if (!normalise(fieldValue).includes(normalise(span))) {
    return {
      claim,
      ok: false,
      reason: `span "${span}" does not appear in ${claim.source_field}`,
    };
  }

  // The span must actually carry the claim's numbers, otherwise a claim can cite an unrelated
  // sentence from the right field and pass.
  const claimNumbers = extractNumbers(claim.claim);
  const spanNumbers = new Set(extractNumbers(span));
  const missing = claimNumbers.filter((n) => !spanNumbers.has(n));
  if (missing.length > 0) {
    return {
      claim,
      ok: false,
      reason: `claim cites ${missing.join(", ")} but the span does not contain it`,
    };
  }

  return { claim, ok: true };
}

/**
 * Verify a draft against its source entry.
 *
 * @param draftBody the post as written
 * @param claims    the ledger the drafter emitted
 * @param entry     the idea bank entry fields the drafter was given
 * @param names     per-moment name clearance (9.10)
 */
export function verifyDraft(
  draftBody: string,
  claims: Claim[],
  entry: SourceEntry,
  names: NameClearance[] = [],
): VerificationResult {
  const verdicts = claims.map((c) => verifyOne(c, entry));
  const haystack = normalise(concatSources(entry));
  const sourceNumbers = new Set(extractNumbers(concatSources(entry)));

  const unsourcedNumbers = extractNumbers(draftBody).filter((n) => !sourceNumbers.has(n));

  const unsourcedQuotes = extractQuotedStrings(draftBody).filter(
    (q) => !haystack.includes(quoteKey(q)),
  );

  const draftNormalised = normalise(draftBody);
  const unclearedNames = names
    .filter((n) => !n.cleared)
    .filter((n) => n.name.trim().length > 0)
    .filter((n) => draftNormalised.includes(normalise(n.name)))
    .map((n) => n.name);

  const failures: string[] = [];
  for (const v of verdicts) {
    if (!v.ok) failures.push(`Unsupported claim: "${v.claim.claim}" — ${v.reason}.`);
  }
  if (unsourcedNumbers.length > 0) {
    failures.push(
      `The draft uses ${unsourcedNumbers.map((n) => `"${n}"`).join(", ")}, which does not appear ` +
        `anywhere in the moment. If Josh did not say it, it does not go in.`,
    );
  }
  if (unsourcedQuotes.length > 0) {
    failures.push(
      `The draft quotes ${unsourcedQuotes.map((q) => `"${q}"`).join(", ")}, which was never said ` +
        `in the source material.`,
    );
  }
  if (unclearedNames.length > 0) {
    failures.push(
      `The draft names ${unclearedNames.join(", ")} without clearance for this post (9.10).`,
    );
  }

  return {
    ok: failures.length === 0,
    verdicts,
    unsourcedNumbers,
    unsourcedQuotes,
    unclearedNames,
    failures,
  };
}
