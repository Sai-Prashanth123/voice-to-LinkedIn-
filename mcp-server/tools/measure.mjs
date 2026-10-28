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
import { corpusBand, medianWordRange, writerTarget } from "./voice.mjs";
import { WRITER_CHOICES } from "../writers.mjs";
// Import-free and type-stripped by Node, the shape.ts pattern — so this stays a tool that makes no
// database call and no network call, which guards.test.mjs asserts by handing it an empty context.
import { splitModes } from "../../supabase/functions/_shared/library-spans.ts";
// The same set scripts/build-voiceprint.mjs now applies when it WRITES the peer list. Import-free,
// so it costs this tool neither a database call nor a network call. See PEER_WORDS below for why
// the filter has to happen again here.
import { FUNCTION_WORDS } from "../../scripts/lib/stopwords.mjs";
import voiceprint from "../../data/josh/law/voiceprint.json" with { type: "json" };
import sentinels from "../../data/josh/sentinels/latest.json" with { type: "json" };

/** The spread of habitual length, derived rather than written out. See voice.mjs. */
const RANGE = medianWordRange(sentinels.report) ?? { low: 0, high: 0 };

/** Read from the measurements rather than written out. See the note in voice.mjs. */
const MEASURED = sentinels.posts ??
  (sentinels.report ?? []).reduce((n, r) => n + (r.posts_measured ?? 0), 0);

/*
 * How many writers there are, counted rather than written down. A field here was called
 * `against_all_seven` until 28 October, by which time there were eight — see the note where it is
 * now interpolated instead.
 */
const WRITERS = (sentinels.report ?? []).length;

/**
 * The reference writers whose STRUCTURE matches what Josh's own rules describe — long, prose rather
 * than bullets, a scene before the fold. The rest are "the cut": very short openers, heavy lists,
 * everything below the fold. Both are in the corpus; only one is a useful comparison.
 *
 * DERIVED, AFTER TWO SEPARATE WAYS OF BEING WRONG ABOUT IT.
 *
 * This was a hardcoded set of four handles, and the comment said the split was "a judgement
 * recorded in the reference_posts library section". Two things were wrong with that on 28 October:
 *
 *   1. It said "the other three are the cut". There are FOUR — `adam-treboutat` joined them when
 *      the corpus went from seven accounts to eight, and nothing updated the sentence.
 *   2. THE PASSAGE IT CITED NO LONGER EXISTED. The 20 October measurement refresh rewrote the whole
 *      span between the markers in that section, and the scene/cut justification was inside it. So
 *      a refresh built to replace numbers replaced the argument, and this comment pointed at a
 *      deleted paragraph for the better part of a month.
 *
 * So the set is now computed from the corpus's own median above-fold figures, which separate the two
 * modes with a clear gap (cut 20, 21, 23, 23; scene 39, 55.5, 63, 66). That is not a chosen
 * threshold: it is where the measurement already divides. `library-spans.test.ts` asserts the
 * derived roster still equals the four handles recorded in the section, so CI says so the day the
 * corpus moves it rather than the day somebody notices a stale sentence.
 */
const SCENE_WRITERS = new Set(
  splitModes(sentinels.report ?? []).scene.map((r) => r.handle),
);

function band(handles) {
  const values = (sentinels.report ?? [])
    .filter((r) => handles.has(r.handle))
    .map((r) => r.sd_median)
    .filter((n) => typeof n === "number")
    .sort((a, b) => a - b);
  return values.length ? { low: values[0], high: values[values.length - 1] } : null;
}

/**
 * Where a value sits relative to a measured range, said in words rather than as a verdict.
 *
 * "WITHIN THEIR RANGE" WAS DOING THE WORK OF A PASS, and that is what broke on 28 October: a draft
 * written for ryanscarlin (sd_median 14.9) scoring 9.8 read "within their range (7.1–18.8)" and
 * nobody looked again. A range is eight people who all work disagreeing with each other, so every
 * one of these now says that out loud. The number is the answer; this sentence is the context.
 */
function placement(value, range) {
  if (!range) return "no reference range available";
  const where = value < range.low
    ? `below all of them`
    : value > range.high
    ? `above all of them`
    : `inside the spread`;
  return `${value} against their ${range.low}–${range.high} — ${where}. A range is not a target ` +
    "and the middle of it is nobody's habit.";
}

/**
 * ONE WRITER, SAID AS THREE NUMBERS AND NO VERDICT — the fix for the false pass.
 *
 * `"sd 9.8; Carlin's median is 14.9, so 5.1 below him; the eight run 7.1–18.8"` is three
 * measurements. `"within their range"` was a verdict wearing a measurement's clothes, and it
 * passed a draft five points from its target. Naming the writer makes this tool MORE of a
 * measurement, not less — which is the ground its own description stands on.
 */
function againstWriter(value, target, key, unit) {
  if (typeof target?.[key] !== "number") {
    return `${target?.name ?? target?.handle} has no measured ${key}.`;
  }
  const gap = +(value - target[key]).toFixed(1);
  return `${value} against ${target.name}'s median of ${target[key]}${unit ? ` ${unit}` : ""} — ` +
    `${Math.abs(gap)} ${gap === 0 ? "exactly on it" : gap > 0 ? "above" : "below"}.`;
}

/*
 * THE PEER LIST, FILTERED AT READ TIME — 28 October.
 *
 * WHY HERE AND NOT IN THE ARTEFACT. The filter belongs in build-voiceprint.mjs, and it is there
 * now. But the stored contrast was computed on 2026-09-08 against 59 posts, and that corpus is not
 * on disk: clause 8.3 keeps the sentinel text out of the system, and the two scrapes that survive
 * are a 112-post set from 5 October and a 70-post set from 9 October. Rebuilding against either
 * would not filter the stored list, it would REPLACE the corpus underneath it — measured on 28
 * October, the 112-post run returns `outbound, ad, week, deal, linkedin, spend` and drops `cpa,
 * before, same, company`. A list of different words is not a cleaner version of this list.
 *
 * So the artefact keeps the list it measured and this reads it through the same set the builder now
 * applies. The day a 59-post rebuild is possible, or Josh accepts a corpus swap, this filter
 * becomes a no-op rather than a disagreement.
 *
 * WHAT IT REMOVES, measured on the stored artefact: 7 of 25 — `your, by, who, every, same, down,
 * before`. Every one cleared the list's rate test on the register gap alone. The test is raw rate
 * — count >= 12 in their corpus and `mineRate * 3 < theirRate` — with no ratio floor, so written
 * register's heavier subordination and possessives were enough on their own. A draft was told it
 * was "drifting toward their voice" for containing the word "who".
 *
 * WHAT IT DOES NOT REMOVE, and this is reported to the caller rather than quietly pruned: most of
 * what survives is the material's own domain vocabulary. That is a CORPUS MISMATCH, not a habit —
 * his side is six calls about building this system, theirs is his market writing about his market.
 * Cutting those would be a judgement about what his subject is, dressed as a measurement.
 */
const PEER_WORDS_RAW = (voiceprint.contrast?.peer_words_he_avoids ?? []).map((e) => ({
  word: String(e?.word ?? e).toLowerCase(),
  theirs_per_1k: Number(e?.theirs_per_1k ?? 0),
}));
const PEER_WORDS = PEER_WORDS_RAW.filter((e) => !FUNCTION_WORDS.has(e.word));
const PEER_WORDS_DROPPED = PEER_WORDS_RAW
  .filter((e) => FUNCTION_WORDS.has(e.word))
  .map((e) => e.word);

/**
 * How heavily the reference writers themselves carry this vocabulary, per thousand words.
 *
 * The measured counterpart a draft's own rate is compared against, summed from the `theirs_per_1k`
 * the build already stored on every entry. It was in the data and nothing read it.
 */
const PEER_LOAD = +PEER_WORDS.reduce((t, e) => t + e.theirs_per_1k, 0).toFixed(2);

/** How many signature terms were measured, so the note can say "n of m" rather than a bare count. */
const SIGNATURE_TOTAL = (voiceprint.contrast?.signature_terms ?? []).length;

/**
 * Phrases Josh has ALLOWED in the library that a lexicon entry would otherwise flag.
 *
 * THE ONE THIS IS FOR. `here's my system:` is a carve-out Josh added to `banned_phrases` himself on
 * 13 October 2026, in his own words — "I actually like ... my very simple system" — and extended the
 * same day to cover bulleted lists as well as numbered ones. The regex engine already honours it by
 * accident: rule 2C-22 matches `here's (the thing|what|why|how|something)` and never reaches
 * `here's my system`. Only the lexicon flag broke it, because `here's` is a peer-list entry and the
 * list matches a bare word with no idea what construction it sits in. So the only outstanding
 * complaint on a finished draft was a phrase he had asked for.
 *
 * NARROWER THAN THE LIBRARY, NEVER BROADER — prefile.mjs's rule, and it applies with the sign
 * flipped here. There, a check that outlived its library line would invent a standard. Here, a
 * carve-out that outlived its line would keep IGNORING something Josh had re-banned. So:
 *
 *   - `allowed` requires the colon. The library says "as a colon lead-in to a numbered list" and
 *     "before any list"; a bare "Here's my system" with no list after it is not what he described,
 *     and the narrow reading is the safe one.
 *   - the carve-out applies only when EVERY occurrence of the term in the body is inside the
 *     allowed construction. A draft that says "Here's my system:" and also "Here's the thing:"
 *     keeps its flag, and 2C-22 catches the second one separately.
 *   - `library` is the line that must still be in `banned_phrases` for this to hold. measure_draft
 *     makes no database call (see the header) so it cannot read it, and says so in the payload.
 *     scrub_draft DOES load the library and checks it — the same device as prefile.mjs's
 *     RULE_PRESENT, which is the only other library-gated check in the system.
 *
 * Matched loosely, for RULE_PRESENT's reason: Josh edits these sections in his own words, and a
 * carve-out that vanished because he reworded a sentence would be worse than one that outlived a
 * deletion by a session.
 */
export const LEXICON_CARVE_OUTS = [
  {
    term: "here's",
    allowed: /here['’]s\s+my\s+(?:very\s+simple\s+)?system\s*:/gi,
    bare: /\bhere['’]s\b/gi,
    library: /(?:allowed|carve-?out)[^\n]{0,160}here['’]s my (?:very simple )?system/i,
    section: "banned_phrases",
    added: "2026-10-13",
    his_words: "I actually like ... my very simple system",
    describes: '"here\'s my system:" or "here\'s my very simple system:" as a colon lead-in to a list',
  },
];

/**
 * Which carve-outs this body actually earns, and which term each one suppresses.
 *
 * Exported so scrub_draft, which loads the library, can confirm the same list against the live
 * section rather than carrying its own idea of what Josh allowed.
 */
export function carveOutsFor(body) {
  const text = String(body ?? "");
  const out = [];
  for (const c of LEXICON_CARVE_OUTS) {
    const allowed = text.match(c.allowed) ?? [];
    const bare = text.match(c.bare) ?? [];
    if (allowed.length === 0 || allowed.length !== bare.length) continue;
    out.push({
      term: c.term,
      matched: allowed[0].trim(),
      occurrences: allowed.length,
      section: c.section,
      added: c.added,
      his_words: c.his_words,
      describes: c.describes,
      library: c.library,
    });
  }
  return out;
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
        writer_handle: z.string().optional().describe(
          `The reference writer this draft was written for, if one was named in the brief: ` +
            `${WRITER_CHOICES}. Their own measured figures are then reported beside the corpus ` +
            `ones — the corpus view never goes away. Omit when no writer was asked for.`,
        ),
      },
    },

    async handler(args) {
      const body = args.body;
      const m = measurePost(body);

      /*
       * THE TARGET WAS NAMED IN THE BRIEF AND THIS TOOL COULD NOT HEAR IT — fixed 28 October.
       *
       * Reported BESIDE the corpus view and never instead of it: the corpus range is the honest
       * context, and this tool's own description says it is a measurement and not a verdict. An
       * unknown handle refuses rather than falling back to the default silently, which is what
       * writerShapeBlock already does and what a caller can act on.
       *
       * WHY THE CORPUS BAND IS NOT THE FIX. `allBand` was computed here and never read, and waking
       * it would have changed nothing: sd across all eight is 7.1–18.8, identical to the scene
       * four, because every cut writer (10.9, 10.6, 13.9, 14.9) falls inside the scene four's
       * spread. A draft at 9.8 aimed at Carlin's 14.9 reads "inside the spread" either way. Only
       * the named writer's own median catches it, so the dead line is gone rather than woken.
       */
      const target = args.writer_handle ? writerTarget(args.writer_handle) : null;
      if (target?.refused) return { refused: target.refused, handle: target.handle };

      const sceneBand = band(SCENE_WRITERS);
      const sdBand = corpusBand("sd_median");

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

      const signature = wordsFrom(voiceprint.contrast?.signature_terms);

      /*
       * THE PEER HALF, IN THREE STEPS, BECAUSE IT WAS WRONG IN THREE PLACES.
       *
       * One: the list is read through FUNCTION_WORDS (see PEER_WORDS above), so `who` and `last`
       * are no longer evidence of anything.
       *
       * Two: a carve-out Josh wrote drops its term when the body only uses it the way he allowed.
       *
       * Three: what survives is counted as a DENSITY rather than a presence. The flag's own text
       * has always said "One is nothing; several together is a draft drifting toward their voice",
       * and then it fired on one — on `here's`, inside the phrase he asked for.
       */
      const carvedOut = carveOutsFor(body);
      const carvedTerms = new Set(carvedOut.map((c) => c.term));
      const peerHits = PEER_WORDS.filter((e) => used.has(e.word) && !carvedTerms.has(e.word));
      const avoided = peerHits.map((e) => e.word);

      /*
       * HOW SATURATED THIS DRAFT IS WITH THEIR VOCABULARY, AGAINST HOW SATURATED THEIRS ARE.
       *
       * Both sides are rates over the same word list, so they are comparable: the draft's own
       * occurrences per thousand words, against the writers' combined `theirs_per_1k` across the
       * whole filtered list. That second number was already stored on every entry by
       * build-voiceprint.mjs and nothing had ever read it.
       *
       * TWO CONDITIONS, NOT ONE, for scrub_draft's reason about its re-voice share. A rate on a
       * post-length body is lumpy — one word in a 150-word draft is 6.7/1k — so a rate alone would
       * fire on a single hit again by a different route. And a count alone would ignore how heavy
       * the words are. So the flag needs at least two distinct entries AND a rate at or above the
       * writers' own. Neither number is invented: one is measured off this draft, the other off
       * their corpus.
       */
      const peerOccurrences = words.filter((w) => peerHits.some((e) => e.word === w)).length;
      const peerRate = per1k(peerOccurrences, total);
      const PEER_MIN_DISTINCT = 2;
      const peerDrifting = avoided.length >= PEER_MIN_DISTINCT && peerRate >= PEER_LOAD;

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
      /*
       * THE SENTENCE THIS FLAG PRINTS IS NOW THE RULE IT RUNS ON — 28 October.
       *
       * It said "One is nothing; several together is a draft drifting toward their voice" and then
       * fired on one, which on a finished draft that day meant the only outstanding complaint was
       * `here's` inside "Here's my system:" — a phrase Josh added to the library himself. The words
       * it matched were `who`, `last` and `here's`: two function words and a carve-out.
       *
       * The full list is still reported under `lexicon` whether this fires or not. Nothing is
       * hidden; what changed is what counts as worth a writer's attention.
       */
      if (peerDrifting) {
        flags.push(
          `Uses ${avoided.join(", ")} — ${peerOccurrences} occurrence(s) of the peer list in ` +
          `${total} words, ${peerRate} per 1k against the writers' own ${PEER_LOAD} per 1k across ` +
          `the same list. That is their saturation or above it, across ${avoided.length} different ` +
          `words, which is the drift the list exists to catch.`,
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
          counted_with: "words() from scripts/lib/prose.mjs — the counter the stored sentinel " +
            "medians were produced with, so these are comparable with the corpus. scrub_draft " +
            "reports the same number from the same counter; until 28 October it used the lexicon " +
            "tokeniser and the two disagreed by a word.",
          ...(target && { against_the_writer_asked_for: againstWriter(m.sentence_words_sd, target, "sd", "words") }),
          against_the_scene_writers: placement(m.sentence_words_sd, sceneBand),
          against_the_corpus: placement(m.sentence_words_sd, sdBand),
          /*
           * Both bands are reported, and on the 2026-10-20 measurements they are the SAME band:
           * 7.1 (demandjen1) to 18.8 (juliacarter98), with all four cut writers inside it. Said
           * out loud because it is the whole argument for naming a writer — widening the
           * comparison from four writers to eight changes nothing at all, and the only figure that
           * can catch a draft five points from its target is that writer's own.
           */
          ...(sceneBand && sdBand && sceneBand.low === sdBand.low && sceneBand.high === sdBand.high
            ? {
              the_two_bands_coincide: `The scene four and all ${WRITERS} span the same ` +
                `${sdBand.low}–${sdBand.high}, because every cut writer falls inside the scene ` +
                "four's spread. Neither band can tell you whether this draft hits the writer it " +
                "was written for. Only writer_handle can.",
            }
            : {}),
          note: `Compared with the ${MEASURED} measured reference posts, NOT with his voiceprint. That is ` +
            "computed from speech, and the voiceprint says outright that its rhythm figures do " +
            "not transfer to writing." +
            (target
              ? ""
              : " No writer was named, so there is no target here — only two ranges. If the brief " +
                "named one, pass writer_handle: a range this wide passes almost anything."),
        },

        length: {
          words: m.words,
          ...(target && { against_the_writer_asked_for: againstWriter(m.words, target, "words", "words") }),
          /*
           * `against_all_seven` until 28 October, while the corpus had been eight since
           * adam-treboutat joined. A number in a field NAME cannot be derived, so it went stale
           * silently and said "seven" to every caller. The count now lives in the sentence, where
           * it is interpolated from the measurements like every other figure here.
           */
          against_the_corpus: placement(m.words, RANGE),
          note: `All ${WRITERS} of their medians run from ${RANGE.low} to ${RANGE.high} words and ` +
            "all of it works. There is no target length, and the formatting section says nothing " +
            "gets padded to reach one.",
        },

        /*
         * WHICH MOVE THE OPENING MAKES, AND WHETHER THE WRITERS MAKE IT.
         *
         * `surface.opening_shape` has always been reported with nothing to compare it against, so
         * a drafter was told "first_person" and could not tell whether that was the writer's
         * commonest move or one they make seven times in 145 posts. One taxonomy, not two:
         * openingShape() in prose.mjs produced the writers' stored buckets and this draft's, so
         * the seven names mean the same thing on both sides. latest.json already carries the
         * per-writer tally, so this costs no database call.
         */
        opening: {
          yours: m.opening_shape,
          ...(target && {
            their_commonest: target.opening_shapes[0]?.[0] ?? null,
            yours_in_their_posts: (() => {
              const i = target.opening_shapes.findIndex(([s]) => s === m.opening_shape);
              const all = target.opening_shapes.reduce((t, [, c]) => t + c, 0);
              if (i === -1) {
                return `${m.opening_shape} does not appear in ${target.name}'s measured openings.`;
              }
              return `${m.opening_shape} is their #${i + 1} opening — ` +
                `${target.opening_shapes[i][1]} of ${all} posts.`;
            })(),
          }),
          across_the_corpus: (() => {
            const tally = {};
            for (const r of sentinels.report ?? []) {
              for (const [shape, n] of r.opening_shapes ?? []) tally[shape] = (tally[shape] ?? 0) + n;
            }
            const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
            const total = ranked.reduce((t, [, n]) => t + n, 0);
            const i = ranked.findIndex(([s]) => s === m.opening_shape);
            return i === -1
              ? `${m.opening_shape} appears in none of their measured posts.`
              : `${m.opening_shape} is #${i + 1} of ${ranked.length} across the corpus — ` +
                `${ranked[i][1]} of ${total} posts. Their commonest is ${ranked[0][0]}.`;
          })(),
          not_a_target: "A rank is not an instruction. The one hard rule is the library's: never " +
            "open with a question.",
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
          /*
           * LABEL BOTH, BECAUSE BOTH ARE PRINTED AND THEY DISAGREE BY A FACTOR OF THREE.
           *
           * Measured pairs from one run on 28 October: 14/28, 16/22, 19/72, 21/65 — this field and
           * `shape.above_fold_words` below, with nothing on either saying which one the brief's
           * "23 words above the fold" means. It is the OTHER one: writerShapeBlock builds the
           * target from writerShapeTargets over the `above_fold_words` column, which is the
           * authored count. So nothing should ever be judged against this number, and the brief's
           * target is never this number.
           */
          words_above_it_is: "SIMULATED. The words in the first three lines a narrow screen DRAWS, " +
            "gaps counted. Not the brief's target and not what the ninth check judges — that is " +
            "shape.above_fold_words, the authored count. Never compare this one to a corpus median.",
          what_he_would_see: m.above_fold_rendered,
          /*
           * COMPUTED HERE, FROM THE PREVIEW PRINTED BESIDE IT — 28 October.
           *
           * measureShape reports `cut_mid_sentence` from `rendered[FOLD_LINES - 1]`, and
           * renderedLines pushes an empty string for a blank gap, so that slot is frequently the
           * empty string and the regex tests nothing. The symptom: `cuts_mid_sentence: true`
           * printed beside a `what_he_would_see` ending in a full stop and a newline, while a
           * longer draft also ending on a period reported false. It was keyed on where the
           * character budget landed rather than on what the preview shows.
           *
           * So this reads the last NON-EMPTY line of the preview above, which is the only thing
           * here a reader can check. It is a duplicate on purpose and a temporary one: the fix
           * belongs at shape.ts:280 (test the last non-empty line of rendered.slice(0, FOLD_LINES))
           * and this block goes back to one reader the day that lands. `cut_mid_sentence` is
           * reported and never judged — it is in no rubric and no check — so correcting it here
           * cannot move a verdict.
           */
          cuts_mid_sentence: m.rendered_lines > FOLD_LINES &&
            !/[.!?:"”]\s*$/.test(
              m.above_fold_rendered.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "",
            ),
          cuts_mid_sentence_is: "Read off the last non-empty line of what_he_would_see above, so " +
            "the boolean and the preview cannot contradict each other. measureShape's own " +
            "cut_mid_sentence tests the third rendered slot, which is the empty string whenever " +
            "the third line is a blank gap — that is the one-line bug, and it is reported, never " +
            "judged.",
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
          above_fold_words_is: "AUTHORED. The words in the first three lines AS WRITTEN. This is " +
            "the number the drafting brief's target is built from and the one the ninth gate " +
            "check judges, because both come from writerShapeTargets over the above_fold_words " +
            "column. fold.words_above_it is the wrap simulation and is a different quantity.",
          bullet_lines: m.bullet_lines,
          ...(target && {
            against_the_writer_asked_for: {
              paragraphs: againstWriter(m.paragraphs, target, "paragraphs"),
              above_fold_words: againstWriter(m.above_fold_words, target, "above_fold_words", "words"),
              basis: target.basis,
            },
          }),
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

        /*
         * BOTH HALVES REPORTED, WHICH IS THE WHOLE POINT OF THE SECTION — 28 October.
         *
         * `signature_terms_used` was returned as a bare array and the only lexicon output that
         * produced anything a writer would read was the NEGATIVE one. On one finished draft that
         * day, zero of his 25 measured signature terms appeared and nothing said so, on a system
         * whose first rule is "could anyone else have written this?".
         *
         * A NOTE, DELIBERATELY NOT A FLAG AND NOT A THRESHOLD. There is no calibrated number for
         * "enough signature terms" and there cannot be one: the terms are measured from SPEECH —
         * the voiceprint says so at the top of itself — and most of them (`melbourne`,
         * `enrollment`, `october`) have no business in a given post. A threshold would make a
         * drafter pad to clear it, which is the exact failure the length note two blocks up refuses
         * for the same reason.
         *
         * Symmetry is the argument: if the peer list can produce a flag, the signature list has to
         * produce at least a sentence. The verdict on whether anyone else could have written it
         * belongs to the gate's `anyone_else` check, which reads the post rather than counting
         * words in it.
         */
        lexicon: {
          signature_terms_used: signature,
          signature_terms_note: signature.length === 0
            ? `NONE of his ${SIGNATURE_TOTAL} measured signature terms appear in this draft. That ` +
              "is not a fault and there is no target — they are measured from speech and most do " +
              "not belong in a post — but it is the one number on this page that speaks to " +
              "\"could anyone else have written this?\", and it is zero. If the draft also has no " +
              "scene, no name and no figure only he would know, that question is worth asking " +
              "before the gate asks it. Do not add a term to raise this count."
            : `${signature.length} of his ${SIGNATURE_TOTAL} measured signature terms appear: ` +
              `${signature.join(", ")}. Reported, never scored — there is no target count, and ` +
              "padding to raise it would be the failure this note exists to surface.",
          peer_words_used: avoided,
          peer_words_note: avoided.length === 0
            ? `None of the ${PEER_WORDS.length} peer-list words appear.`
            : `${peerOccurrences} occurrence(s) across ${avoided.length} word(s) — ${peerRate} ` +
              `per 1k, against the writers' own ${PEER_LOAD} per 1k over the same list. ` +
              (peerDrifting
                ? "Flagged above."
                : `Not flagged: the flag needs ${PEER_MIN_DISTINCT} or more different words AND ` +
                  "their saturation or above, because its own sentence says one is nothing."),
          /*
           * SAID, NOT SILENT. A filter that removes words without naming them reads as "the list
           * is short", and the next person to wonder why `who` stopped appearing has nothing to
           * read. Named here so the artefact and this tool cannot quietly disagree.
           */
          ...(PEER_WORDS_DROPPED.length > 0 && {
            peer_list_filtered_at_read_time: {
              dropped: PEER_WORDS_DROPPED,
              why: "Function words — articles, determiners, pronouns, prepositions, conjunctions, " +
                "auxiliaries, modals, degree words. The stored list's test is raw rate with no " +
                "ratio floor, and written register uses more subordination and possessives than " +
                "speech does for everybody, so these cleared it on the register gap alone rather " +
                "than on anything about Josh.",
              the_artefact_still_carries_them: "data/josh/law/voiceprint.json was computed " +
                "2026-09-08 against 59 posts and that corpus is not on disk (clause 8.3). " +
                "Rebuilding would swap the corpus rather than filter the list, so the filter runs " +
                "here instead. get_voice_brief reads the artefact directly and still shows them.",
            },
          }),
          /*
           * THE CARVE-OUT, AND THE HALF OF IT THIS TOOL CANNOT CHECK.
           *
           * Stated the way `will_refuse` above states the difference between what it decided and
           * what it could only guess at, and for the same reason: this tool makes no database call,
           * so a carve-out applied from a static mirror is not the same answer as one checked
           * against the live section, and claiming otherwise is how a free look stops being read.
           */
          ...(carvedOut.length > 0 && {
            carve_outs_applied: carvedOut.map((c) => ({
              term: c.term,
              matched: c.matched,
              because: `Josh allowed ${c.describes} in ${c.section} on ${c.added}. His words: ` +
                `"${c.his_words}".`,
              not_checked_here: "Applied from a static mirror of that line, because this tool " +
                "makes no database call. scrub_draft loads the library and confirms the line is " +
                "still there — if Josh has withdrawn the carve-out, it says so and this " +
                "suppression is wrong until the mirror is updated.",
            })),
          }),
        },

        ai_tells: {
          total: tells.counts.total,
          by_rule: tells.counts.by_rule,
          mechanical: tells.counts.mechanical,
          judgement_calls: tells.counts.judgement_calls,
          in_quoted_text: tells.counts.in_quoted_text,
          in_flags_above: loud.length,
          note: tells.counts.total > loud.length
            ? `${tells.counts.total - loud.length} further finding(s) are reported by scrub_draft, ` +
              `along with the rules that need a judgement rather than a regex.`
            : "Call scrub_draft for the full pass, including the rules a regex cannot decide.",
        },

        flags,

        /*
         * A VERDICT THAT COUNTS EVERYTHING IT IS ABOUT TO SHOW — corrected 28 October.
         *
         * It counted `flags` only, and `flags` carries the HIGH_CONFIDENCE subset. Observed in one
         * run: `ai_tells.total: 4` and one flag, then "1 thing(s) worth fixing before spending a
         * gate run." Three findings were on the page and outside the count, so a caller who read
         * the verdict and stopped — which is what a verdict is for — was told the draft was nearly
         * clean by the same response that listed the four.
         *
         * Both numbers now, and they are different kinds of thing: the flags are the ones that are
         * mechanically wrong, the rest need a reader. Saying "4" and nothing else would be the
         * opposite error, because scrub_draft's own discipline is that a judgement call may be
         * left alone.
         */
        verdict: (() => {
          const others = Math.max(0, tells.counts.total - loud.length);

          /*
           * SPLIT BY STANDING, because "outside the flags" is not the same as "needs a reader".
           *
           * The previous version said "Nothing mechanically wrong" whenever `flags` was empty, and
           * called everything else a finding that "need[s] a reader rather than a fix". But `flags`
           * carries only the HIGH_CONFIDENCE subset, so a mechanical rule that is not high
           * confidence lands in `others` and was described as a judgement call.
           *
           * Measured 28 October on the deployed build, on ordinary prose with one semicolon:
           *
           *     ai_tells.mechanical:      1
           *     ai_tells.judgement_calls: 0
           *     verdict: "Nothing mechanically wrong. 1 further finding(s) need a reader
           *               rather than a fix"
           *
           * Three statements, all false against the counters printed beside them — and
           * `scrub_draft` classifies that same 2C-6 finding as `standing: "mechanical"` with the
           * fix "Replace with a full stop and a new sentence." There was a fix, and it was stated.
           *
           * This matters more than its size. This tool is step one of the documented writing path,
           * its own description promises it "catches the mechanical faults that otherwise take a
           * full gate run to discover", and the verdict is the one sentence a caller is most likely
           * to act on. A single semicolon triggers it, so it fires on real drafts rather than on
           * probes — and in one_step mode, which is the live mode, the checks no longer hold a post
           * back.
           */
          const mechanicalOutside = Math.max(0, (tells.counts.mechanical ?? 0) - loud.length);
          const judgement = tells.counts.judgement_calls ?? 0;

          if (flags.length === 0 && others === 0) {
            return "Nothing mechanical to fix, and nothing further for scrub_draft either. " +
              "Whether it is a post only Josh could have written is the gate's question, not " +
              "this one's.";
          }
          if (flags.length === 0) {
            const parts = [];
            if (mechanicalOutside > 0) {
              parts.push(
                `${mechanicalOutside} mechanical finding(s) with a stated fix, below the ` +
                  `threshold that raises a flag here`,
              );
            }
            if (judgement > 0) {
              parts.push(
                `${judgement} finding(s) that need a reader rather than a fix`,
              );
            }
            // Fall back to the undifferentiated count rather than claiming a split the counters do
            // not support — an older scan with no standing on its findings must not read as clean.
            if (parts.length === 0) parts.push(`${others} further finding(s)`);
            return `${parts.join(", and ")}. scrub_draft lists every one with its standing and ` +
              "its line.";
          }
          /*
           * TWO COUNTS AND DELIBERATELY NO SUM. They overlap: an em dash is reported as a flag in
           * its own right AND found by rule 2C-1, so adding them would announce a total larger
           * than the number of things wrong with the draft — which is the same class of error as
           * the undercount it replaces, in the other direction.
           */
          return `${flags.length} thing(s) worth fixing before spending a gate run` +
            (others > 0
              ? `, and ${others} further finding(s) beyond the flags below that need a reader ` +
                "rather than a fix. scrub_draft lists every one of them with its standing and " +
                "its line. (The two counts overlap where a flag and a rule describe the same " +
                "thing, so they are not added up.)"
              : ".");
        })(),
      };
    },
  },
];
