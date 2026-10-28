/**
 * The extraction, declared ONCE, because two declarations of it broke the one rule that cannot
 * fail open.
 *
 * WHAT WENT WRONG
 *
 * `submit_extraction` declared the real shape — eighteen fields, six of them not strings. On the
 * 13 October one-step path, `write_post` declared the same parameter as `z.record(z.string())`, so
 * for fifteen days the tool Josh actually uses could not accept:
 *
 *   names               an array, and the only input to the never-name-a-client rule
 *   audience_known      a boolean, and the switch that decides whether the audience is stored
 *   audience_is_buyer   a boolean
 *   time_sensitive      a boolean
 *   strength            a number, and what decides whether a thin idea parks itself
 *   decays_in_days      a number
 *
 * It is a hard refusal rather than a silent strip — `z.object({extracted: z.record(z.string())})`
 * answers an array with `invalid_type`, "expected string, received array" — so a caller that tried
 * to pass names was told no and learned not to try again. The consequence is a draft written with
 * nothing in `moment_names`, and every link in the 9.10 chain filters that array: `unclearedNames`
 * in names.ts, `create_draft`'s word-boundary refusal in write.mjs, then `verifyDraft` in claims.ts.
 * AN EMPTY ARRAY CANNOT FAIL ANY OF THEM. Measured 28 Oct 2026: 31 of the 48 moments with material
 * hold zero name rows, including every moment from 100 to 114, and moment 110's own material has
 * him saying "My client Thermal doesn't want me to mention Shoden… so let's drop them" while
 * `get_drafting_brief` returned `must_not_name: []`.
 *
 * The proof the fix belongs here rather than deeper: exactly ONE `moment_names` row exists in the
 * whole project created after 13 October — id 49, "Matt Barker" on moment 109 — and it cannot have
 * come through `write_post`, because that schema rejects arrays. It came from a direct
 * `submit_extraction` call, which declares this shape and therefore accepts names. The tool with
 * the right schema works. Only the tool with the wrong schema was broken.
 *
 * WHY THIS IS ITS OWN FILE, AND NOT AN EXPORT FROM write.mjs
 *
 * `tools/index.mjs` loads write.mjs before onestep.mjs, and onestep.mjs imports the registry back —
 * the cycle mode.test.mjs documents at its own import site. Exporting the shape from write.mjs
 * would work today and break the first time anybody reorders that list, with a failure that reads
 * as `EXTRACTION is not defined` three files away from the edit. A leaf module importing nothing
 * but zod cannot participate in a cycle, which is the same discipline mode.mjs and shape-rows.mjs
 * already follow.
 *
 * WHY IT IS NOT IMPORTED FROM schemas.ts, WHICH IS THE REAL AUTHORITY
 *
 * `ExtractionSchema` is `npm:zod@4`, a Deno specifier Node cannot resolve — the reason model.mjs
 * writes its own JSON schemas too. The edge function stays the authority: it parses and validates
 * against the transcript. This exists to tell a caller what the fields ARE, and is pinned to
 * schemas.ts by test rather than by hope.
 */

import { z } from "zod";

/**
 * Every text field is optional and defaults to empty, because "leave it empty" is the instruction
 * that matters most here and a required field quietly pressures a model to fill it. A filled field
 * becomes the source of truth a later draft is verified against claim by claim, so a reasonable
 * guess in one of these is a fabrication two steps later with a verifier agreeing it is sound.
 */
const TEXT = () => z.string().optional().default("");

/**
 * A boolean, or the two strings a caller sends when it has been told everything is a span of text.
 *
 * WHY THE STRINGS ARE SPELLED OUT INSTEAD OF COERCED
 *
 * `Boolean("false")` is `true`. A naive coercion here would turn an honest "I am guessing about the
 * reader" into "the reader is certain", which is the precise failure 5.6 exists to prevent, and it
 * would do it silently and in the confident direction. So the two acceptable strings are listed,
 * mapped by hand, and everything else — "yes", "1", "maybe", "" — is refused with this message.
 * A refusal a caller can read and retry in the same breath beats a value nobody chose.
 *
 * The describe() is applied by the caller rather than here, and that is not a style choice:
 * `schema.description` does not read through a `.optional()` or `.default()` wrapper, so a field
 * built as `boolish("…").optional()` has no description at all for anything that asks the object
 * what its fields mean. Keeping describe() outermost at each field keeps it readable.
 */
const boolish = () =>
  z.union([
    z.boolean(),
    z.enum(["true", "false"]).transform((s) => s === "true"),
  ], {
    error:
      'must be true or false. A real boolean, or exactly the string "true" or "false" — not "yes", ' +
      '"1" or "". It is listed rather than coerced because "false" is a truthy string in ' +
      "JavaScript, and guessing in that direction is the bug this field exists to stop.",
  });

/**
 * A whole number, or the digits of one as a string, for the same reason.
 *
 * The real schema goes first in the union so the JSON Schema a model is shown carries the actual
 * bounds — `strength` reads as an integer from 1 to 5 rather than as "a number".
 */
const wholeNumber = (inner) =>
  z.union([
    inner,
    z.string().regex(/^-?\d+$/, "must be a whole number, or the digits of one as a string")
      .transform(Number).pipe(inner),
  ]);

/** One recorded name. Recording it does not clear it and does not name anybody (9.10). */
const NAME = z.object({
  name: z.string().min(1).describe("The name as he said it, nothing added"),
  kind: z.enum(["person", "company"]).describe("Which it is. There is no third option to reach for"),
});

export const EXTRACTION = z.object({
  the_moment: TEXT().describe("What happened. Empty if he never gave you a moment."),
  the_detail: TEXT().describe("The specific detail that makes it real. Empty if absent."),
  the_realisation: TEXT().describe("What he worked out. Empty if absent."),
  the_lesson: TEXT().describe("What a reader should take from it. Empty if absent."),
  what_happened_before: TEXT().describe("What led up to it. Empty if he did not say."),
  who_was_there: TEXT().describe(
    "Who was in the room, as he described them. Roles are fine here and are usually better — " +
    "the names themselves go in `names` below, which is what gets him asked.",
  ),
  their_actual_words: TEXT()
    .describe("VERBATIM only. If he paraphrased what someone said, leave this empty."),
  how_he_felt: TEXT().describe("In his words, not a word you would have chosen. Empty if absent."),
  what_changed: TEXT().describe("What was different afterwards. Empty if absent."),
  reader_takeaway: TEXT().describe("What a reader does differently. Empty if absent."),
  pillar: TEXT().describe("One of the pillars in the brief, copied exactly, or empty."),
  audience: TEXT().describe(
    "Who this post is for. Empty if you genuinely cannot tell. Only stored if audience_known is " +
    "not false — the two travel together, so an audience here with the flag left out is an " +
    "audience that reaches the drafter as a guess.",
  ),
  audience_known: boolish().describe(
    "REQUIRED. True only if he made the reader clear, or the moment leaves no real doubt. False " +
    "when you are guessing: a guessed reader steers the drafter and the aimed_at_someone gate " +
    "check, and \"a post aimed at everyone\" is the second most common reason drafts are rejected " +
    "here (8 of 13). This is the field that prevents it, so false is a real answer and the honest " +
    "one more often than it looks.",
  ),
  audience_is_buyer: boolish().describe(
    "REQUIRED. True if that reader is someone who could buy from him. False for peers, juniors " +
    "and the merely interested.",
  ),
  strength: wholeNumber(z.number().int().min(1).max(5)).describe(
    "REQUIRED, and honestly — 1 to 5, where 5 is a scene only he could have witnessed. There is " +
    "deliberately no default: with nothing learned from a moment, this is what decides whether it " +
    "parks itself rather than burning three draft-and-gate cycles to reach the same answer " +
    "(clause 1, 9.8). A number put here to fill the field is a judgement nobody made.",
  ),
  time_sensitive: boolish().describe(
    "REQUIRED. True if this stops being worth posting after a while. Most moments are not.",
  ),
  decays_in_days: wholeNumber(z.number().int().min(0)).optional().default(0).describe(
    "Roughly how many days until it stops being worth posting. 0 when it does not, which is the " +
    "default and is usually right. Only read when time_sensitive is true.",
  ),
  names: z.array(NAME).optional().default([]).describe(
    "EVERY person and company he actually mentioned, and nobody he did not. This is the field the " +
    "never-name-a-client rule is built on: every check downstream FILTERS this array — the " +
    "clearance question, create_draft's refusal, the gate, the claim ledger — so an empty array " +
    "passes all of them and a name missing from it is a name nothing can stop reaching a post. " +
    "Recording a name does not name anyone and does not clear anyone: it asks Josh, once, while " +
    "the moment is fresh. On moment 110 he said \"My client Thermal doesn't want me to mention " +
    "Shoden… so let's drop them\" and the drafting brief came back with nothing to not-name — " +
    "that sentence is exactly when this array matters most. Empty only when he named nobody.",
  ),
});

/**
 * The field names, for callers that need to say how many there are without counting by hand.
 *
 * Four tool descriptions said "the ten fields" while the shape had eighteen, and a model counting
 * to ten and stopping is a model obeying its tool. Read off the schema so the sentence cannot fall
 * behind it again.
 */
export const EXTRACTION_FIELDS = Object.keys(EXTRACTION.shape);

/** "the ten material fields, plus eight more" — the honest way to describe this in prose. */
export const FIELD_COUNT = EXTRACTION_FIELDS.length;
