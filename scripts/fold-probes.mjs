#!/usr/bin/env node
/**
 * The probe strings that fit the fold, and the format to paste the answers back in.
 *
 *   node scripts/fold-probes.mjs              print the probes and how to record them
 *   node scripts/fold-probes.mjs --json       just the probes, as JSON
 *   node scripts/fold-probes.mjs --stub       write an observation file with the text filled in
 *
 * WHY PROBES AND NOT SAMPLE POSTS
 *
 * `scripts/calibrate-fold.mjs` has been waiting since 26 October for about forty real posts read
 * off a phone. Forty observations of ORDINARY PROSE is a lot of work for a weak fit, because every
 * one of them carries the same mixture of letter widths and so tells you almost the same thing.
 *
 * These eight are designed so each one isolates a different unknown. Two of them — a run of `W`
 * against a run of `i` — are worth more than all forty, because they bracket the thing the current
 * model cannot express at all.
 *
 * THE EXPERIMENT THAT COMES FIRST
 *
 * `FOLD_CHARS_PER_LINE` says a line holds 42 characters. LinkedIn wraps by PIXEL width in a
 * proportional font, where `WWWWW` is roughly three times the width of `iiiii`. So:
 *
 *   - if the W probe and the i probe cut at the SAME character count, the cut really is
 *     character-based, 42 is simply the wrong number, and fitting one scalar is the whole job;
 *   - if they cut at very different counts, no value of `FOLD_CHARS_PER_LINE` can be right for
 *     both, and the model has to become width-aware.
 *
 * That is a result, not an assumption, and it is the first thing the calibration reports. Nothing
 * downstream should be built until these two probes have answered.
 *
 * WHAT TO DO WITH THEM
 *
 * Paste each `text` into a LinkedIn preview that shows the "see more" cut, once for mobile and once
 * for desktop, and record the LAST CHARACTERS STILL VISIBLE — not the last word. A word is too
 * coarse to fit a pixel width: "measured" cut after "measu" and cut after "measured" are the same
 * word and a different line.
 */

import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OBS = join(ROOT, "data", "josh", "fold-observations.json");

const JSON_ONLY = process.argv.includes("--json");
const STUB = process.argv.includes("--stub");

/*
 * Repeated groups of five with single spaces, so a cut can be located by counting groups rather
 * than squinting at a wall of identical letters. Long enough to overflow any plausible fold on
 * either surface: 20 groups is 119 characters, and the widest claim for desktop is ~275.
 */
const runOf = (ch, groups = 24) => Array.from({ length: groups }, () => ch.repeat(5)).join(" ");

/*
 * Ordinary prose, and deliberately NOT one of Josh's posts or a reference writer's.
 *
 * Two reasons. Clause 8.3 — another writer's words do not go into a file that gets pasted into a
 * third-party tool. And a probe needs to be reproducible by anyone later without first deciding
 * which post counts as representative.
 */
const PROSE =
  "I spent four years telling founders to shorten their cold emails, and then I measured a " +
  "hundred and fifty three of them to see whether the short ones actually did better. They did " +
  "not. What mattered was whether the first line named something the reader had done that week.";

const PROBES = [
  {
    id: "w-run",
    isolates: "Maximum advance per character. Half of the experiment above.",
    text: runOf("W"),
    /*
     * COUNT THE GROUPS, do not transcribe the tail.
     *
     * A run of one repeated character cannot be read back by its last few characters: "WWW WWWW"
     * occurs dozens of times in the post, so the reading is ambiguous and the fitter now refuses
     * it. It used to resolve the ambiguity to the LAST occurrence, which put the cut near the end
     * of the string and recovered a capacity of 47 against a true 37.
     */
    count_groups: true,
    text_note: "Count the complete five-character groups still visible, and any part group.",
  },
  {
    id: "i-run",
    isolates: "Minimum advance per character. The other half: these two bracket the pixel width.",
    text: runOf("i"),
    count_groups: true,
    text_note: "Count the complete five-character groups still visible, and any part group.",
  },
  {
    id: "prose",
    isolates: "The realistic mixture, and whether a fit from the extremes generalises to real text.",
    text: PROSE,
  },
  {
    id: "long-word",
    isolates:
      "A word wider than the line. `renderedLines` pushes it onto one line regardless; a real " +
      "renderer may break mid-word, and the preview has to show which.",
    text:
      "The problem was " +
      "unreproducibleoverconfidentmisattributionofcausality" +
      " and nobody wanted to say so out loud in the review.",
  },
  {
    id: "blank-at-40",
    isolates:
      "FOLD_BLANK_COST — flagged in shape.ts as the single assumption most likely to be wrong, " +
      "and worth one or two lines out of three.",
    text: "They asked for the short version first.\n\n" + PROSE,
  },
  {
    id: "blank-double",
    isolates:
      "Whether two blank lines cost more than one. `renderedLines` collapses them on the grounds " +
      "that a reader sees one gap; that is an assumption nothing has tested.",
    text: "They asked for the short version first.\n\n\n" + PROSE,
  },
  {
    id: "grapheme",
    isolates:
      "Grapheme width. `widthOf` counts an emoji as one character; a renderer gives it roughly " +
      "the width of two, and an en dash is narrower than either.",
    text: "The review went badly 😬 — and the part that stung was the bit about causality. " + PROSE,
  },
  {
    id: "with-media",
    isolates:
      "Whether attaching an image tightens the cut. One source claims posts with media truncate " +
      "at about three lines regardless; nothing in this repo models that at all.",
    text: PROSE,
    note: "PASTE THIS ONE WITH AN IMAGE ATTACHED in the preview tool, and say which image slot.",
  },
];

if (JSON_ONLY) {
  console.log(JSON.stringify(PROBES, null, 2));
  process.exit(0);
}

if (STUB) {
  if (existsSync(OBS)) {
    console.error(`\n  ${OBS} already exists. Not overwriting it.\n`);
    process.exit(1);
  }
  /*
   * The text is filled in and the two readings are left empty, so the paste is only the answers.
   * A stub with the text already correct also stops the commonest way this goes wrong: a post
   * retyped by hand loses a line break, and the cut depends on the line breaks.
   */
  const stub = {
    fitted_against: "FILL THIS IN — which tool or device produced the readings, and its version",
    recorded_on: new Date().toISOString().slice(0, 10),
    observations: PROBES.flatMap((p) =>
      ["mobile", "desktop"].map((surface) =>
        p.count_groups
          ? {
            probe: p.id,
            surface,
            where: "",
            text: p.text,
            // A count, because a tail is ambiguous on a repeated character. Groups are six
            // characters each including the space, so the last group has no trailing space.
            _how: "Count the visible five-character groups. visible_chars = groups * 6 - 1.",
            visible_chars: null,
          }
          : {
            probe: p.id,
            surface,
            where: "",
            text: p.text,
            _how: "The last 8-12 characters still visible. Must appear only once in the post.",
            last_visible: "",
          }
      )
    ),
  };
  writeFileSync(OBS, JSON.stringify(stub, null, 2) + "\n");
  console.log(`\n  Wrote ${PROBES.length * 2} empty observations to ${OBS.replace(ROOT, ".")}`);
  console.log("  Fill in `last_visible` for each, then: node scripts/calibrate-fold.mjs\n");
  process.exit(0);
}

const rule = "─".repeat(78);

console.log(`\n${rule}`);
console.log("  EIGHT PROBES. Paste each into a preview that shows the \"see more\" cut, twice:");
console.log("  once on the mobile view and once on desktop.");
console.log(`${rule}`);
console.log("\n  For each, send back the LAST CHARACTERS STILL VISIBLE before \"see more\" —");
console.log("  the last five or six are plenty, and a word is NOT enough. \"...measu\" and");
console.log("  \"...measured\" are the same word and a different line.");
console.log("\n  If a probe shows no \"see more\" at all, say so. That is a reading too: it means");
console.log("  the fold is further out than the probe is long.\n");

for (const [i, p] of PROBES.entries()) {
  console.log(rule);
  console.log(`  ${i + 1}. ${p.id}`);
  console.log(`     ${p.isolates}`);
  if (p.note) console.log(`     ** ${p.note}`);
  if (p.text_note) console.log(`     ** ${p.text_note}`);
  console.log("");
  // Indented so a copy out of a terminal does not pick up the frame, and marked at both ends so a
  // truncated copy is obvious rather than silently short.
  console.log("     ┌─ copy from here ─");
  for (const line of p.text.split("\n")) console.log(`     │ ${line}`);
  console.log("     └─ to here ─");
  console.log(`\n     ${p.text.replace(/\n/g, "\\n").length} characters, ` +
    `${p.text.split("\n").length} source line(s)\n`);
}

console.log(rule);
console.log("  THE FIRST THING THE FIT WILL REPORT, and it decides the rest of the work:");
console.log("");
console.log("  Probes 1 and 2 are the same length in characters. If they cut at the same place,");
console.log("  LinkedIn counts characters and FOLD_CHARS_PER_LINE is simply the wrong number.");
console.log("  If they cut far apart, no single number can be right for both and the model has");
console.log("  to become width-aware. Nothing else should be built until those two have answered.");
console.log(`${rule}\n`);
console.log("  Record them with:  node scripts/fold-probes.mjs --stub");
console.log("  Then fit them:     node scripts/calibrate-fold.mjs\n");
