#!/usr/bin/env node
/**
 * Josh's voiceprint — a measured fingerprint, contrasted against the sentinel corpus.
 *
 *   node scripts/build-voiceprint.mjs                      # print it, write nothing
 *   node scripts/build-voiceprint.mjs --apply              # write data/josh/law/voiceprint.{json,md}
 *   node scripts/build-voiceprint.mjs --sentinels a.json   # contrast against a scraped corpus
 *
 * WHAT THIS IS FOR
 *
 * The voice guide says how Josh sounds in prose. This says it in numbers, which is a different and
 * complementary thing: prose can be argued with, a number can be checked. Between them, a drafter
 * has both the shape and the measurement, and a later version can be compared to this one.
 *
 * Modelled on the content-agent convention (`data/clients/<slug>/law/voiceprint.md`) so that Josh's
 * law set reads like every other client's rather than inventing a parallel format.
 *
 * WHAT IT MEASURES, AND THE ONE THING IT CANNOT
 *
 * Josh's corpus is SPEECH — six recorded calls. The sentinel corpus is WRITING. Those are not the
 * same register and nobody should pretend otherwise: everybody's spoken sentences are shorter and
 * more hedged than their written ones. So the contrast is reported as a contrast, and the sections
 * that would be misleading across registers are labelled rather than silently averaged.
 *
 * The lexicon comparison survives the register gap and is the most useful part. What a person
 * reaches for is fairly stable between talking and writing; how long their sentences run is not.
 *
 * WHY THE SENTINEL TEXT IS AN ARGUMENT AND NOT A STORED FILE
 *
 * Clause 8.3 keeps other writers' words out of Josh's system, and this build holds that by not
 * storing them at all. The contrast therefore happens while the posts are in memory, and only the
 * resulting counts are written. Pass --sentinels for a fresh run; omit it and the lexicon section
 * is skipped rather than guessed.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { distinctive, freq, mean, median, per1k, sd, sentences, tally, tokens, words }
  from "./lib/prose.mjs";
import { openingShape } from "./lib/prose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TRANSCRIPTS = join(ROOT, "docs", "from-josh", "transcripts");
const OUT_DIR = join(ROOT, "data", "josh", "law");

const APPLY = process.argv.includes("--apply");
const sentinelPath = (() => {
  const i = process.argv.indexOf("--sentinels");
  return i >= 0 ? process.argv[i + 1] : null;
})();

/* ── Josh's corpus ────────────────────────────────────────────────────────── */

/**
 * Every line Josh actually said, across the six calls.
 *
 * The exports label one turn per line as `**Josh:**`. Nothing else in the file is his — the other
 * speakers are role descriptors, and taking their words would put someone else's phrasing into a
 * fingerprint that claims to be his.
 */
function joshTurns() {
  const files = readdirSync(TRANSCRIPTS).filter((n) => n.endsWith(".md")).sort();
  const turns = [];
  for (const name of files) {
    for (const raw of readFileSync(join(TRANSCRIPTS, name), "utf8").split("\n")) {
      const m = raw.match(/^\*\*Josh:\*\*\s*(.+)$/);
      if (m && m[1].trim()) turns.push({ file: name, text: m[1].trim() });
    }
  }
  return turns;
}

/* ── Measuring ────────────────────────────────────────────────────────────── */

const HEDGES = [
  "i think", "sort of", "kind of", "pretty much", "actually", "honestly", "to be honest",
  "i guess", "a bit", "probably", "maybe", "perhaps", "i suppose", "somewhat", "i mean",
];

function countPhrases(text, phrases) {
  const lower = text.toLowerCase();
  let n = 0;
  for (const p of phrases) {
    // Escaped and word-bounded so "a bit" does not match "arbit", and a phrase containing a
    // regex character cannot quietly change the pattern.
    const re = new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
    n += (lower.match(re) ?? []).length;
  }
  return n;
}

function fingerprint(turns) {
  const all = turns.map((t) => t.text).join("\n");
  const total = words(all);
  const lengths = turns.flatMap((t) => sentences(t.text).map(words)).filter((n) => n > 0);

  const i = (all.match(/\bi\b|\bmy\b|\bme\b|\bi'm\b|\bi've\b|\bi'd\b|\bi'll\b/gi) ?? []).length;
  const we = (all.match(/\bwe\b|\bour\b|\bus\b|\bwe're\b|\bwe've\b/gi) ?? []).length;

  return {
    corpus: {
      calls: new Set(turns.map((t) => t.file)).size,
      turns: turns.length,
      words: total,
      register: "speech",
    },
    rhythm: {
      sentence_words_mean: mean(lengths),
      sentence_words_median: median(lengths),
      sentence_words_sd: sd(lengths),
      short_pct: Math.round((lengths.filter((n) => n < 8).length / lengths.length) * 100),
      long_pct: Math.round((lengths.filter((n) => n > 18).length / lengths.length) * 100),
      words_per_turn_median: median(turns.map((t) => words(t.text))),
    },
    register: {
      // Above 1 means he speaks as himself; below 1 means he speaks for a company. Josh's
      // consultancy is him, so this is expected to be high, and a drop would be meaningful.
      i_vs_we: we ? +(i / we).toFixed(2) : null,
      contractions_per_1k: per1k((all.match(/\b[a-z]+['’](t|s|re|ve|ll|d|m)\b/gi) ?? []).length, total),
      hedging_per_1k: per1k(countPhrases(all, HEDGES), total),
      you_address_per_1k: per1k((all.match(/\byou\b|\byour\b/gi) ?? []).length, total),
      question_turns_pct: Math.round((turns.filter((t) => /\?/.test(t.text)).length / turns.length) * 100),
    },
    surface: {
      // Kept because the banned-phrases section rules it out in writing. Zero in speech is not
      // evidence either way, and is recorded so nobody later reads it as proof.
      em_dashes: (all.match(/—/g) ?? []).length,
      ellipsis_per_1k: per1k((all.match(/\.\.\.|…/g) ?? []).length, total),
      exclaim_per_1k: per1k((all.match(/!/g) ?? []).length, total),
      allcaps_per_1k: per1k((all.match(/\b[A-Z]{3,}\b/g) ?? []).length, total),
      opening_mix: tally(turns.map((t) => openingShape(t.text.split(/(?<=[.!?])\s/)[0] ?? t.text))),
    },
  };
}

/* ── Contrast ─────────────────────────────────────────────────────────────── */

/**
 * Discourse markers that are artefacts of talking, not vocabulary.
 *
 * WHY THIS LIST IS NECESSARY, AND WHY IT IS NOT CHEATING
 *
 * The first run of this script returned "yeah, yep, oh, okay, sorry, kind, like, think" as Josh's
 * top signature terms. Every one is real — he does say them far more than the sentinel writers
 * write them — and every one is useless, because the comparison is speech against writing and
 * nobody writes "yeah" in a post.
 *
 * Left in, they would crowd out the words that actually distinguish him, and a drafter reading the
 * fingerprint would conclude his signature was conversational filler. The voice guide already
 * rules that filler out of posts explicitly. So they are separated rather than deleted: counted,
 * reported under their own heading as evidence of how he talks, and kept out of the list labelled
 * "signature".
 *
 * The test for membership is narrow: a word belongs here only if it is a marker of the spoken turn
 * itself. "Consulting", "Melbourne" and "situation" are speech-heavy for Josh and stay, because
 * they are things he is talking ABOUT.
 */
const SPEECH_ONLY = new Set([
  "yeah", "yep", "yes", "no", "oh", "okay", "ok", "um", "uh", "mm", "hmm", "right", "sure",
  "sorry", "hey", "hi", "bye", "thanks", "thank", "cool", "nice", "great", "amazing", "awesome",
  "like", "kind", "sort", "think", "guess", "mean", "know", "say", "said", "saying", "says",
  "just", "really", "actually", "obviously", "probably", "maybe", "definitely", "totally",
  "gonna", "wanna", "there's", "that's", "it's", "i'm", "you're", "we're", "don't", "didn't",
  "makes", "make", "made", "get", "got", "go", "going", "went", "come", "came", "see", "look",
  "him", "her", "them", "they", "you", "we", "i", "he", "she", "it", "one", "thing", "things",
  "bit", "lot", "little", "much", "more", "very", "quite", "pretty", "well", "good", "bad",
]);

function contrast(joshText, posts) {
  const mine = tokens(joshText);
  const theirs = tokens(posts.map((p) => p.text ?? "").join("\n"));
  const mineF = freq(mine), theirsF = freq(theirs);

  // Ask for more than we need, then split. Filtering before ranking would change the ratios.
  const ranked = distinctive(mineF, mine.length, theirsF, theirs.length, { minCount: 5, top: 80 });
  const signature = ranked.filter((t) => !SPEECH_ONLY.has(t.word)).slice(0, 25);
  const spokenFiller = ranked.filter((t) => SPEECH_ONLY.has(t.word)).slice(0, 15);

  // Words the peer group reaches for and Josh does not. Useful as a soft warning list: if a draft
  // is full of them, it is drifting toward the reference accounts rather than toward him.
  const avoided = [];
  for (const [word, n] of theirsF) {
    if (n < 12) continue;
    const theirRate = per1k(n, theirs.length);
    const mineRate = per1k(mineF.get(word) ?? 0, mine.length);
    if (mineRate * 3 < theirRate) {
      avoided.push({ word, theirs_per_1k: theirRate, mine_per_1k: mineRate });
    }
  }
  avoided.sort((a, b) => b.theirs_per_1k - a.theirs_per_1k);

  return {
    compared_against: { posts: posts.length, words: theirs.length, register: "writing" },
    signature_terms: signature,
    spoken_filler: spokenFiller,
    peer_words_he_avoids: avoided.slice(0, 25),
  };
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

function render(fp, ctr) {
  const L = [];
  L.push("# Voiceprint — Josh Fryszer");
  L.push(`_Computed ${new Date().toISOString().slice(0, 10)} from ${fp.corpus.calls} recorded calls ` +
    `(${fp.corpus.turns} turns, ${fp.corpus.words.toLocaleString()} words)` +
    (ctr ? `, contrasted against ${ctr.compared_against.posts} sentinel posts.` : ".") + "_");
  L.push("");
  L.push("**The corpus is speech, not writing.** Every number below is how Josh talks. Spoken");
  L.push("sentences run shorter and hedge more than written ones for everybody, so the rhythm");
  L.push("figures are a baseline for his thinking, not a target for his posts. The lexicon travels");
  L.push("between the two registers; the sentence lengths do not.");
  L.push("");
  L.push("## Rhythm");
  L.push(`- Sentences: mean **${fp.rhythm.sentence_words_mean}** words (median ${fp.rhythm.sentence_words_median}, sd ${fp.rhythm.sentence_words_sd}); ` +
    `${fp.rhythm.short_pct}% short (<8w), ${fp.rhythm.long_pct}% long (>18w).`);
  L.push(`- ~${fp.rhythm.words_per_turn_median} words per turn (median).`);
  L.push("## Register");
  L.push(`- I-vs-we: **${fp.register.i_vs_we}** (>1 = speaks as himself, <1 = speaks for a company).`);
  L.push(`- Contractions ${fp.register.contractions_per_1k}/1k · hedging ${fp.register.hedging_per_1k}/1k · ` +
    `'you'-address ${fp.register.you_address_per_1k}/1k · turns containing a question ${fp.register.question_turns_pct}%.`);
  L.push("## Surface habits");
  L.push(`- Em dashes: **${fp.surface.em_dashes}** · ellipsis ${fp.surface.ellipsis_per_1k}/1k · ` +
    `exclamation ${fp.surface.exclaim_per_1k}/1k · ALLCAPS ${fp.surface.allcaps_per_1k}/1k.`);
  L.push(`- Opening mix: ${fp.surface.opening_mix.slice(0, 5).map(([k, n]) => `${k} ${n}`).join(", ")}.`);

  if (ctr) {
    L.push("## Lexicon (the distinctive part)");
    L.push(`- **Signature terms** (he uses these far more than the sentinel writers do): ` +
      ctr.signature_terms.map((t) => t.word).join(", "));
    L.push(`- **Peer words he avoids** (common in the reference accounts, rare or absent in him — ` +
      `a draft full of these is drifting toward them): ` +
      ctr.peer_words_he_avoids.map((t) => t.word).join(", "));
    L.push("");
    L.push(`- **Spoken filler — evidence, not instruction**: ` +
      ctr.spoken_filler.map((t) => t.word).join(", "));
    L.push(`  These score highest of all on the raw contrast, and none of them belongs in a post.`);
    L.push(`  They are listed because a drafter that has read the transcripts will be tempted to`);
    L.push(`  reproduce them as authenticity. The voice guide is explicit that this is the one`);
    L.push(`  thing that does not transfer from how he talks to how he writes.`);
  } else {
    L.push("## Lexicon");
    L.push("- Not computed. Re-run with `--sentinels <posts.json>` while a scraped corpus is to hand.");
  }
  L.push("");
  L.push("Manual edits below this line are preserved by convention, not by code. If that changes,");
  L.push("it changes here first.");
  return L.join("\n") + "\n";
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const turns = joshTurns();
if (turns.length === 0) {
  console.error("No Josh turns found in " + TRANSCRIPTS);
  process.exit(1);
}

const fp = fingerprint(turns);
let ctr = null;
if (sentinelPath) {
  const posts = JSON.parse(readFileSync(sentinelPath, "utf8")).filter((p) => !p.is_repost && p.text);
  ctr = contrast(turns.map((t) => t.text).join("\n"), posts);
}

const md = render(fp, ctr);

// MANUAL CORRECTIONS SURVIVE RECOMPUTE.
//
// scripts/voice-tune.mjs writes bans, signature terms, directives and what it has learned from
// Josh's own edits into a `manual` block. Everything else in this file is derived from the
// transcripts and is meant to be overwritten — that block is not.
//
// Without this, a correction Josh made would vanish silently the next time the fingerprint was
// rebuilt, which is the failure that teaches people to stop bothering to correct anything. The
// content-agent original says the same in one line: "Manual edits are preserved when
// build_voiceprint.py recomputes."
let manual = { banned: [], signature: [], directives: [], learned: [] };
try {
  const prior = JSON.parse(readFileSync(join(OUT_DIR, "voiceprint.json"), "utf8"));
  if (prior.manual) manual = prior.manual;
} catch { /* first run, or no prior file */ }

const json = { computed_at: new Date().toISOString(), ...fp, contrast: ctr, manual };

console.log(md);

// The same rule the sentinel measurement holds itself to. Signature terms are single words, which
// is vocabulary rather than phrasing — but if a run of somebody's sentence ever reached this file
// it would be a quotation of a reference writer sitting in Josh's law set.
if (ctr) {
  const emitted = md + JSON.stringify(json);
  const posts = JSON.parse(readFileSync(sentinelPath, "utf8"));
  for (const p of posts) {
    const sample = (p.text ?? "").trim().slice(0, 40);
    if (sample.length >= 40 && emitted.includes(sample)) {
      console.error("REFUSING: sentinel text leaked into the voiceprint.");
      process.exit(1);
    }
  }
}

if (!APPLY) {
  console.log("  (dry run — nothing written; --apply writes data/josh/law/voiceprint.{json,md})\n");
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "voiceprint.md"), md);
  writeFileSync(join(OUT_DIR, "voiceprint.json"), JSON.stringify(json, null, 2) + "\n");
  console.log("  written: data/josh/law/voiceprint.md and voiceprint.json\n");
}
