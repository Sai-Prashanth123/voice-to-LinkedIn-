#!/usr/bin/env node
/**
 * Fit the fold constants against posts read off a real phone.
 *
 *   node scripts/calibrate-fold.mjs                 show what is needed and score what is there
 *   node scripts/calibrate-fold.mjs --apply         write the fitted constants into shape.ts
 *
 * WHY THIS EXISTS, AND WHY IT CANNOT RUN ON ITS OWN
 *
 * `shape.ts` carries three constants that decide every fold number this system reports:
 *
 *     FOLD_CHARS_PER_LINE = 42      FOLD_LINES = 3      FOLD_BLANK_COST = 1
 *
 * All three are flagged PROVISIONAL in their own comments and none has ever been fitted. They
 * decide `hook_above_fold`, the preview in `measure_draft` and `create_draft`, and the finding that
 * 37% of measured openings fill or overflow the three visible lines — which is the headline result
 * of the whole hook corpus.
 *
 * LinkedIn does not publish where the cut falls and it moves with the device, the OS text size and
 * the app version. There is no way to derive it from stored text: the cut is a rendering fact, not
 * a property of the post. So this needs OBSERVATIONS, and the only person who can produce them is
 * someone holding the phone.
 *
 * Josh was asked for about forty of them on 26 October and they have not come back. That ask is
 * one line: open a post, read the last word you can see before "see more", send the URL and that
 * word. This file turns forty of those into fitted constants in one command, so the ask stops
 * being a project and becomes a paste.
 *
 * THE HONEST POSITION UNTIL THEN. Nothing here guesses. With no observations it reports that it
 * cannot run and names what it needs, and `hook_above_fold` remains the only fold signal any rubric
 * is allowed to act on — because it only flips when the error is bigger than the gap.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderedLines } from "../supabase/functions/_shared/shape.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OBS = join(ROOT, "data", "josh", "fold-observations.json");
const SHAPE = join(ROOT, "supabase", "functions", "_shared", "shape.ts");
const APPLY = process.argv.includes("--apply");

/**
 * Each observation: the post as it was written, and the last word visible before "see more".
 *
 *   [{ "where": "a note about which phone", "text": "the post body", "last_visible": "word" }]
 *
 * `text` must be the post WITH its line breaks — the cut depends on them, and a flattened copy
 * would fit the wrong thing. The URL is not enough: the console strips line breaks, so a post
 * fetched back would not be what the phone rendered.
 */
function observations() {
  if (!existsSync(OBS)) return null;
  try {
    const parsed = JSON.parse(readFileSync(OBS, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : parsed.observations;
    return (rows ?? []).filter((o) => o?.text?.trim() && o?.last_visible?.trim());
  } catch (err) {
    console.error("  " + OBS + " is not readable JSON: " + (err?.message ?? err));
    process.exit(1);
  }
}

/** Where the cut actually fell, as a count of words into the post. */
function observedCut(text, lastVisible) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const needle = String(lastVisible).trim().toLowerCase().replace(/[^a-z0-9']/g, "");
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].toLowerCase().replace(/[^a-z0-9']/g, "") === needle) return i + 1;
  }
  return null;
}

/** What this candidate pair of constants predicts, in words. */
function predictedCut(text, perLine, blankCost, foldLines) {
  // renderedLines takes an options object, so the candidate constants are passed in rather than
  // read from the module — which is what makes a search over them possible at all.
  const lines = renderedLines(text, { charsPerLine: perLine, blankCost });
  const shown = lines.slice(0, foldLines).join(" ").replace(/\s+/g, " ").trim();
  return shown ? shown.split(" ").length : 0;
}

const rows = observations();

if (!rows || rows.length === 0) {
  console.log("\n  NO OBSERVATIONS, SO NOTHING IS FITTED. The constants stay as they are.\n");
  console.log("  This needs " + OBS + ", holding entries like:\n");
  console.log('    [{ "where": "iPhone 15, default text size",');
  console.log('       "text": "the post, WITH its line breaks",');
  console.log('       "last_visible": "the last word before see more" }]\n');
  console.log("  About forty of them. The ask was sent to Josh on 26 October and is still open:");
  console.log("  open a post on the phone, read the last word visible before \"see more\".\n");
  console.log("  WHY THE TEXT AND NOT THE URL: the scraping console strips line breaks, so a post");
  console.log("  fetched back is not what the phone rendered, and the cut depends on the breaks.\n");
  console.log("  Until these arrive, hook_above_fold is the only fold signal any rubric may act on,");
  console.log("  and no fold word count should be quoted to Josh as a measurement.\n");
  process.exit(0);
}

/* ── Fit ──────────────────────────────────────────────────────────────────── */

console.log("\n  " + rows.length + " observation(s).");
if (rows.length < 20) {
  console.log("  FEWER THAN TWENTY. A fit on this many moves with one bad reading — treat the");
  console.log("  result as a direction and not as a calibration.\n");
}

const usable = [];
for (const o of rows) {
  const cut = observedCut(o.text, o.last_visible);
  if (cut === null) {
    console.log("  skipped: \"" + o.last_visible + "\" does not appear in its post");
    continue;
  }
  usable.push({ ...o, cut });
}
if (!usable.length) {
  console.error("\n  No observation could be matched to its post. Nothing fitted.\n");
  process.exit(1);
}

let best = null;
for (let perLine = 28; perLine <= 70; perLine++) {
  for (const blankCost of [0, 0.5, 1, 1.5, 2]) {
    for (const foldLines of [2, 3, 4]) {
      let err = 0;
      for (const o of usable) {
        err += Math.abs(predictedCut(o.text, perLine, blankCost, foldLines) - o.cut);
      }
      const mean = err / usable.length;
      if (!best || mean < best.mean) best = { perLine, blankCost, foldLines, mean };
    }
  }
}

const current = {
  mean: usable.reduce((a, o) => a + Math.abs(predictedCut(o.text, 42, 1, 3) - o.cut), 0) / usable.length,
};

console.log("\n  fitted on " + usable.length + " usable observation(s)");
console.log("    current   42 chars, blank costs 1, cut after 3   mean error " +
  current.mean.toFixed(1) + " words");
console.log("    fitted    " + best.perLine + " chars, blank costs " + best.blankCost +
  ", cut after " + best.foldLines + "   mean error " + best.mean.toFixed(1) + " words");

if (best.mean >= current.mean) {
  console.log("\n  The fit is no better than what is already there. Nothing to change.\n");
  process.exit(0);
}

if (!APPLY) {
  console.log("\n  Dry run. Re-run with --apply to write these into shape.ts.");
  console.log("  Then rebuild the hook corpus, because every fold figure in it moves:");
  console.log("    node scripts/build-hook-patterns.mjs --console --apply\n");
  process.exit(0);
}

let src = readFileSync(SHAPE, "utf8");
src = src
  .replace(/export const FOLD_CHARS_PER_LINE = \d+;/, `export const FOLD_CHARS_PER_LINE = ${best.perLine};`)
  .replace(/export const FOLD_BLANK_COST = [\d.]+;/, `export const FOLD_BLANK_COST = ${best.blankCost};`)
  .replace(/export const FOLD_LINES = \d+;/, `export const FOLD_LINES = ${best.foldLines};`);
writeFileSync(SHAPE, src);
console.log("\n  written into shape.ts. Rebuild the hook corpus and re-run both suites.\n");
