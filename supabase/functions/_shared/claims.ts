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
 *   4. no run of words may be one of the reference writers' (8.3), when the index is supplied
 *
 * Pure functions, no I/O, no model calls. Runs in Deno (Edge Functions) and Node.
 */

import { borrowedRuns } from "./shingles.ts";
// Which fields record speech. A quote may only rest on one of them — see the note there.
import { QUOTE_SOURCE_FIELDS } from "./entry.ts";

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
  /**
   * Runs of words in this draft that appear verbatim in a reference writer's post (8.3).
   * Taken from the draft, so a refusal names only what the caller already submitted.
   */
  borrowedPhrases: string[];
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

/**
 * Units and markers that make a number a FIGURE rather than a passing numeral.
 *
 * "$16", "30%", "10 years", "5,481 businesses" are figures. "the two main ones", "the second
 * question", "13 Oct 2026" are not — they are speech and dates, and they are the overwhelming
 * majority of the numbers in a transcript of somebody talking.
 */
const FIGURE_UNIT = new RegExp(
  "^(?:%|percent|per cent|years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?" +
    "|thousands?|millions?|billions?|dollars?|cents?|pounds?|euros?|people|persons?" +
    "|businesses|business|companies|company|prospects?|clients?|customers?|accounts?" +
    "|clinicians?|practices?|campuses|leads?|calls?|emails?|posts?|drafts?|words?|times?" +
    "|(?:k|x|m|bn)(?![a-z]))",
  "i",
);

/** Currency symbols, as a set rather than a regex, so no escaping can go wrong silently. */
const CURRENCY = ["$", "\u00a3", "\u20ac"];

/**
 * The numbers in a text that read as figures. A strict subset of extractNumbers.
 *
 * WHY THIS IS NOT extractNumbers
 *
 * extractNumbers answers "did the draft add a number the source does not contain", and for that
 * question a wide net is right: a false positive costs one sentence of checking, and the thing it
 * catches is an invented statistic. The opposite question — "did the write-up DROP a number he
 * gave" — has the opposite base rate. Measured against every real entry in the project on 13 Oct
 * 2026, extractNumbers reported a dropped number on three of five, and all three were false: "13"
 * and "2026" from a date stamp, "15" from "Email received Tue, Sep 15", and "2" from "the two main
 * ones I used". Nothing real was caught, because the figures that mattered were carried.
 *
 * A notice that fires on three interviews in five is one he stops reading, which is the same
 * reasoning 4.4.3 applies to candidates. So the dropping direction asks for a figure: a currency
 * amount, a percentage, or a number with a unit attached. All of the numbers Josh actually lost —
 * "the better part of 10 years", "the last six months", "Take 30% off", "under $16", "5,481
 * businesses per vertical" — are figures by that definition.
 *
 * "one" is absent from WORD_NUMBERS for the same kind of reason, one step earlier.
 */
export function extractFigures(text: string): string[] {
  const out = new Set<string>();
  const source = text ?? "";

  const scan = (re: RegExp, value: (m: string) => string) => {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(source)) !== null) {
      const token = m[0];
      const before = source.slice(Math.max(0, m.index - 2), m.index);
      const after = source.slice(m.index + token.length, m.index + token.length + 24);
      // A marker makes it a figure: a currency amount, a percentage, or a unit after it. The
      // window is trimmed rather than matched with a whitespace class, because this file is
      // edited by hand and a swallowed backslash in a regex fails silently and completely.
      const marked = CURRENCY.some((c) => token.includes(c) || before.trimEnd().endsWith(c)) ||
        token.includes("%") || FIGURE_UNIT.test(after.trimStart().replace(/^-+/, ""));
      if (!marked) continue;
      const v = value(token);
      if (v.length > 0) out.add(v);
    }
  };

  scan(NUMBER_RE, canonicaliseNumber);
  scan(WORD_NUMBER_RE, (w) => WORD_NUMBERS[w.toLowerCase().trim()] ?? "");

  return [...out];
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
 * @param referenceShingles hashed word-runs from the eight reference writers (8.3), or null when
 *   the index is not loaded. PASSED IN, never fetched: this module is pure and dual-runtime, and
 *   reaching for a database here would be the thing that stops it running in both.
 */
export function verifyDraft(
  draftBody: string,
  claims: Claim[],
  entry: SourceEntry,
  names: NameClearance[] = [],
  referenceShingles: Set<string> | null = null,
): VerificationResult {
  const verdicts = claims.map((c) => verifyOne(c, entry));
  const haystack = normalise(concatSources(entry));
  const sourceNumbers = new Set(extractNumbers(concatSources(entry)));

  const unsourcedNumbers = extractNumbers(draftBody).filter((n) => !sourceNumbers.has(n));

  /*
   * A QUOTE IS CHECKED AGAINST SPEECH, NOT AGAINST THE WHOLE ENTRY.
   *
   * This used to search `haystack`, the union of all twelve fields. So a quoted sentence verified
   * if it appeared anywhere — including inside a persona or strategy document pasted into
   * raw_inputs, which arrives as `his_words`. That is how the "$40K a year for ZoomInfo" quote
   * reached a TAM draft on 21 October, and it is why Josh filed "Real quotes only. A quote needs a
   * confirmed speaker who actually said it" the same day.
   *
   * See QUOTE_SOURCE_FIELDS. Everything else still reads the full entry.
   */
  const speechOnly = normalise(
    QUOTE_SOURCE_FIELDS.map((f) => entry[f] ?? "").filter((s) => s.trim().length > 0).join("\n\n"),
  );
  const unsourcedQuotes = extractQuotedStrings(draftBody).filter(
    (q) => !speechOnly.includes(quoteKey(q)),
  );

  const draftNormalised = normalise(draftBody);
  const unclearedNames = names
    .filter((n) => !n.cleared)
    .filter((n) => n.name.trim().length > 0)
    .filter((n) => draftNormalised.includes(normalise(n.name)))
    .map((n) => n.name);

  const borrowedPhrases = borrowedRuns(draftBody, referenceShingles);

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
    // Names which fields a quote may rest on, because the commonest cause is a real sentence from
    // the wrong field — a line out of the_lesson in quotation marks has no speaker.
    failures.push(
      `The draft quotes ${unsourcedQuotes.map((q) => `"${q}"`).join(", ")}, and nobody is ` +
        `recorded as saying it. A quote needs a confirmed speaker who actually said it — never a ` +
        `persona or a strategy document (Josh, 21 October) — so it must appear in ` +
        `${QUOTE_SOURCE_FIELDS.join(" or ")}. Two fixes, both fine: if somebody did say it, put ` +
        `their words in that field and call this again. If it is a conclusion rather than ` +
        `something said, drop the quotation marks and state it.`,
    );
  }
  if (unclearedNames.length > 0) {
    failures.push(
      `The draft names ${unclearedNames.join(", ")} without clearance for this post (9.10).`,
    );
  }
  if (borrowedPhrases.length > 0) {
    failures.push(
      `The draft reuses ${borrowedPhrases.map((p) => `"${p}"`).join(", ")} — ` +
        `${borrowedPhrases.length === 1 ? "a run" : "runs"} of words that ` +
        `${borrowedPhrases.length === 1 ? "appears" : "appear"} verbatim in a reference writer's ` +
        `post. Take the shape, never the words (8.3): rewrite the idea in Josh's own.`,
    );
  }

  return {
    ok: failures.length === 0,
    verdicts,
    unsourcedNumbers,
    unsourcedQuotes,
    unclearedNames,
    borrowedPhrases,
    failures,
  };
}
