/**
 * Structured output schemas. Enforced at the API layer via `output_config.format`, so a malformed
 * response is retried by the model rather than crashing a worker on JSON.parse.
 */

import { z } from "npm:zod@4";

/* ── Interview ─────────────────────────────────────────────────────────────── */

export const NextQuestionSchema = z.object({
  action: z
    .enum(["ask", "finish", "park"])
    .describe(
      "ask = put the next question to Josh. finish = enough material, stop and extract. " +
        "park = none of the three depths produced anything; there is no post here.",
    ),
  question: z.string().describe("The single question to ask. Empty unless action is 'ask'."),
  depth: z
    .enum(["none", "scene", "time_anchored", "earned_perspective"])
    .describe("Which depth this question is probing, or the depth reached if finishing."),
  is_pushback: z
    .boolean()
    .describe("True only if this re-asks a question Josh answered vaguely. Allowed at most once."),
  question_key: z
    .string()
    .describe(
      "If this question came from the prompt set, its key. Empty if you wrote a follow-up of your " +
        "own. Used to track which questions actually produce material (4.2.6).",
    ),
  encouragement: z
    .string()
    .describe(
      "Optional one-line note when Josh has just given something strong, so he learns what good " +
        "material feels like (5.12). Empty otherwise.",
    ),
  park_reason: z
    .string()
    .describe("Plain-language reason there is no post here. Empty unless action is 'park'."),
});

export const ExtractionSchema = z.object({
  the_moment: z.string().describe("What happened. Empty if he never gave you a moment."),
  the_detail: z.string().describe("The specific detail that makes it real. Empty if absent."),
  the_realisation: z.string().describe("What he worked out. Empty if absent."),
  the_lesson: z.string().describe("What a reader should take from it. Empty if absent."),
  what_happened_before: z.string(),
  who_was_there: z.string(),
  their_actual_words: z
    .string()
    .describe("VERBATIM only. Empty if he paraphrased rather than quoting."),
  how_he_felt: z.string(),
  what_changed: z.string(),
  reader_takeaway: z.string(),
  pillar: z
    .string()
    .describe(
      "Which content pillar this belongs to. MUST be one of the pillars listed in the prompt, " +
        "copied exactly. Empty string if none of them fits, or if none were supplied. Never " +
        "invent a pillar name.",
    ),
  audience: z.string().describe("Who this post is for. Empty if you genuinely cannot tell."),
  audience_known: z
    .boolean()
    .describe(
      "True only if Josh made the reader clear, or the moment leaves no real doubt. False when " +
        "you are guessing — a guess here steers the drafter and one of the gate checks (5.6).",
    ),
  audience_is_buyer: z.boolean(),
  strength: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("How strong this material is. 5 = a scene only he could have witnessed."),
  time_sensitive: z.boolean(),
  decays_in_days: z
    .number()
    .int()
    .describe("Roughly how many days until it stops being worth posting. 0 if not time sensitive."),
  names: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(["person", "company"]),
      }),
    )
    .describe("Every person and company mentioned anywhere in the conversation."),
});

/* ── Drafting ──────────────────────────────────────────────────────────────── */

export const ClaimSchema = z.object({
  claim: z.string().describe("The factual assertion the post makes."),
  kind: z.enum(["quote", "number", "name", "event", "detail"]),
  source_field: z
    .string()
    .describe("Which field of the entry it rests on, e.g. 'their_actual_words'."),
  source_span: z
    .string()
    .describe(
      "The VERBATIM span from that field. Copied exactly, not paraphrased. This is checked " +
        "mechanically against the source text and the draft is rejected if it does not appear.",
    ),
});

export const DraftSchema = z.object({
  hook: z.string().describe("The opening line, repeated here so it can be checked on its own."),
  body: z.string().describe("The complete post, including the hook, ready to publish."),
  framework: z.string().describe("Which body framework from the library you used."),
  claims: z.array(ClaimSchema).describe("The claim ledger. Every factual claim, with its span."),
  audience_note: z.string().describe("One line on who you wrote this for and why it lands for them."),
});

/* ── The gate ──────────────────────────────────────────────────────────────── */

export const GateVerdictSchema = z.object({
  passed: z.boolean().describe("False if the post fails this check. Unsure means false."),
  reason: z
    .string()
    .describe(
      "Why it failed, in plain language Josh would find useful. Empty only when passed is true.",
    ),
});

/* ── Triage (candidates only) ──────────────────────────────────────────────── */

export const TriageSchema = z.object({
  candidates: z
    .array(
      z.object({
        summary: z
          .string()
          .describe("What happened, in a sentence or two. Neutral. Never what Josh concluded."),
        why_interesting: z.string().describe("Which of the named criteria this meets, and how."),
        strength: z.number().int().min(1).max(5),
        opening_question: z
          .string()
          .describe("The one question to put to Josh to start mining this."),
        names: z.array(z.object({ name: z.string(), kind: z.enum(["person", "company"]) })),
      }),
    )
    .describe("Empty is the expected result most of the time. Do not pad it."),
});

/* ── Visuals ───────────────────────────────────────────────────────────────── */

export const VisualSchema = z.object({
  svg: z.string().describe("A complete self-contained SVG document."),
  notes: z.string().describe("What you took from the reference and how you rebuilt it differently."),
});

/* ── Learning ──────────────────────────────────────────────────────────────── */

export const ProposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        section_key: z
          .enum([
            "pillars",
            "frameworks",
            "hooks",
            "closes",
            "audience",
            "voice_guide",
            "prompt_set",
            "banned_phrases",
            "formatting",
            "gate_rules",
          ])
          .describe("core_rules is not available here and never will be."),
        claim: z.string().describe("The specific, evidenced claim. Names the posts behind it."),
        evidence: z
          .object({
            post_ids: z.array(z.number().int()),
            observation: z.string(),
          })
          .describe("Specific posts. A proposal without post ids is not a proposal."),
        proposed_body: z.string().describe("The complete new text for that section."),
      }),
    )
    .describe("Empty when the evidence is thin. A quiet month is an honest outcome."),
});

/* ── Monthly reporting ─────────────────────────────────────────────────────── */

export const ReportSchema = z.object({
  what_is_working: z.string().describe("With the underlying posts named, not summarised."),
  what_is_not: z.string().describe("With the underlying posts named, not summarised."),
  recommendation: z.string(),
});

/* ── 7.2, when embeddings are unavailable ──────────────────────────────────── */

/**
 * The fallback shape for "has he told this story before".
 *
 * Two booleans rather than one, because 7.2 draws a line the clause is explicit about: repeating the
 * anecdote is out, rewriting an angle is fine. Collapsing them would either block honest second
 * looks at a theme or wave through the same story twice.
 */
export const RetellingSchema = z.object({
  is_retelling: z
    .boolean()
    .describe(
      "The same specific incident: same conversation, same person, same moment. Not merely the " +
        "same subject. When unsure, false — a false positive silences a story never told.",
    ),
  same_theme_different_angle: z
    .boolean()
    .describe("Same territory, genuinely different story or conclusion. Allowed, but worth saying."),
  matches: z
    .string()
    .describe("Which prior post or moment, quoted enough to recognise. Empty when neither is true."),
  reasoning: z.string().describe("One or two sentences. Read by a person when a block looks wrong."),
});
