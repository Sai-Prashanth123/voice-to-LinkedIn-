/**
 * Measuring a draft before anything is spent on judging it.
 *
 * WHY THIS EXISTS
 *
 * Writing three drafts by hand through this server showed the same thing three times: a handful of
 * mechanical faults are decidable without a model, and every one of them costs a full gate run to
 * discover. An em dash, an opening question, a sentence rhythm that reads as one long flat block.
 *
 * The pre-check that caught those was a script written by hand and thrown away. This is that
 * script, made a tool, so the next writer gets it without knowing to build one.
 *
 * IT IS A MEASUREMENT, NOT A VERDICT
 *
 * The same stance _shared/diff.ts takes about edit classification: the numbers exist so a writer
 * can see where a draft sits, not so a tool can pass or fail it. The gate decides. Nothing here
 * blocks anything, and a draft that reads oddly on every number can still be the right post.
 *
 * WHICH SOURCE EACH NUMBER COMES FROM, BECAUSE THEY ARE NOT INTERCHANGEABLE
 *
 * The voiceprint is computed from SPEECH — six recorded calls. It says so at the top of itself, and
 * it is explicit that the rhythm figures do not transfer:
 *
 *   "Spoken sentences run shorter and hedge more than written ones for everybody, so the rhythm
 *    figures are a baseline for his thinking, not a target for his posts. The lexicon travels
 *    between the two registers; the sentence lengths do not."
 *
 * So sentence length is compared against the SENTINEL corpus — 59 real posts by seven writers he
 * chose — and the lexicon and surface habits come from the voiceprint. Using his spoken sd of 16.3
 * as a target would be a confident, precise and completely wrong instruction.
 */

import { z } from "zod";

import { measurePost, per1k, tokens } from "../../scripts/lib/prose.mjs";
import voiceprint from "../../data/josh/law/voiceprint.json" with { type: "json" };
import sentinels from "../../data/josh/sentinels/latest.json" with { type: "json" };

/**
 * The four reference writers whose STRUCTURE matches what Josh's own rules describe — long, prose
 * rather than bullets, a scene before the fold. The other three are "the cut": very short openers,
 * heavy lists, everything below the fold. Both are in the corpus; only one is a useful comparison.
 *
 * Named here rather than derived because the split is a judgement recorded in the reference_posts
 * library section, not something the measurements decide on their own.
 */
const SCENE_WRITERS = new Set(["demandjen1", "juliacarter98", "outboundphd", "mattjbarker1"]);

function band(handles) {
  const values = (sentinels.report ?? [])
    .filter((r) => handles.has(r.handle))
    .map((r) => r.sd_median)
    .filter((n) => typeof n === "number")
    .sort((a, b) => a - b);
  return values.length ? { low: values[0], high: values[values.length - 1] } : null;
}

/** Where a value sits relative to a measured range, said in words rather than as a verdict. */
function placement(value, range) {
  if (!range) return "no reference range available";
  if (value < range.low) return `below all of them (${range.low}–${range.high})`;
  if (value > range.high) return `above all of them (${range.low}–${range.high})`;
  return `within their range (${range.low}–${range.high})`;
}

export const measureTools = [
  {
    name: "measure_draft",
    config: {
      title: "Measure a draft against the corpus, before the gate",
      description:
        "Deterministic measurements of a post — sentence rhythm, surface habits, vocabulary — " +
        "compared against the 59 reference posts and Josh's computed voiceprint. No model call, " +
        "so it costs nothing and cannot invent. Run it BEFORE create_draft: it catches the " +
        "mechanical faults that otherwise take a full gate run to discover. It is a measurement " +
        "and not a verdict: nothing here passes or fails a draft, and the gate still decides.",
      inputSchema: {
        body: z.string().min(1).describe("The post as it would be published"),
      },
    },

    async handler(args) {
      const body = args.body;
      const m = measurePost(body);

      const sceneBand = band(SCENE_WRITERS);
      const allBand = band(new Set((sentinels.report ?? []).map((r) => r.handle)));

      // Surface habits DO transfer from speech to writing — the voiceprint says the lexicon
      // travels between registers even though sentence length does not.
      const emDashes = (body.match(/[—–]/g) ?? []).length;
      const words = tokens(body);
      const total = words.length;
      const youDensity = per1k(words.filter((w) => w === "you" || w === "your" || w === "you've" || w === "you're").length, total);

      // The voiceprint stores these as { word, count, mine_per_1k, theirs_per_1k, ratio }, not as
      // bare strings — so the word is read off the entry rather than assumed to be the entry.
      const used = new Set(words);
      const wordsFrom = (list) =>
        (list ?? []).map((e) => String(e?.word ?? e).toLowerCase()).filter((w) => used.has(w));

      const avoided = wordsFrom(voiceprint.contrast?.peer_words_he_avoids);
      const signature = wordsFrom(voiceprint.contrast?.signature_terms);

      /*
       * Only what is genuinely decidable without judgement.
       *
       * An em dash is a fact: zero across 11,022 words of him talking. An opening question is a
       * rule the library states outright. Everything else is reported as a position, not a fault,
       * because "your sentences vary less than four of seven reference writers" is information and
       * "too flat" is an opinion this tool has no business having.
       */
      const flags = [];
      if (emDashes > 0) {
        flags.push(
          `${emDashes} em dash${emDashes === 1 ? "" : "es"}. His count across 11,022 words of ` +
          `recorded speech is zero, and the banned-phrases section calls them an AI tell.`,
        );
      }
      if (m.opening_shape === "question") {
        flags.push(
          `The first line is a question. The hook rules say never open with one, and 55 of the ` +
          `59 reference posts do not.`,
        );
      }
      if (avoided.length > 0) {
        flags.push(
          `Uses ${avoided.join(", ")} — words the reference writers use far more than he does. ` +
          `One is nothing; several together is a draft drifting toward their voice.`,
        );
      }

      return {
        words: m.words,
        paragraphs: m.paragraphs,

        rhythm: {
          sentence_words_mean: m.sentence_words_mean,
          sentence_words_sd: m.sentence_words_sd,
          shortest: m.shortest_sentence,
          longest: m.longest_sentence,
          against_the_scene_writers: placement(m.sentence_words_sd, sceneBand),
          note: "Compared with the 59 measured reference posts, NOT with his voiceprint. That is " +
            "computed from speech, and the voiceprint says outright that its rhythm figures do " +
            "not transfer to writing.",
        },

        length: {
          words: m.words,
          against_all_seven: placement(
            m.words,
            { low: Math.min(...(sentinels.report ?? []).map((r) => r.median_words)),
              high: Math.max(...(sentinels.report ?? []).map((r) => r.median_words)) },
          ),
          note: "Their medians run from 53 to 408 words and all of it works. There is no target " +
            "length, and the formatting section says nothing gets padded to reach one.",
        },

        surface: {
          em_dashes: emDashes,
          opening_shape: m.opening_shape,
          close_shape: m.close_shape,
          uses_list: m.uses_list,
          colon_lines: m.colon_lines,
          you_address_per_1k: youDensity,
        },

        lexicon: {
          signature_terms_used: signature,
          peer_words_used: avoided,
        },

        flags,

        verdict: flags.length === 0
          ? "Nothing mechanical to fix. Whether it is a post only Josh could have written is the " +
            "gate's question, not this one's."
          : `${flags.length} thing(s) worth fixing before spending a gate run.`,
      };
    },
  },
];
