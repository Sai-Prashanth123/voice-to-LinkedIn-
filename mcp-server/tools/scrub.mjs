/**
 * The AI-decontamination pass, as a tool.
 *
 * WHY IT DETECTS BUT DOES NOT REWRITE
 *
 * The source document (ai-trait-scrubber.md) is written for a pipeline where the scrubber rewrites
 * and hands a certificate to the next stage. That shape does not survive the move here, and forcing
 * it would make the result worse.
 *
 * There is no model behind this server. A "rewrite" implemented in these files could only be
 * find-and-replace, and find-and-replace produces precisely the failure the document lists in its
 * own anti-patterns: over-sanitized prose with the specifics filed off, a voice-specific word
 * swapped for a generic synonym, a long sentence broken that was long on purpose.
 *
 * But the caller IS a model, holding the voice guide. So the division is the honest one: this tool
 * does the part a machine does perfectly — finding every instance of thirty rules and citing which
 * rule and which line — and hands back the standard for the model to rewrite against. The machine
 * never misses one; the model never flattens one.
 *
 * WHY IT LOADS THE LIBRARY EVERY CALL
 *
 * Because the alternative is two standards. The banned-phrases section is what gate check 8 judges
 * against and what the drafter is given. If this tool carried its own copy of the rules in prose,
 * a draft could pass here and fail the gate, or worse, pass both against different rules. It reads
 * the same rows the briefs read, so there is one answer to "what are the rules" at any moment.
 *
 * WHAT IT IS NOT
 *
 * A verdict. Same stance as measure_draft: nothing here passes or fails a draft, and the gate still
 * decides. A post with fifteen findings can still be the right post if a human looks and disagrees
 * with fifteen regexes.
 */

import { z } from "zod";

import { scan } from "../aitells.mjs";
import { renderLibrary } from "../../supabase/functions/_shared/views.ts";

/**
 * The five rubric dimensions, split by what can honestly be computed.
 *
 * Rhythm and density have measurable proxies — sentence variance, and the share of sentences
 * carrying no specific detail. The other three require reading the post and knowing the client.
 * Scoring those here with a formula would produce a number that looks like a measurement and is
 * actually a guess, which is the worst of both.
 */
function rubric(measured, findings, body) {
  const spread = measured.longest_sentence - measured.shortest_sentence;

  return {
    computed: {
      rhythm: {
        sentence_word_spread: spread,
        reading: spread >= 15
          ? "varied — short and long sentences mix"
          : spread >= 8
            ? "some variation, but the range is narrow"
            : "flat — nearly every sentence is the same length",
        uniform_runs: findings.filter((f) => f.rule === "2C-5").length,
      },
      density: {
        sentences: measured.sentences,
        sentences_with_a_number: (body.match(/\b\d[\d,.]*\b/g) ?? []).length,
        filler_and_vocabulary_hits: findings.filter((f) => f.rule === "2A" || f.rule === "2B").length,
      },
    },

    // Posed, not scored. Answer them by reading the post.
    to_judge: {
      directness: "Does every sentence advance the argument, or does the reader wade through setup "
        + "before the point lands?",
      trust: "Is there a specific detail, number or moment a reader can picture — or generic claims "
        + "with no anchor?",
      authenticity: "Does the post admit a limit, a tradeoff or a place he was wrong?",
    },
  };
}

export const scrubTools = [
  {
    name: "scrub_draft",
    config: {
      title: "Scan a draft for AI traits, rule by rule",
      description:
        "Runs every mechanically-decidable AI-tell rule against a post and reports each hit with " +
        "its rule id, line, matched text and fix. Catches the constructions a model cannot catch " +
        "in itself: negative parallelism (\"it's not X, it's Y\"), repeated bullet shapes, " +
        "throat-clearing, copulative avoidance, participle traps, uniform rhythm. Deterministic — " +
        "no model call, no cost, and it cannot invent a violation. It does NOT rewrite: it returns " +
        "the findings plus the live banned-phrases and voice-guide sections so YOU rewrite in his " +
        "voice. Run it after measure_draft and before create_draft.",
      inputSchema: {
        body: z.string().min(1).describe("The post as it would be published"),
        include_library: z.boolean().optional()
          .describe("Include the full banned-phrases and voice-guide text to rewrite against. " +
            "Default true — leave it on unless you already hold them in context."),
      },
    },

    async handler(args, context) {
      const { db } = context;
      const body = args.body;
      const result = scan(body);

      // The same rows the briefs read, rendered through the same function, so this tool and the
      // gate cannot be looking at different rules.
      let library = null;
      if (args.include_library !== false) {
        const rows = await db.select("library_sections", {
          select: "key,title,body,sort_order",
          order: "sort_order.asc",
        });
        const { sections } = renderLibrary(rows, "gating");
        library = {
          banned_phrases: sections.banned_phrases ?? "",
          voice_guide: sections.voice_guide ?? "",
          note: "Read from library_sections at call time. This is the same text gate check 8 " +
            "judges against — if it is empty here it is empty there.",
        };
      }

      return {
        findings: result.findings,
        counts: result.counts,
        measured: result.measured,

        rubric: rubric(result.measured, result.findings, body),

        judgement_rules: result.judgement,

        voice_exemptions: {
          exempt: result.exemptions,
          why: "These constructions are NOT flagged because the voiceprint measures him using " +
            "them. Stripping them would remove what identifies him, which is the failure this " +
            "whole pass exists to prevent.",
        },

        rewrite_discipline: [
          "Preserve voice markers. Do not flatten his phrasing in the pursuit of AI removal.",
          "Preserve hook specificity. A strong specific hook with an em dash loses the em dash, " +
            "not the hook.",
          "Preserve deliberate fragments. Not every short sentence is a tell.",
          "Delete the rejected frame rather than rewording it. \"It's not X, it's Y\" becomes Y, " +
            "stated once, with a detail.",
          "When a flag is a judgement call, say so and leave it. Do not force a rewrite to clear " +
            "a count.",
        ],

        library,

        verdict: result.counts.total === 0
          ? "No mechanical AI tells. Whether it is a post only Josh could have written is the " +
            "gate's question, not this one's."
          : `${result.counts.total} finding(s) across ${Object.keys(result.counts.by_rule).length} ` +
            `rule(s). Rewrite against the voice guide, then run this again.`,
      };
    },
  },
];
