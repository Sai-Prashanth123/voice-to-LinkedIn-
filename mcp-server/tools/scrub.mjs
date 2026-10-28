/**
 * The AI-decontamination pass, as a tool.
 *
 * WHY IT DETECTS BUT DOES NOT REWRITE
 *
 * The source document (docs/reference/ai-trait-scrubber.md) is written for a pipeline where the scrubber rewrites
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
import { willRefuse } from "../prefile.mjs";
// The carve-outs measure_draft applies from a static mirror. This tool loads the library, so it is
// the one that can say whether Josh still allows them — see lexicon_carve_outs below.
import { carveOutsFor } from "./measure.mjs";
import { renderLibrary } from "../../supabase/functions/_shared/views.ts";
import { sd as stdev, sentences, words } from "../../scripts/lib/prose.mjs";
import { corpusBand, writerTarget } from "./voice.mjs";
import { WRITER_CHOICES } from "../writers.mjs";

/**
 * The five rubric dimensions, split by what can honestly be computed.
 *
 * Rhythm and density have measurable proxies — sentence variance, and the share of sentences
 * carrying no specific detail. The other three require reading the post and knowing the client.
 * Scoring those here with a formula would produce a number that looks like a measurement and is
 * actually a guess, which is the worst of both.
 */
function rubric(measured, findings, body, { sd = null, target = null, band = null } = {}) {
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
        /*
         * WHAT THE THRESHOLDS ABOVE ARE WORTH, CHECKED ON 28 OCTOBER AND SAID PLAINLY.
         *
         * Two separate problems, and only one of them is now fixed.
         *
         * The counter was wrong: `longest_sentence` and `shortest_sentence` came from the LEXICON
         * tokeniser, which drops "I", "a" and every number, so a spread compared against anything
         * measured with `words()` was comparing two different quantities. aitells.mjs now counts
         * with `words()`, the counter every stored sentinel median rests on, so these are
         * comparable with the corpus for the first time.
         *
         * The thresholds are still NOT corpus-derived, and 15 and 8 were nobody's measurement.
         * They cannot be: the corpus stores sd_median — the standard deviation of a post's
         * sentence lengths — and a spread (longest minus shortest) is a different statistic, with
         * no stored counterpart to calibrate against. Two long sentences and one short one give a
         * wide spread and a modest sd.
         *
         * So the spread reading is kept and labelled, and the MEASURED statistic is reported
         * beside it, where it can be compared with the writers properly. The reading is a
         * description; the sd is the number.
         */
        spread_thresholds: "15 and 8 are not measured. The corpus stores sd_median, not a spread, " +
          "so these two readings have no stored counterpart to be calibrated against — they are " +
          "a description, not a target. sentence_words_sd below is the measured statistic.",
        sentence_words_sd: sd,
        ...(target && { against_the_writer_asked_for: target }),
        ...(band && { against_the_corpus: band }),
        counted_with: measured.counted_with,
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
      /*
       * READING ORDER, added 26 October. Josh: "The posts jump around and don't tie the points
       * together. One paragraph rarely leads into the next. This feels like it needs a judgement on
       * reading order rather than a word-level check."
       *
       * He named the right home for it. It is here rather than in the gate because no number
       * decides it, and scoring it would produce something that looks like a measurement and is a
       * guess — which is what this block's own header says `to_judge` exists to avoid.
       *
       * THE LAST SENTENCE IS THE LOAD-BEARING ONE. The obvious reading of "it doesn't flow" is "add
       * connectives", and that would fight a rule this same tool enforces: the AI-trait reference
       * lists a sentence announcing what comes next as removable filler, and rule 2A flags
       * "consequently", "moreover" and "ultimately" by name. So the only remedies offered are move
       * and cut.
       *
       * Four questions is the ceiling. A writer shown fifteen lines reads none of them.
       */
      order: "Take the paragraphs in the order they stand. For each one, what does the reader know "
        + "at the end that they did not know at the start? If two next to each other answer that "
        + "the same way, one is not earning its place. If a paragraph depends on something that "
        + "only arrives later, it is in the wrong place. The fix is to MOVE it or CUT it — never to "
        + "write a sentence joining them: a sentence whose only job is to announce what comes next "
        + "is 2A filler, and this same tool flags it.",
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
        writer_handle: z.string().optional().describe(
          `The reference writer this draft was written for, if one was named: ${WRITER_CHOICES}. ` +
            "Their measured sentence variation is then reported beside the corpus range. Omit " +
            "when no writer was asked for.",
        ),
      },
    },

    async handler(args, context) {
      const { db } = context;
      const body = args.body;
      const result = scan(body);

      // Same refusal as measure_draft and compare_to_references: an unknown handle is never
      // answered with the default by way of a silent fallback.
      const target = args.writer_handle ? writerTarget(args.writer_handle) : null;
      if (target?.refused) return { refused: target.refused, handle: target.handle };

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

      /*
       * SCRUB, OR START AGAIN?
       *
       * This pass used to hand back findings and leave the caller to fix them line by line, however
       * many there were. That is right for a draft with three tells in it and wrong for a draft that
       * is AI-voiced to the core: sanding each flagged line individually converges everything to the
       * same beige, because what gets fixed is the surface and what is wrong is the register.
       *
       * The rule is borrowed from a working system that had the same problem and measured its way
       * out: if clearing the findings would mean rewriting more than about a third of the lines, the
       * draft is not a good post with slop on top. Re-read the voice brief and write it again whole,
       * in one breath.
       *
       * Counted in LINES touched rather than findings, because ten flags on one sentence is one
       * sentence to fix, and the question being asked is how much of the post survives.
       */
      /*
       * ONE BASE FOR THE RATIO, AND BOTH NUMBERS NAMED IN THE OUTPUT — 28 October.
       *
       * The denominator was the NON-BLANK lines and the numerator was finding line numbers, which
       * count raw newlines including blanks. Two consequences, and the visible one is the smaller:
       *
       *  - It printed "3 of 21 lines carry a finding" and then put findings on line 25 and line
       *    36. A line number outside its own total is not a number a reader can use.
       *  - The re-voice threshold itself was computed on mismatched bases, so a post with many
       *    blank lines under-counted its share and a dense one over-counted — and that ratio is
       *    what decides between "fix these lines" and "throw it away and write it again".
       *
       * So the share is counted in NON-BLANK lines on both sides: `non_blank_line` comes off each
       * finding, from the one map in aitells.mjs. Both bases are reported because both are real —
       * the raw number is what an editor shows and is how a writer finds the line.
       */
      const bodyLines = body.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const touched = new Set(
        result.findings.map((f) => f.non_blank_line).filter((n) => Number.isInteger(n)),
      );
      const touchedRaw = new Set(
        result.findings.map((f) => f.line).filter((n) => Number.isInteger(n)),
      );
      const share = bodyLines.length > 0 ? touched.size / bodyLines.length : 0;

      /*
       * A ratio needs enough lines to mean anything.
       *
       * The threshold is a third, and on a three-line post a single flagged line is already 33% — so
       * the first version of this told the writer to throw away one of Josh's genuinely good drafts
       * because one line of it mentioned a number. The ratio only becomes evidence of a register
       * problem once there is a post's worth of lines to be wrong about.
       *
       * So two conditions, not one: a third of the lines AND at least three of them. Below that it is
       * an ordinary scrub, which is the cheaper mistake — fixing three lines by hand costs nothing,
       * and rewriting a good post wholesale loses it.
       */
      const RE_VOICE_SHARE = 0.3;
      const RE_VOICE_MIN_LINES = 3;

      const action = result.findings.length === 0
        ? "clean"
        : share > RE_VOICE_SHARE && touched.size >= RE_VOICE_MIN_LINES
        ? "re-voice"
        : "scrub";

      /*
       * WHAT create_draft WILL REFUSE, beside the action rather than buried in the findings.
       *
       * This tool reads the library at call time (above), so unlike measure_draft it can check the
       * library-derived rules properly and its answer here is exact. It is the same module
       * create_draft throws from.
       *
       * The distinction matters: "scrub" means fix these lines, "will_refuse" means the draft
       * cannot be filed at all until they are gone.
       */
      const willNotFile = willRefuse(body, {
        sections: library
          ? { banned_phrases: library.banned_phrases, voice_guide: library.voice_guide }
          : null,
      });

      /*
       * THE LIBRARY HALF OF THE LEXICON CARVE-OUT — 28 October.
       *
       * measure_draft suppresses its `here's` flag for "Here's my system:", which Josh added to
       * `banned_phrases` himself on 13 October. It has to apply that from a static mirror, because
       * it makes no database call by design (guards.test.mjs hands it an empty context and asserts
       * it still works). This tool DOES load the library, so it is the one that can say whether the
       * line the mirror copies is still there.
       *
       * THE DIRECTION OF THE RISK IS WHY THIS EXISTS AT ALL. prefile.mjs's rule is that a check can
       * only be narrower than the library, never broader, because "a refusal that outlived the rule
       * it came from would be the system inventing a standard of its own". A CARVE-OUT that
       * outlived its line fails the same rule with the sign flipped: it would go on ignoring
       * something Josh had re-banned, and nothing anywhere would say so. Same device as
       * RULE_PRESENT, matched as loosely, for the same reason — he rewords these sections himself.
       *
       * Reported, never a refusal. A withdrawn carve-out means measure_draft's mirror is stale, and
       * the fix is a code change; refusing a draft over it would punish the writer for it.
       */
      const carveOuts = carveOutsFor(body).map((c) => {
        const live = library ? c.library.test(library.banned_phrases ?? "") : null;
        return {
          term: c.term,
          matched: c.matched,
          allowed_by: `${c.section}, Josh ${c.added}. His words: "${c.his_words}".`,
          still_in_the_library: live,
          means: live === null
            ? "include_library was off on this call, so the live section was not read. Pass it on " +
              "to have this checked."
            : live
            ? `Confirmed against the live ${c.section}. measure_draft is right to suppress its ` +
              `lexicon flag for "${c.term}" on this body.`
            : `GONE from the live ${c.section}. Josh has withdrawn the carve-out, so ` +
              `measure_draft's static mirror is now broader than the library and is suppressing a ` +
              `flag for "${c.term}" that should fire. Fix LEXICON_CARVE_OUTS in ` +
              `mcp-server/tools/measure.mjs; do not work around it here.`,
        };
      });

      return {
        action,
        ...(carveOuts.length > 0 && { lexicon_carve_outs: carveOuts }),
        will_refuse: willNotFile.length > 0
          ? {
            count: willNotFile.length,
            why: willNotFile,
            note: "create_draft refuses these and stores nothing. They are not part of the scrub — "
              + "the draft does not exist until they are fixed.",
          }
          : { count: 0 },
        action_means: action === "clean"
          ? "Nothing mechanical to fix. The judgement questions below still apply — they are the half " +
            "a regex cannot answer."
          : action === "scrub"
          ? `${touched.size} of ${bodyLines.length} lines carry a finding. Fix them in place, keeping ` +
            `his phrasing: the point is to remove the tell, not to smooth the line.`
          : `${touched.size} of ${bodyLines.length} lines carry a finding — more than a third. STOP ` +
            `scrubbing. A draft this far in is not a good post with slop on top of it, and fixing ` +
            `each line separately is how every post ends up sounding the same. Re-read ` +
            `get_voice_brief and the idea's material, then write it again whole, in one go.`,
        lines_touched: touched.size,
        lines_total: bodyLines.length,
        line_base: `Both counts above are NON-BLANK lines, which is the base the share is ` +
          `computed on: ${touched.size} of ${bodyLines.length}. Every finding also carries a ` +
          `raw "line" — blank lines included, the number an editor shows — and a ` +
          `"non_blank_line" to match it back here. The raw lines run to ${result.measured.lines_raw}` +
          `, so a finding on raw line ${result.measured.lines_raw} is not outside its own total.`,
        lines_touched_raw: touchedRaw.size,

        findings: result.findings,
        counts: result.counts,
        measured: result.measured,
        quoted_text: result.quoted_text,

        rubric: rubric(result.measured, result.findings, body, {
          // The same counter the findings were measured with and the stored medians rest on, so
          // this sd is comparable with the writers' sd_median rather than merely near it.
          sd: stdev(sentences(body).map(words).filter((n) => n > 0)),
          target: target
            ? `${target.name}'s median post has an sd of ${target.sd} words. ${target.basis}`
            : null,
          band: (() => {
            const b = corpusBand("sd_median");
            return b
              ? `The writers run ${b.low} to ${b.high}. A range is not a target, and it is wide ` +
                "enough to pass almost anything — if a writer was named, pass writer_handle."
              : null;
          })(),
        }),

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
