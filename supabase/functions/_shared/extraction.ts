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

import { extractFigures, extractNumbers, normalise } from "./claims.ts";
/*
 * THE ONE FILTER, ASKED RATHER THAN COPIED.
 *
 * `isRealName` is what the write path already filters `moment_names` through (handlers/interview.ts),
 * so a candidate this file reports is one that WOULD have become a row. A second copy of that rule
 * here is the exact mistake the header of this file warns about — two copies of `isSupplied` are
 * what this repository keeps paying for — and it would drift on the first role word anybody added.
 *
 * It costs nothing to import. names.ts's only import is `import type`, which both Deno and Node's
 * type stripping erase, so this stays loadable from brief.mjs on the Node side exactly as before.
 */
import { isRealName } from "./names.ts";

/**
 * The statuses that mean an idea has already been written up, so a second write-up would replace
 * material rather than create it.
 *
 * Here rather than in either caller, because both cc-submit and get_extraction_brief refuse on it
 * and the two copies of `isSupplied` are what this repository keeps paying for. A resubmission on
 * any of these overwrites material a draft's claim ledger was verified against — it needs `redo`,
 * which puts the previous entry on the record first.
 */
export const WRITTEN_UP = ["mined", "queued", "drafted", "gated", "scheduled", "published"];

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
  /**
   * Proper nouns he said that the extraction recorded no name for (rule 5).
   *
   * NOT part of `ok`, and that is deliberate rather than timid. See missingNames: this is a
   * capital-letter heuristic, and a hard refusal built on one strands him mid-session over the
   * word "Still". It is reported the way the gate reports a check it had no basis to judge — with
   * its reason attached, so a silence here means something.
   *
   * Empty when `said` was not supplied, in which case `not_checked` says so instead. "We did not
   * look" and "we looked and there was nothing" are different answers and this interface is now
   * able to tell them apart, which is the whole point of the field.
   */
  names_not_recorded: string[];
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
 *
 * It asks extractFigures of his words and extractNumbers of the entry: a figure going in, anything
 * numeric coming out. That asymmetry is deliberate and measured — see extractFigures. Checked
 * against every real entry in the project, the symmetric version reported a drop on three of five
 * and was wrong all three times, on two dates and the phrase "the two main ones I used". A warning
 * that fires that often is one he stops reading, and the figures he actually lost are all figures.
 */
export function missingNumbers(extracted: ExtractionLike, said: string): string[] {
  const carried = new Set(
    PROSE_FIELDS.flatMap((f) => (typeof extracted[f] === "string" ? extractNumbers(extracted[f] as string) : [])),
  );
  return extractFigures(said ?? "").filter((n) => !carried.has(n));
}

/**
 * Words that are capitalised in ordinary prose without naming anybody.
 *
 * WHY A LIST AND NOT A POSITION RULE
 *
 * The obvious way to find a proper noun is "a capitalised word that does not start a sentence", and
 * it is wrong in the one direction that matters: the names Josh actually drops are overwhelmingly
 * the SUBJECT of his sentences — "Jordan said", "Heidi pushed back", "Thermal don't want it" — so
 * throwing away sentence-initial words throws away most of the real finds. Keeping them means
 * keeping "So", "And", "Honestly", which `isRealName` lets through quite correctly (it rejects roles
 * and articles; it was never asked to know English function words).
 *
 * So the function words are named here, and sentence position is not consulted at all. That also
 * makes the detector deterministic in a way a position rule is not: a pasted transcript with no
 * full stops in it has no sentence positions to reason about, and a pasted transcript is exactly
 * what one_step mode feeds this.
 *
 * Months and weekdays are in the list, which costs us anyone actually called April, May, June or
 * August. That is the asymmetry this file wants, and it is the opposite of the one in names.ts:
 * there, keeping a doubtful name costs Josh one tap and dropping one lets a client be named. Here,
 * nothing is enforced on the strength of this list — a candidate is REPORTED — so a false positive
 * costs the report its credibility, which is the only thing it has. `missingNumbers` already paid
 * for that lesson: the symmetric version of it fired wrongly on three of five entries, "and a
 * warning that fires that often is one he stops reading".
 */
const SENTENCE_WORDS = new Set([
  // Articles, pronouns, conjunctions, prepositions.
  "the", "a", "an", "and", "but", "or", "nor", "so", "if", "then", "than", "as", "at", "by", "for",
  "from", "in", "into", "of", "on", "onto", "to", "with", "without", "within", "after", "before",
  "during", "since", "until", "about", "over", "under", "between", "because", "though", "although",
  "while", "whilst", "once", "upon", "per", "via", "plus", "versus",
  "i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "you", "your", "yours", "he", "him",
  "his", "she", "her", "hers", "it", "its", "they", "them", "their", "theirs", "this", "that",
  "these", "those", "who", "whom", "whose", "which", "what", "when", "where", "why", "how",
  "whether", "there", "here", "everyone", "everything", "something", "nothing", "anything",
  // Verbs and modals that start a clause.
  "is", "was", "were", "are", "be", "been", "being", "am", "do", "does", "did", "done", "doing",
  "have", "has", "had", "having", "will", "would", "can", "could", "should", "shall", "may",
  "might", "must", "let", "lets", "got", "get", "gets", "getting", "go", "goes", "going", "went",
  "come", "comes", "came", "make", "makes", "made", "take", "takes", "took", "think", "thinks",
  "thought", "know", "knows", "knew", "want", "wants", "wanted", "need", "needs", "needed", "say",
  "says", "said", "tell", "tells", "told", "ask", "asks", "asked", "give", "gives", "gave", "put",
  "puts", "see", "sees", "saw", "look", "looks", "looked", "turns", "turned", "keep", "kept",
  // Discourse markers, which is how he talks.
  "no", "not", "yes", "yeah", "yep", "nope", "ok", "okay", "well", "just", "now", "still", "also",
  "anyway", "anyhow", "honestly", "actually", "basically", "obviously", "frankly", "clearly",
  "maybe", "perhaps", "really", "very", "quite", "sure", "right", "listen", "sorry", "thanks",
  "thank", "hi", "hello", "hey", "please", "again", "even", "ever", "never", "always", "often",
  "sometimes", "usually", "either", "neither", "both", "each", "every", "all", "any", "some",
  "more", "most", "less", "least", "much", "many", "few", "fewer", "lot", "lots",
  // Counting and ordering words, which open a list and are not people.
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "first", "second",
  "third", "fourth", "fifth", "last", "next", "another", "other", "others", "new", "old", "good",
  "great", "bad", "big", "small", "long", "short", "same", "different",
  // Dates. Costs us anyone called April, May, June or August — see the note above.
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun",
  "today", "tomorrow", "yesterday", "tonight", "morning", "afternoon", "evening", "week", "month",
  "year", "day", "time",
  // Words that appear in the ALL-CAPS headers the system itself writes into raw_inputs, which are
  // capitalised for layout rather than because they name anything. Measured: "JOSH'S OWN WORDS"
  // was reported on moment 113 before these were listed.
  "own", "word", "words", "note", "notes", "thing", "things", "stuff", "context", "example",
]);

/**
 * An acronym, with or without a plural s: his trade's vocabulary, not anybody's name.
 *
 * Two letters minimum, so a single initial is not caught. Checked against the whole candidate
 * rather than word by word, so "PQS PvP" is caught and "Slingshot GTM" is not — the second one
 * names a company and happens to end in an acronym.
 */
const ALL_CAPS_JARGON = /^[\p{Lu}\p{N}][\p{Lu}\p{N}&.'-]*s?$/u;

/**
 * The eight reference writers, who can never be the answer to a clearance question.
 *
 * Measured, not guessed: `moment_names` id 49 is "Matt Barker" on moment 109 — uncleared, and the
 * ONLY name row created in the project in the fifteen days after 13 Oct 2026. Josh named him while
 * instructing the writer ("write this one like Matt Barker would"), which is a request for a shape
 * under clause 8.3 and not a person who needs protecting under 9.10. A detector that re-finds him
 * has learned nothing, and the one name it would reliably report is the one name that is noise.
 *
 * Duplicated from mcp-server/writers.mjs rather than imported, because that is a Node module and
 * this file is also the Edge Function's — the import could only ever run one way. The duplication
 * is the kind this repository keeps paying for, so it is pinned by test instead: the Node suite
 * imports both and asserts every writer in REFERENCE_WRITERS is matched here. Add a ninth writer
 * there and that test fails until this list follows.
 */
const REFERENCE_WRITER_WORDS = new Set([
  "matt", "barker", "jen", "allen-knuth", "allen", "knuth", "eric", "nowoslawski",
  "julia", "carter", "ryan", "carlin", "curtis", "howland", "aman", "ghataura",
  "adam", "treboutat",
  // "Sentinel accounts" is his own word for the eight as a group — writers.mjs's CORPUS_PHRASES,
  // where it is the only phrase he has ever actually used for them. Measured on moments 110 and
  // 111, where he is asking for the group's shape and the detector was reporting "Sentinel" as a
  // company to get clearance for.
  "sentinel", "sentinels",
]);

/**
 * Every proper noun in a piece of text that looks like it could identify somebody.
 *
 * Exported for measurement rather than for use: this is the half of the detector that can be run
 * over the corpus and counted, and it was, before `missingNames` was wired into anything. See the
 * note on missingNames for the number.
 *
 * The method, in order:
 *
 *  1. Cut the text at clause boundaries, so "Jordan, Heidi" is two candidates rather than one
 *     two-word company, and a comma cannot glue a name to the word after it.
 *  2. Inside a clause, take maximal runs of capitalised words — which is what carries "Allen-Knuth"
 *     and "Slingshot GTM" through in one piece.
 *  3. Discard runs longer than four words. A longer one is a Title Case Heading or a SHOUTED
 *     SENTENCE, never a name, and a pasted transcript contains both.
 *  4. Trim words off the front and back while `isRealName` rejects them on their own. That is how
 *     "My client Thermal" becomes "Thermal" without a second copy of the role-word list: names.ts
 *     already knows "my" is noise and "client" is a role, and asking it is cheaper than agreeing
 *     with it.
 *  5. Drop a one-word candidate whose lower-case form also appears in the text. "Still", "Every" and
 *     "Right" are capitalised at the start of one sentence and written in lower case in the next;
 *     a real name almost never is. This catches the function words the list above misses.
 *  6. Drop an all-capitals single word, which in his material is a term of art rather than a
 *     company: measured over 48 moments, the all-caps candidates were TAM, TAMs, SMB, CLI, DNS,
 *     HTML, EMRs, DM, AI, GTM, CRM, SDR, SDRs, OT, GP, GPs, PDFs, VPN, ERM, TPRM, PVP, PQS and
 *     TAC — twenty-three of them and not one a person or a client. The cost is stated in the
 *     limitations note on `missingNames`: a company called IBM or SAP is not reported.
 *  7. Require a one-word candidate to have been seen at least once somewhere OTHER than the first
 *     word of a clause.
 *
 *     THIS IS THE RULE THAT MADE IT USABLE, AND IT IS THE OPPOSITE OF WHAT THE FIRST VERSION DID.
 *     Rejecting clause-initial words outright throws away most real finds, because the names he
 *     drops are the subjects of his sentences. But asking whether a word was EVER seen mid-clause
 *     keeps those — "I asked Jordan", "mention Shoden", "My client Thermal" are all mid-clause —
 *     while dropping the title-case line headings his pasted notes are full of: Start, Result,
 *     Cost, Paid, Facts, Sources, Limits, Below, None, Subject, Stack, Size, Best. Those are only
 *     ever the first word of their line, and there were 40 of them before this rule existed. A
 *     two-word candidate is exempt: "Hardy Relations" is not punctuation wherever it sits.
 */
export function candidateNames(text: string): string[] {
  const body = String(text ?? "");
  if (body.trim().length === 0) return [];

  /*
   * The words he writes in LOWER CASE somewhere in this text, for rule 5.
   *
   * Collected from the original, not from a lower-cased copy of it. The first version of this line
   * lower-cased the body and then asked which words began with a small letter, which is every word
   * in it — so rule 5 matched every one-word candidate and the detector silently reported nothing
   * but multi-word phrases. It still found eleven of them, which is exactly why it was measured
   * before it was wired into anything.
   */
  const lowerWords = new Set(
    (body.match(/[\p{L}\p{N}'’-]+/gu) ?? [])
      .filter((w) => /^\p{Ll}/u.test(w))
      .map((w) => w.toLowerCase()),
  );
  const saidInLowerCase = (candidate: string) => lowerWords.has(candidate.toLowerCase());

  /*
   * EVERY OCCURRENCE, NOT THE FIRST — because one of them is the evidence.
   *
   * See rule 7 in the header. A one-word candidate is only kept if it was seen somewhere that is
   * not the opening word of a clause, so the display form and the best position have to be carried
   * together until the whole text has been read.
   */
  const occurrences = new Map<string, { display: string; midClause: boolean }>();
  // A Map keeps insertion order, so candidates come back in the order he said them — which is the
  // order to ask him about them in.
  const note = (candidate: string, midClause: boolean) => {
    const key = candidate.toLowerCase();
    const prior = occurrences.get(key);
    if (!prior) occurrences.set(key, { display: candidate, midClause });
    else if (midClause) prior.midClause = true;
  };

  // Clause boundaries: sentence punctuation, commas, brackets, quotes, dashes, newlines, slashes.
  for (const clause of body.split(/[.!?;:,()\[\]{}"“”«»\n\r\t|/\\]+|—|–|\s-\s/u)) {
    let run: string[] = [];
    // Where this run began among the clause's words, so "the first word of the clause" is a fact
    // rather than a guess. Counted in words, not characters.
    let runStart = 0;
    let wordIndex = 0;

    const flush = () => {
      const words = [...run];
      const startedAt = runStart;
      run = [];
      if (words.length === 0 || words.length > 4) return;

      /*
       * Trim the ends, from both directions, until the edge word could be part of a name.
       *
       * Two filters, because neither covers the other. `isRealName` knows "my" is noise and
       * "client" is a role — that is how "My client Thermal" becomes "Thermal" without a second
       * copy of names.ts's role list. SENTENCE_WORDS knows "He" and "So" are English, which
       * `isRealName` has no opinion about: it kept "He Stopped" on moment 3 and "Shoden So" on 110
       * and 111, where the second word is the start of the next clause wearing a capital letter
       * because he does not punctuate when he talks.
       *
       * Measured 28 Oct 2026: this trimming alone turned six of the thirty-six reported candidates
       * from noise into the name that was actually inside them — "Shoden So" → "Shoden", "GTM We" →
       * "GTM", "For Slingshot GTM" → "Slingshot GTM", "And GP" → "GP", "Only US" → "US".
       */
      const trimmable = (w: string) => SENTENCE_WORDS.has(w.toLowerCase()) || !isRealName(w);
      let shifted = 0;
      while (words.length > 1 && trimmable(words[0])) {
        words.shift();
        shifted++;
      }
      while (words.length > 1 && trimmable(words[words.length - 1])) words.pop();
      if (words.length === 0) return;

      const candidate = words.join(" ");
      const lower = candidate.toLowerCase();

      // Every word is a function word, so the phrase names nobody.
      if (words.every((w) => SENTENCE_WORDS.has(w.toLowerCase()))) return;
      // Any word is a reference writer's: an 8.3 instruction, not a 9.10 question.
      if (words.some((w) => REFERENCE_WRITER_WORDS.has(w.toLowerCase()))) return;
      // A single word that is also written in lower case somewhere is sentence-start punctuation
      // wearing a capital letter. A contraction is checked on its stem too, because "I'm" and
      // "That's" survive every other filter — the apostrophe makes them words no list contains.
      const stem = lower.replace(/['’].*$/u, "");
      if (
        words.length === 1 &&
        (SENTENCE_WORDS.has(lower) || SENTENCE_WORDS.has(stem) || saidInLowerCase(candidate))
      ) return;
      if (ALL_CAPS_JARGON.test(candidate)) return;
      if (!isRealName(candidate)) return;

      // A word trimmed off the front moves the candidate out of the clause's opening slot, which is
      // the whole point of "So Thermal said no": "So" is the opener, "Thermal" is mid-clause.
      note(candidate, startedAt + shifted > 0);
    };

    for (const token of clause.split(/\s+/)) {
      // Strip surrounding punctuation and the possessive, which is not part of the name.
      const word = token
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .replace(/[^\p{L}\p{N}&]+$/u, "")
        .replace(/['’][sS]$/u, "");
      if (word.length === 0) continue;
      if (/^\p{Lu}/u.test(word)) {
        if (run.length === 0) runStart = wordIndex;
        run.push(word);
      } else {
        flush();
      }
      wordIndex++;
    }
    flush();
  }

  const found: string[] = [];
  for (const { display, midClause } of occurrences.values()) {
    // Rule 7: a one-word candidate needs one sighting that is not a clause opener. A two-word
    // candidate carries its own evidence — "Hardy Relations" and "Jordan Crawford" are not
    // punctuation however they are positioned.
    if (display.includes(" ") || midClause) found.push(display);
  }

  return found;
}

/**
 * Proper nouns Josh said that the extraction recorded no name for.
 *
 * THE DIRECTION NOBODY WAS CHECKING
 *
 * Rule 3 below checks that every name RECORDED was actually said, which stops a model inventing a
 * person there is nobody to ask about. The opposite direction — a person he named and the extraction
 * did not record — had no check at all, and it is the one with the contractual consequence. The
 * entire 9.10 enforcement chain filters an array: `unclearedNames` (names.ts), `create_draft`'s
 * word-boundary refusal (write.mjs), then `verifyDraft` (claims.ts). An empty array cannot fail any
 * of them, so a moment with no `moment_names` rows is a moment where "never name a client" is
 * enforced by nothing whatsoever — and it reads identically to a moment that genuinely had no names
 * in it.
 *
 * Measured 28 Oct 2026: 31 of the 48 moments with material carry zero `moment_names` rows, every
 * moment from 100 to 114 among them. Moment 110's own material names six parties and includes Josh
 * saying "My client Thermal doesn't want me to mention Shoden… so let's drop them", and
 * `get_drafting_brief` returned `must_not_name: []`.
 *
 * REPORTED, NEVER REFUSED
 *
 * This does not and must not block. The detector is a capital-letter heuristic over a pasted
 * transcript; a hard refusal built on it would strand him mid-session on a Friday over the word
 * "Still", which is worse than the gap it closes. The precedent is the gate's `notJudged`
 * (handlers/gate.ts): a check with no basis is recorded WITH ITS REASON rather than silently
 * passing, and the thing that makes a check honest is that it says it ran.
 *
 * MEASURED BEFORE IT WAS WIRED IN, because `missingNumbers` above records what happens otherwise:
 * its symmetric version "reported a drop on three of five and was wrong all three times", and a
 * warning that fires that often is one he stops reading. So this was run over all 48 `material`
 * rows against their own `raw_inputs` and `interview_turns` answers before any caller was given it.
 *
 *   56 candidates across 48 moments — 1.17 each, firing at all on 18 of them.
 *   37 are a well-formed person or company he named and no `moment_names` row carries: Jordan,
 *     Jordan Crawford, Thermal, Shoden, Firmable, Hardy Relations, Gong, UpGuard, Anthropic,
 *     ZoomInfo, Apollo, Google, Meta, LinkedIn, Slingshot GTM, Wayback Machine and the rest.
 *   15 are malformed but point at a real name — "Department"/"Defense" from "Department of
 *     Defense", "Pilot" from "Thought Pilot" (lost to "thought" being an English verb),
 *     "Finding LinkedIn", "LinkedIn URL", "Australia In New York", "Orange Counties".
 *   4 name nothing at all: "Australian", "Closing", "Internet", "PQS PvP". One spurious candidate
 *     per twelve moments, which is the number that decided this was worth surfacing.
 *
 * On moment 110 it returns exactly Jordan, Thermal, Shoden, Firmable and Hardy Relations — five of
 * the six parties in the material that `get_drafting_brief` was reporting as `must_not_name: []`.
 *
 * WHAT IT DOES NOT CATCH, said plainly because a detector that implies more than it found is the
 * failure mode this whole file exists to fix:
 *
 *   · A name he writes in lower case. "heidi" is recorded that way on moment 90 and is in the
 *     material of 110 and 111, and nothing here will ever see it — capitalisation is the only
 *     evidence this has.
 *   · A company whose name is an acronym. Rule 6 drops IBM and SAP along with TAM and SMB.
 *   · A person called April, May, June or August, or Will, or anyone whose name is also an English
 *     word written in lower case elsewhere in the same text (rules 5 and 7).
 *   · A name that only ever appears as the first word of a clause and only once (rule 7).
 *   · Anything outside `said` — a name that reached the material through the interviewer's
 *     question rather than through him.
 *
 * It is a prompt to look, not a guarantee. The guarantee is still that `moment_names` holds what
 * was recorded; this only stops "nothing was recorded" and "there was nothing to record" reading
 * the same.
 *
 * @param extracted what the model produced
 * @param said      Josh's own words (joshSaid) — not the transcript, which contains the
 *                  interviewer's questions. A name only the interviewer used is not one he gave,
 *                  the same asymmetry missingNumbers draws for the same reason.
 */
export function missingNames(extracted: ExtractionLike, said: string): string[] {
  /*
   * Compared with the spaces and punctuation taken out, because a company writes its own name
   * closed up and he says it open. Measured: "ZoomInfo" is recorded on moments 68, 93 and 94 and he
   * types "Zoom Info" in the same breath, so three of the thirty-six first-pass candidates were a
   * name the extraction had already recorded correctly, reported back as missing over one space.
   */
  const squash = (s: string) => normalise(s).replace(/[^\p{L}\p{N}]+/gu, "");

  const recorded = (extracted.names ?? [])
    .map((n) => squash(String(n?.name ?? "")))
    .filter((n) => n.length > 0);

  return candidateNames(said).filter((candidate) => {
    const key = squash(candidate);
    // Either direction counts as recorded: "Jordan" is covered by a recorded "Jordan Reed", and a
    // recorded "Jordan" covers the candidate "Jordan Reed". Asking Josh twice about one person is
    // the nagging that makes the clearance question stop working (9.12).
    return !recorded.some((r) => r.includes(key) || key.includes(r));
  });
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

  // ── 5. Names he gave, which must not be dropped ────────────────────────────────────────────
  //
  // Rule 3's mirror image, and the one with the contractual consequence. Rule 3 stops a name being
  // invented; nothing stopped one being lost, and the entire 9.10 chain filters an array that
  // cannot fail when it is empty. REPORTED, not added to `failures` — see the field's own note.
  const unrecorded = said === undefined ? [] : missingNames(extracted, said);

  return {
    ok: failures.length === 0,
    failures,
    checked: [
      "their_actual_words appears verbatim in the source",
      "every number appears in the source",
      "every recorded name appears in the source",
      ...(said === undefined ? [] : [
        "every number Josh gave is carried into the entry",
        "proper nouns Josh said that the entry records no name for (reported, never refused)",
      ]),
    ],
    // Said out loud, because a verdict that implies more than it proved is the failure mode this
    // whole file exists to fix.
    not_checked: [
      "the prose fields, which legitimately summarise and cannot be matched verbatim",
      "whether a field that should be empty was filled with something plausible",
      // The notJudged discipline from handlers/gate.ts: a check with no basis says so, rather than
      // returning the same empty array a clean scan returns.
      ...(said === undefined
        ? ["names Josh gave that the entry dropped — his own words were not supplied, so nothing looked"]
        : []),
    ],
    names_not_recorded: unrecorded,
  };
}
