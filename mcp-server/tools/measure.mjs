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
 * So sentence length is compared against the SENTINEL corpus — the real posts by the writers he
 * chose — and the lexicon and surface habits come from the voiceprint. Using his spoken sd of 16.3
 * as a target would be a confident, precise and completely wrong instruction.
 */

import { z } from "zod";

import { measurePost, per1k, sentences, tokens, turnAt } from "../../scripts/lib/prose.mjs";
import { scan, HIGH_CONFIDENCE } from "../aitells.mjs";
import { prefileVerdict } from "../prefile.mjs";
import {
  FOLD_BLANK_COST,
  FOLD_CHARS_PER_LINE,
  FOLD_LINES,
} from "../../supabase/functions/_shared/shape.ts";
import { medianWordRange } from "./voice.mjs";
import voiceprint from "../../data/josh/law/voiceprint.json" with { type: "json" };
import sentinels from "../../data/josh/sentinels/latest.json" with { type: "json" };

/** The spread of habitual length, derived rather than written out. See voice.mjs. */
const RANGE = medianWordRange(sentinels.report) ?? { low: 0, high: 0 };

/** Read from the measurements rather than written out. See the note in voice.mjs. */
const MEASURED = sentinels.posts ??
  (sentinels.report ?? []).reduce((n, r) => n + (r.posts_measured ?? 0), 0);

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
        `compared against the ${MEASURED} reference posts and Josh's computed voiceprint. No model call, ` +
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

      /*
       * The writers' shape, from the same stored measurements as every other band here.
       *
       * The gate reads these from the database because it must judge against what is current. This
       * tool is the free look beforehand and already works from the stored report, so it reads the
       * same place it reads sentence variation and length from — one source per tool rather than a
       * second connection for one number.
       *
       * A writer with no measurable posts contributes nothing rather than a zero. Most of what the
       * console returns is one unbroken line, and a zero would drag the range down to meet it.
       */
      const shapeTargets = {
        paragraphs: (sentinels.report ?? [])
          .map((r) => r.paragraphs_median)
          .filter((n) => typeof n === "number" && n > 0),
        aboveFold: (sentinels.report ?? [])
          .map((r) => r.above_fold_words_median)
          .filter((n) => typeof n === "number" && n > 0),
      };

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
          `${MEASURED} reference posts do not.`,
        );
      }
      if (avoided.length > 0) {
        flags.push(
          `Uses ${avoided.join(", ")} — words the reference writers use far more than he does. ` +
          `One is nothing; several together is a draft drifting toward their voice.`,
        );
      }

      /*
       * The AI-tell rules that are as decidable as an em dash.
       *
       * Only the high-confidence subset reaches `flags`, because this tool is read in passing and a
       * writer who sees fifteen lines here stops reading all fifteen. The rest — rule of three,
       * filler words, uniform paragraphs, the judgement questions — live in scrub_draft, which is
       * called by somebody who has asked for the full pass.
       *
       * Every one of these is a construction that is simply wrong rather than merely worth noticing,
       * and the fix is mechanical. "It's not X, it's Y" has no version that survives review.
       */
      /*
       * One block of prose, flagged. Not "too few paragraphs" — there is no such number, and one of
       * his writers runs a median of four. What has no example anywhere in the corpus is a post of
       * any length that was never broken at all.
       */
      if (m.paragraphs <= 1 && m.words >= 60) {
        flags.push(
          `One paragraph, ${m.words} words, nothing broken out. Every reference writer measured ` +
          `breaks their posts up; the lowest median is 4 paragraphs. This is the shape Josh asked ` +
          `about on 14 October, and the ninth gate check judges it.`,
        );
      }
      /*
       * The one new flag, and it is a boolean rather than a threshold.
       *
       * Josh's actual question — does the hook finish before the cut — needs no calibrated number
       * beyond the position of the cut itself, which is why it is safe to surface while the
       * constants are provisional. A word-count threshold is not, and is deliberately absent.
       */
      if (!m.hook_above_fold && m.words >= 25) {
        flags.push(
          `The hook does not finish above the fold. On a phone a reader sees about ` +
          `"${m.above_fold_rendered.replace(/\n/g, " / ")}" and then "see more" — the first ` +
          `sentence runs past it. Shorten the opening or break it earlier. (Simulated cut, ` +
          `uncalibrated: act on this, but do not quote the number to Josh.)`,
        );
      }
      if (m.above_fold_words >= 90) {
        flags.push(
          `${m.above_fold_words} words above the fold. The writers run to 74.5 at the most, and a ` +
          `reader decides whether to tap on what sits above it.`,
        );
      }

      const turn = turnAt(sentences(body));
      const tells = scan(body);
      const loud = tells.findings.filter((f) => HIGH_CONFIDENCE.has(f.rule));
      for (const f of loud) {
        flags.push(`${f.rule} ${f.name} — "${f.matched}" (line ${f.line}). ${f.fix}`);
      }

      /*
       * WHAT create_draft WILL ACTUALLY REFUSE.
       *
       * This tool is the free look, and a free look that does not predict the refusal is worse than
       * none: it teaches a caller that the warnings are optional, which is exactly how scrub_draft
       * came to be read and ignored. Same module, same answer, no model call.
       *
       * No library is loaded here — this tool deliberately makes no database call (see the header)
       * — so the library-derived checks come back advisory rather than blocking. The AI tells, which
       * are the ones that actually refuse today, need no library and are exact.
       *
       * SO BOTH LISTS ARE REPORTED, and this is a correction made the same day.
       *
       * The first version called `willRefuse(body)` and printed "Nothing here would stop
       * create_draft filing it" whenever the blocking list was empty. For a draft closing on an
       * engagement ask that was false: the refusal is gated on the live `banned_phrases` text, so
       * with no library in hand it lands in `advisory` and the headline claimed the opposite of what
       * create_draft would do. scrub_draft, which does load the library, disagreed with this tool.
       *
       * That broke the contract in prefile.mjs's own header — "the free look has to predict the
       * refusal exactly" — on the day it was written. And the guard for it tested only bullet soup,
       * which needs no library, so it passed straight over the hole. Reporting what was seen but
       * could not be decided is the honest answer; claiming nothing was found is not.
       */
      const prefile = prefileVerdict(body);
      const willNotFile = prefile.blocking.map(
        (f) => `${f.source} — "${f.matched}"${f.line ? ` (line ${f.line})` : ""}. ${f.fix}`,
      );
      // Seen here, decidable only against the live library — so create_draft may still refuse them.
      const undecided = prefile.advisory
        .filter((f) => f.note)
        .map((f) => `${f.source} — "${f.matched}". ${f.fix}`);

      return {
        words: m.words,
        paragraphs: m.paragraphs,

        /*
         * First, because it is the only thing here that stops a draft. Everything below is a
         * number to read and move on from; this is what create_draft will throw on.
         */
        will_refuse: willNotFile.length > 0
          ? {
            count: willNotFile.length,
            why: willNotFile,
            ...(undecided.length > 0 && { and_probably: undecided }),
            note: "create_draft will refuse this draft and store nothing. Fix these first — the "
              + "rest of this report is measurement, not a verdict.",
          }
          : undecided.length > 0
          ? {
            count: 0,
            probably: undecided,
            note: "Nothing AI-tell-shaped would stop it, but the above breaks a rule that lives in "
              + "the library, and this tool makes no database call so it cannot read the live text "
              + "to be sure. create_draft will read it and will almost certainly refuse. Treat the "
              + "list above as a refusal, or call scrub_draft, which does read the library.",
          }
          : {
            count: 0,
            note: "Nothing found here would stop create_draft filing it. The library-derived rules "
              + "are checked again at filing against the live library, which this tool does not "
              + "read.",
          },

        rhythm: {
          sentence_words_mean: m.sentence_words_mean,
          sentence_words_sd: m.sentence_words_sd,
          shortest: m.shortest_sentence,
          longest: m.longest_sentence,
          against_the_scene_writers: placement(m.sentence_words_sd, sceneBand),
          note: `Compared with the ${MEASURED} measured reference posts, NOT with his voiceprint. That is ` +
            "computed from speech, and the voiceprint says outright that its rhythm figures do " +
            "not transfer to writing.",
        },

        length: {
          words: m.words,
          against_all_seven: placement(m.words, RANGE),
          note: `Their medians run from ${RANGE.low} to ${RANGE.high} words and all of it works. ` +
            "There is no target length, and the formatting section says nothing gets padded to " +
            "reach one.",
        },

        surface: {
          em_dashes: emDashes,
          opening_shape: m.opening_shape,
          close_shape: m.close_shape,
          uses_list: m.uses_list,
          colon_lines: m.colon_lines,
          you_address_per_1k: youDensity,
        },

        /*
         * How it sits on a phone, which this tool computed and then dropped.
         *
         * `above_fold_words` — the three lines LinkedIn shows before "see more" — has been in
         * measurePost since it was written and never appeared here. It is the single most
         * shape-relevant number there is, and the writer who needed it was the one person who never
         * saw it. Josh, on 14 October: "it's quite text-heavy... rather than just a wall of text."
         *
         * The ninth gate check judges this properly, against the writers' measured range. This is
         * the free look beforehand, so a wall of text is caught before a gate run is spent on it.
         */
        /*
         * THE FOLD AS A PHONE DRAWS IT, which is the thing Josh asked for on 26 October: "in phone
         * lines, not just word count."
         *
         * Reported separately from `shape.above_fold_words` below, and deliberately not merged with
         * it. That number counts words in the first three AUTHORED lines; this one counts the first
         * three lines a narrow screen renders, gaps included. They are different quantities and the
         * old one is the one every stored median and the ninth check's targets rest on.
         *
         * `hook_above_fold` is the only thing here to act on while the constants are provisional. It
         * only flips when the error is bigger than the gap between the end of the first sentence and
         * the cut, and usually it is not. There is deliberately NO threshold on the word count — a
         * drafter that can see the cut would pad to it.
         */
        fold: {
          hook_lands_above_it: m.hook_above_fold,
          rendered_lines: m.rendered_lines,
          words_above_it: m.above_fold_rendered_words,
          what_he_would_see: m.above_fold_rendered,
          cuts_mid_sentence: m.cut_mid_sentence,
          measured_with: `${FOLD_CHARS_PER_LINE} characters a line, a blank line costing ` +
            `${FOLD_BLANK_COST}, cut after ${FOLD_LINES} lines`,
          how_much_to_trust_it: "PROVISIONAL. LinkedIn does not publish where the cut falls and it " +
            "moves with the phone, the text size and the app version, so this is a simulation " +
            "with uncalibrated constants. Act on hook_lands_above_it; treat the word count as " +
            "indicative and do not quote it to Josh as a measurement.",
          not_the_same_as: "shape.above_fold_words below. That counts the first three lines as " +
            "written; this counts the first three as drawn. Never average or swap them.",
        },

        /*
         * WHERE THE POST REVERSES. Reported, never scored.
         *
         * Josh, 26 October: "The posts jump around and don't tie the points together. One paragraph
         * rarely leads into the next. This feels like it needs a judgement on reading order rather
         * than a word-level check."
         *
         * He is right that it is a judgement, and `scrub_draft` is where that judgement now gets
         * asked. This is the one piece of reading order that IS computable: a post that reverses
         * early and spends the rest on the consequence has a spine, and a post that explains for
         * four fifths and then turns reads as a list of observations.
         *
         * NO THRESHOLD, and none is coming. 56% of the reference corpus has no marked turn at all,
         * so "no turn" is a real shape rather than a fault. The per-writer comparison lives in the
         * barker-audit skill, which reads the live measurements; this tool makes no database call
         * and will not carry a hardcoded corpus median that can go stale without saying so.
         */
        reading_order: {
          turn_marker_found: turn !== null,
          turn_at: turn === null ? null : +turn.toFixed(2),
          means: turn === null
            ? "No marked reversal. That is a real shape — most of the reference corpus has none — " +
              "and it is not a fault. It does mean nothing in the post changes direction, so if it " +
              "reads flat, this is where to look."
            : `The post reverses ${Math.round(turn * 100)}% of the way through by sentence. ` +
              "Early means the turn buys the rest of the post; late means most of it was setup.",
          not_a_target: "Ask barker-audit for a named writer's turn position. Nothing here judges " +
            "this number, and it is not in the gate.",
        },

        shape: {
          paragraphs: m.paragraphs,
          lines: m.lines,
          above_fold_words: m.above_fold_words,
          bullet_lines: m.bullet_lines,
          against_the_writers: {
            paragraphs: shapeTargets.paragraphs.length
              ? `they run ${Math.min(...shapeTargets.paragraphs)} to ${Math.max(...shapeTargets.paragraphs)}`
              : "not measured",
            above_fold_words: shapeTargets.aboveFold.length
              ? `they run ${Math.min(...shapeTargets.aboveFold)} to ${Math.max(...shapeTargets.aboveFold)}`
              : "not measured",
          },
          note: "Measured only from the reference posts that kept their line breaks. The scraping " +
            "console returns most posts as one unbroken line, and counting those would report the " +
            "scraper as a habit of the writer.",
        },

        lexicon: {
          signature_terms_used: signature,
          peer_words_used: avoided,
        },

        ai_tells: {
          total: tells.counts.total,
          by_rule: tells.counts.by_rule,
          in_flags_above: loud.length,
          note: tells.counts.total > loud.length
            ? `${tells.counts.total - loud.length} further finding(s) are reported by scrub_draft, ` +
              `along with the rules that need a judgement rather than a regex.`
            : "Call scrub_draft for the full pass, including the rules a regex cannot decide.",
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
