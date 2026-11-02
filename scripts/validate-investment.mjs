#!/usr/bin/env node
/**
 * Do the investment detectors detect anything? Judged against openings labelled by hand.
 *
 * WHY THIS EXISTS
 *
 * `build-hook-patterns.mjs` reports three figures taken from his hooks section — specificity,
 * stakes, a real emotion. Measured across 3,261 openings they came back at 70.9%, 10.1% and
 * **2.9%**. Two of those are not findings about writers, they are word lists that do not work.
 * Three per cent of three thousand openings carrying no emotion is not plausible.
 *
 * The corpus already refuses to enforce a floor on them, and the artefact labels them as regex
 * approximations. That is honest and it is not enough: a number reported beside real measurements
 * gets read as one. So this fixes them or removes them, and the way to tell which is a labelled
 * sample with a confusion matrix — the precedent is scripts/measure-structure.mjs, whose list
 * detector read 90% on 51 posts and 83.8% when re-tested at scale.
 *
 *   node scripts/validate-investment.mjs            print the sample to label
 *   node scripts/validate-investment.mjs --score    score the labels in LABELS below
 *
 * THE LABELS ARE IN THIS FILE, by hand, with the opening they belong to. Not a separate data file:
 * a judgement nobody can see next to its evidence is a judgement nobody can check.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCORE = process.argv.includes("--score");

/* The detectors, imported from the one place they are defined rather than copied. */
const SRC = readFileSync(join(ROOT, "scripts", "build-hook-patterns.mjs"), "utf8");
const pick = (name) => {
  const at = SRC.indexOf(`const ${name} = new RegExp(`);
  if (at < 0) throw new Error(`${name} not found in build-hook-patterns.mjs`);
  const open = SRC.indexOf("(", at);
  let depth = 0, end = open;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "(") depth++;
    else if (SRC[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  // deno-lint-ignore no-eval
  return eval(SRC.slice(at + `const ${name} = `.length, end + 1));
};
const STAKES = pick("STAKES");
const EMOTION = pick("EMOTION");
const FIGURE = /\d/;

/**
 * Openings labelled by hand on 2 November, reading only the line itself.
 *
 * `s` = does it carry STAKES — something at risk, a cost, a thing that went wrong.
 * `e` = does it carry a real EMOTION — what it felt like, not what it meant.
 *
 * Taken from the three corpora by spread, not by cherry-picking: these are real first lines, so
 * they stay in this file and nowhere that ships.
 */
const LABELS = [
  { line: "There was one thing the list could not tell me.", s: true, e: false },
  { line: "We could identify 1,159 of them. The real number was 3,941.", s: false, e: false },
  { line: "Nobody asked for this list.", s: false, e: false },
  { line: "I spent six months building something nobody used.", s: true, e: true },
  { line: "My best client fired us on a Tuesday.", s: true, e: true },
  { line: "I was embarrassed to send that first cold email.", s: false, e: true },
  { line: "A software vendor publishes a page that names its own customers.", s: false, e: false },
  { line: "Our pipeline dried up in three weeks and I did not see it coming.", s: true, e: true },
  { line: "The phone has a competitor. It is on the same team.", s: false, e: false },
  { line: "I hated every minute of cold calling and I did it anyway.", s: false, e: true },
  { line: "Most target lists are a guess with a number written on them.", s: false, e: false },
  { line: "We missed quota three quarters running.", s: true, e: false },
  { line: "This is the part of the job nobody warns you about.", s: false, e: true },
  { line: "It cost nothing and took a week.", s: false, e: false },
  { line: "I nearly quit in my second year.", s: true, e: true },
  { line: "Last month that team doubled its new deals.", s: false, e: false },
  { line: "Our churn doubled and the dashboard said everything was fine.", s: true, e: false },
  { line: "I still think about the deal we lost in 2023.", s: true, e: true },
  { line: "A dead ID returns an error. A live one returns a company name.", s: false, e: false },
  { line: "Nothing about that quarter went the way I planned.", s: true, e: true },
];

if (!SCORE) {
  console.log("\n  " + LABELS.length + " openings labelled by hand. Run with --score.\n");
  for (const l of LABELS) {
    console.log("    s=" + (l.s ? "Y" : "n") + " e=" + (l.e ? "Y" : "n") + "  " + l.line);
  }
  process.exit(0);
}

function matrix(label, detect, key) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const missed = [], wrong = [];
  for (const l of LABELS) {
    const got = detect(l.line);
    const want = l[key];
    if (got && want) tp++;
    else if (got && !want) { fp++; wrong.push(l.line); }
    else if (!got && want) { fn++; missed.push(l.line); }
    else tn++;
  }
  const recall = tp + fn ? tp / (tp + fn) : null;
  const precision = tp + fp ? tp / (tp + fp) : null;
  console.log("\n  " + label);
  console.log("    true positive " + tp + "   false positive " + fp +
    "   false negative " + fn + "   true negative " + tn);
  console.log("    recall    " + (recall === null ? "n/a" : (100 * recall).toFixed(0) + "%") +
    "   of the openings that DO carry it, this many were found");
  console.log("    precision " + (precision === null ? "n/a" : (100 * precision).toFixed(0) + "%") +
    "   of the ones it flagged, this many really carry it");
  if (missed.length) {
    console.log("    MISSED:");
    for (const m of missed.slice(0, 6)) console.log("      " + m);
  }
  if (wrong.length) {
    console.log("    WRONGLY FLAGGED:");
    for (const w of wrong.slice(0, 4)) console.log("      " + w);
  }
  return { recall, precision };
}

console.log("\n  INVESTMENT DETECTORS, against " + LABELS.length + " hand-labelled openings");
const s = matrix("STAKES — something at risk", (t) => STAKES.test(t), "s");
const e = matrix("EMOTION — what it felt like", (t) => EMOTION.test(t), "e");
/*
 * SPECIFICITY IS NOT SCORED HERE, and the first version of this file scored it against the STAKES
 * labels by mistake — which produced a confusion matrix for a question nobody had answered. It is
 * left out rather than given a label set invented after the fact, because its 70.9% is the one
 * figure of the three that is plausible on its face: a figure or a proper noun is a mechanical
 * test and does not need a reading.
 */

console.log("\n  THE DECISION THIS IS FOR");
console.log("    A detector under about 60% recall is not measuring the thing it is named after,");
console.log("    and a figure derived from it should not be published beside real measurements.");
for (const [name, r] of [["stakes", s], ["emotion", e]]) {
  const rec = r.recall === null ? 0 : r.recall;
  console.log("    " + name.padEnd(8) + (rec >= 0.6 ? "KEEP — it finds most of them" : "CUT or REWRITE — it misses most of them"));
}
console.log("");
