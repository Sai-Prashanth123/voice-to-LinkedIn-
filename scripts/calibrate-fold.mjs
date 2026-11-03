#!/usr/bin/env node
/**
 * Fit the fold against readings from something that actually renders a post.
 *
 *   node scripts/fold-probes.mjs --stub      make the observation file
 *   node scripts/calibrate-fold.mjs          score what is there, change nothing
 *   node scripts/calibrate-fold.mjs --apply  write the fit into data/josh/fold-fit.json
 *
 * WHY THIS EXISTS, AND WHY IT CANNOT RUN ON ITS OWN
 *
 * Three constants decide every fold number this system reports:
 *
 *     FOLD_CHARS_PER_LINE = 42      FOLD_LINES = 3      FOLD_BLANK_COST = 1
 *
 * All three are flagged PROVISIONAL in `shape.ts` and none has ever been fitted. They decide
 * `hook_above_fold`, the preview in `measure_draft`, `create_draft` and `preview_post`, and the
 * finding that 39% of measured openings fill or overflow the three visible lines — the headline
 * result of the whole hook corpus.
 *
 * LinkedIn publishes nothing about where the cut falls, and it moves with the device, the OS text
 * size and the app version. There is no way to derive it from stored text: the cut is a RENDERING
 * fact, not a property of the post. So this needs OBSERVATIONS from something that draws one.
 *
 * WHAT CHANGED ON 3 NOVEMBER
 *
 * It used to fit in WORDS, over a single characters-per-line scalar, against `shape.ts`. All three
 * are now wrong for the job:
 *
 *   - Words are too coarse. "cut after measu" and "cut after measured" are the same word and a
 *     different line, and letter-exactness is the whole point.
 *   - One scalar cannot describe a proportional font. `WWWWW` is about three times the width of
 *     `iiiii`, so no value fits both. It therefore scores a FLAT table against a PROPORTIONAL one
 *     and keeps whichever predicts better — the flat one winning is a real possible outcome and
 *     would mean LinkedIn counts characters after all.
 *   - Mobile and desktop are different surfaces and are fitted separately.
 *
 * It writes `data/josh/fold-fit.json`, which `fold-preview.ts` imports, so the numbers and the
 * statement of what they were fitted against travel together. `shape.ts` is still updated for the
 * `renderedLines` consumers, but only for the characters-per-line model it can express.
 *
 * THE HONEST POSITION UNTIL OBSERVATIONS ARRIVE. Nothing here guesses. With no data it reports what
 * it needs and changes nothing, and `fold-fit.json` keeps saying `fitted: false`.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { foldFor } from "../supabase/functions/_shared/fold-preview.ts";
import { MODELS } from "../supabase/functions/_shared/fold-metrics.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * Both paths are arguments, for the reason swipe-by-account.mjs gives about its own: a fitter
 * nobody has watched recover a known answer is a fitter nobody knows works. `--obs` and `--out`
 * let the self-test in mcp-server/fold-fit.test.mjs generate observations from a surface it chose,
 * run this against them, and check the fit comes back with the surface it started from.
 *
 * `--no-shape` keeps a test run from touching the shared module nine things import.
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
};
const OBS = arg("obs", join(ROOT, "data", "josh", "fold-observations.json"));
const FIT = arg("out", join(ROOT, "data", "josh", "fold-fit.json"));
const SHAPE = join(ROOT, "supabase", "functions", "_shared", "shape.ts");
const APPLY = process.argv.includes("--apply");
const TOUCH_SHAPE = !process.argv.includes("--no-shape");

/**
 * Each observation: the post as it was written, which surface drew it, and the last characters
 * still visible before "see more".
 *
 *   { "probe": "w-run", "surface": "mobile", "where": "iPhone 15, default text size",
 *     "text": "the post, WITH its line breaks", "last_visible": "WWWWW WW" }
 *
 * `text` must keep its line breaks — the cut depends on them, and a flattened copy fits the wrong
 * thing. A URL is not enough either: the scraping console strips line breaks, so a post fetched
 * back is not what was rendered.
 */
function observations() {
  if (!existsSync(OBS)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(OBS, "utf8"));
  } catch (err) {
    console.error("  " + OBS + " is not readable JSON: " + (err?.message ?? err));
    process.exit(1);
  }
  const rows = Array.isArray(parsed) ? parsed : parsed.observations;

  /*
   * ANY OF THE THREE FORMS COUNTS AS A READING.
   *
   * This filter demanded `last_visible`, so every `visible_chars` observation was dropped here —
   * before the experiment, before the fit, before anything could report it. The two probes that
   * decide whether the model needs glyph widths are exactly the two that must use a count, so the
   * run went ahead on six prose probes, announced "the w-run / i-run probes are missing", and a
   * flat model fitted those six at 0.0 error while the truth was proportional.
   *
   * A new input form that nothing reads, in the tool whose whole job is to replace a guess with a
   * measurement. Caught because the recovery test knew what answer it had planted.
   */
  const has = (o) =>
    typeof o?.visible_chars === "number" ||
    Boolean(o?.visible_prefix?.trim()) ||
    Boolean(o?.last_visible?.trim());

  const kept = (rows ?? []).filter((o) => o?.text?.trim() && has(o));
  const dropped = (rows ?? []).length - kept.length;
  if (dropped > 0) {
    console.log(
      `\n  ${dropped} row(s) carry no reading at all (no visible_chars, visible_prefix or ` +
        `last_visible) and were left out. An unfilled stub looks exactly like this.`,
    );
  }
  return { against: parsed?.fitted_against ?? null, rows: kept };
}

/** Text as one line, which is the space both the observed and the predicted cut are measured in. */
const flat = (s) => String(s).replace(/\s+/g, " ").trim();

/**
 * Where the cut fell, as a count of CHARACTERS into the flattened post.
 *
 * Three ways to say it, because one way is not enough and the ambiguous way is the one a person
 * will reach for:
 *
 *   visible_chars   a number. Unambiguous, and the only sane form for a repetitive probe.
 *   visible_prefix  the whole visible text. Unambiguous, and tedious for a long post.
 *   last_visible    the last few characters. Convenient, and AMBIGUOUS on repetitive text.
 *
 * THE TRAP, found by a recovery test and worth the extra shape.
 *
 * The `w-run` and `i-run` probes are the two most informative observations in the set — they are
 * what decides whether the model needs glyph widths at all. They are also runs of one repeated
 * character, so a tail like "WWW WWWW" occurs dozens of times in the post. Matching it found the
 * LAST occurrence, put the cut near the end of the string, and the fit obligingly recovered a
 * capacity of 47 against a true 37.
 *
 * So a tail that appears more than once is REFUSED rather than guessed at. An ambiguous reading
 * reported as a skip costs one observation; an ambiguous reading silently resolved to the wrong
 * end of the post corrupts the fit and reports a clean mean error.
 */
function observedCut(o) {
  const hay = flat(o.text);

  if (typeof o.visible_chars === "number" && o.visible_chars > 0) {
    return { cut: Math.min(o.visible_chars, hay.length) };
  }

  if (o.visible_prefix?.trim()) {
    const prefix = flat(o.visible_prefix);
    if (!hay.startsWith(prefix)) {
      return { error: "visible_prefix is not how the post starts" };
    }
    return { cut: prefix.length };
  }

  const needle = flat(o.last_visible ?? "");
  if (!needle) return { error: "no visible_chars, visible_prefix or last_visible" };

  const first = hay.indexOf(needle);
  if (first === -1) return { error: `"${needle}" is not in its post` };
  if (hay.indexOf(needle, first + 1) !== -1) {
    return {
      error:
        `"${needle}" appears more than once, so where it cut is ambiguous — ` +
        `give visible_chars (a count) or a longer tail`,
    };
  }
  return { cut: first + needle.length };
}

/** What a candidate surface predicts, in characters of visible text. */
function predictedCut(text, surface) {
  return flat(foldFor(text, surface).shown.join(" ")).length;
}

const loaded = observations();

if (!loaded || loaded.rows.length === 0) {
  console.log("\n  NO OBSERVATIONS, SO NOTHING IS FITTED. The model stays as it is.\n");
  console.log("  This needs " + OBS.replace(ROOT, ".") + ". Make it with:\n");
  console.log("    node scripts/fold-probes.mjs --stub\n");
  console.log("  Then fill in `last_visible` for each — the last few CHARACTERS still visible");
  console.log("  before \"see more\", not the last word. A word is too coarse: \"...measu\" and");
  console.log("  \"...measured\" are the same word and a different line.\n");
  console.log("  Two of the eight probes decide the rest of the work. `w-run` and `i-run` are the");
  console.log("  same length in characters; if they cut at the same place LinkedIn counts");
  console.log("  characters, and if they cut far apart no single number can ever fit both.\n");
  console.log("  Until then `fold-fit.json` says fitted: false, every preview prints that, and");
  console.log("  no fold count should be quoted to Josh as a measurement.\n");
  process.exit(0);
}

const { rows, against } = loaded;

/* ── The experiment, before any fitting ───────────────────────────────────── */

console.log("\n  " + rows.length + " observation(s)" + (against ? ", read off " + against : ""));

const byProbe = (id, surface) => rows.find((o) => o.probe === id && o.surface === surface);

let verdict = null;
for (const surface of ["mobile", "desktop"]) {
  const w = byProbe("w-run", surface);
  const i = byProbe("i-run", surface);
  if (!w || !i) continue;
  const wr = observedCut(w);
  const ir = observedCut(i);
  if (wr.error || ir.error) {
    console.log(`
  ${surface}: the W/i comparison could not be made — ` +
      `${wr.error ?? ir.error}`);
    continue;
  }
  const wc = wr.cut;
  const ic = ir.cut;

  /*
   * The two probes are the same length in characters and differ only in glyph width. If the cut is
   * character-based they land in the same place; if it is width-based the `i` run gets far more
   * characters in. Anything under a handful of characters apart is noise, not a signal.
   */
  const gap = Math.abs(ic - wc);
  const kind = gap <= 6 ? "character-based" : "width-based";
  console.log(
    `\n  ${surface}: W cut at ${wc} chars, i cut at ${ic} chars — ${gap} apart, so ${kind}.`,
  );
  if (kind === "character-based") {
    console.log("    A flat table should win below. If it does, FOLD_CHARS_PER_LINE was only ever");
    console.log("    the wrong NUMBER, and the width model is unnecessary.");
  } else {
    console.log("    No single characters-per-line value can fit both. The width model earns its");
    console.log("    place, and the flat score below is the evidence for that.");
  }
  verdict = verdict === null || verdict === kind ? kind : "mixed";
}
if (verdict === null) {
  console.log("\n  The w-run / i-run probes are missing, so the model question is unanswered.");
  console.log("  Fitting anyway, but the choice of model below rests on the other probes alone.");
}

/* ── Fit, per surface, over both models ───────────────────────────────────── */

const current = JSON.parse(readFileSync(FIT, "utf8"));
const fitted = { ...current };
const report = {};
let anyBetter = false;

for (const surfaceName of ["mobile", "desktop"]) {
  const mine = rows.filter((o) => (o.surface ?? "mobile") === surfaceName);
  if (!mine.length) {
    console.log(`\n  ${surfaceName}: no observations, left exactly as it was.`);
    continue;
  }

  const usable = [];
  for (const o of mine) {
    const read = observedCut(o);
    if (read.error) {
      // Named, not dropped. A skipped reading costs one observation; a reading silently resolved
      // to the wrong place corrupts the fit and still reports a clean mean error.
      console.log(`  skipped (${surfaceName}/${o.probe ?? "?"}): ${read.error}`);
      continue;
    }
    usable.push({ ...o, cut: read.cut });
  }
  if (!usable.length) continue;

  const base = current.surfaces[surfaceName];
  const score = (surface) =>
    usable.reduce((a, o) => a + Math.abs(predictedCut(o.text, surface) - o.cut), 0) / usable.length;

  const asIs = score({ ...base, widths: base.widths ?? undefined, basis: "" });

  /*
   * COARSE, THEN REFINE, because the full grid is not affordable.
   *
   * Two models x 185 capacities x 4 line counts x 5 blank costs x 8 see-more costs x 2 wrap modes
   * is about 118,000 candidate surfaces, each scored against every observation. The first version
   * swept all of it and the self-test ran past ten minutes without finishing.
   *
   * Capacity is the only continuous parameter and the error surface in it is smooth — a line that
   * holds 39 units and one that holds 39.5 differ on few strings — so a whole-number pass finds the
   * right neighbourhood and a tenth-unit pass settles it. The discrete parameters are swept in full
   * both times, because the error in THEM is not smooth at all: a blank cost of 0 and 1 are
   * different renderings, not nearby ones.
   */
  const sweep = (capacities) => {
    let found = null;
    for (const [modelName, widths] of Object.entries(MODELS)) {
      for (const capacity of capacities) {
        for (const lines of [2, 3, 4, 5]) {
          for (const blankCost of [0, 0.5, 1, 1.5, 2]) {
            for (const seeMoreCost of [0, 3, 6, 9, 12, 15]) {
              for (const breaksMidWord of [false, true]) {
                const surface = {
                  name: base.name,
                  capacity,
                  lines,
                  blankCost,
                  seeMoreCost,
                  breaksMidWord,
                  widths: widths ?? undefined,
                  basis: "",
                };
                const mean = score(surface);
                /*
                 * Strictly-less-than, so an earlier candidate wins a tie. The models are iterated
                 * flat-first, which means a tie goes to the SIMPLER model — if a flat table
                 * predicts the readings as well as a proportional one, the width model has not
                 * earned its place and should not be adopted on a coin toss.
                 */
                if (!found || mean < found.mean) found = { modelName, mean, surface };
              }
            }
          }
        }
      }
    }
    return found;
  };

  const coarse = [];
  for (let c = 18; c <= 110; c += 1) coarse.push(c);
  let best = sweep(coarse);

  const fine = [];
  for (let c = best.surface.capacity - 1; c <= best.surface.capacity + 1; c += 0.1) {
    fine.push(Number(c.toFixed(1)));
  }
  const refined = sweep(fine);
  if (refined && refined.mean < best.mean) best = refined;

  const b = best.surface;
  console.log(`\n  ${surfaceName}: fitted on ${usable.length} observation(s)`);
  console.log(`    as it stands   capacity ${base.capacity}, ${base.lines} lines, blank ${base.blankCost}` +
    `, see-more ${base.seeMoreCost}, ${base.widths ? "proportional" : "flat"}` +
    `   mean error ${asIs.toFixed(1)} chars`);
  console.log(`    fitted         capacity ${b.capacity}, ${b.lines} lines, blank ${b.blankCost}` +
    `, see-more ${b.seeMoreCost}, ${best.modelName}${b.breaksMidWord ? ", clips mid-word" : ""}` +
    `   mean error ${best.mean.toFixed(1)} chars`);

  // Per-observation residuals, because a good mean over a bad worst case is how a fit flatters
  // itself. Named per probe so a single bad reading is identifiable rather than averaged away.
  const residuals = usable
    .map((o) => ({ probe: o.probe ?? "?", off: predictedCut(o.text, b) - o.cut }))
    .sort((x, y) => Math.abs(y.off) - Math.abs(x.off));
  console.log("    worst: " + residuals.slice(0, 3).map((r) => `${r.probe} ${r.off > 0 ? "+" : ""}${r.off}`).join(", "));

  if (best.mean >= asIs) {
    console.log("    NOT BETTER than what is already there. Left alone.");
    report[surfaceName] = { improved: false, mean_abs_chars: asIs };
    continue;
  }

  anyBetter = true;
  fitted.surfaces[surfaceName] = {
    name: b.name,
    capacity: b.capacity,
    lines: b.lines,
    blankCost: b.blankCost,
    seeMoreCost: b.seeMoreCost,
    breaksMidWord: b.breaksMidWord,
    widths: b.widths ?? null,
  };
  report[surfaceName] = {
    improved: true,
    model: best.modelName,
    observations: usable.length,
    mean_abs_chars: Number(best.mean.toFixed(2)),
    was_mean_abs_chars: Number(asIs.toFixed(2)),
    worst: residuals.slice(0, 3),
  };
}

if (!anyBetter) {
  console.log("\n  Nothing fitted better than what is already there. No files changed.\n");
  process.exit(0);
}

if (!APPLY) {
  console.log("\n  Dry run. Re-run with --apply to write it.\n");
  console.log("  Then, because every fold figure moves with it:");
  console.log("    node scripts/build-hook-patterns.mjs --console   # rebuild data/josh/hooks/latest.json");
  console.log("    node scripts/swipe-by-account.mjs                # rebuild the per-account view");
  console.log("  and tell Josh the 39% figure in his swipe file has been superseded.\n");
  process.exit(0);
}

/* ── Write ────────────────────────────────────────────────────────────────── */

const fewest = Math.min(...Object.values(report).filter((r) => r.improved).map((r) => r.observations));

fitted.fitted = true;
fitted.fitted_on = new Date().toISOString().slice(0, 10);
fitted.fitted_against = against ?? "unrecorded — fitted_against was left empty in the observations";
fitted.basis =
  `Fitted ${fitted.fitted_on} against ${fitted.fitted_against}, ` +
  `${Object.values(report).filter((r) => r.improved).map((r) => r.observations).join(" and ")} ` +
  `observation(s) per surface. ` +
  (verdict === "character-based"
    ? "The W and i probes cut at the same place, so the cut is character-based. "
    : verdict === "width-based"
    ? "The W and i probes cut far apart, so the cut follows glyph width rather than character count. "
    : "") +
  `NOT verified against LinkedIn itself unless that is what it was fitted against — ` +
  `a third-party preview is a model of LinkedIn, not LinkedIn.` +
  (fewest < 4 ? ` FITTED ON FEWER THAN FOUR READINGS PER SURFACE; treat it as a direction.` : "");
fitted.residuals = report;

writeFileSync(FIT, JSON.stringify(fitted, null, 2) + "\n");
console.log("\n  written: " + FIT.replace(ROOT, "."));

/*
 * And shape.ts, for the `renderedLines` consumers — but ONLY the characters-per-line model, which
 * is all it can express. Skipped entirely when the winning model is proportional, because writing
 * a width-fitted capacity into a constant that means characters would be worse than leaving it
 * wrong: it would look fitted and describe nothing.
 */
const mobile = fitted.surfaces.mobile;
if (!TOUCH_SHAPE) {
  console.log("  shape.ts left alone (--no-shape).");
} else if (!mobile.widths) {
  let src = readFileSync(SHAPE, "utf8");
  src = src
    .replace(/export const FOLD_CHARS_PER_LINE = [\d.]+;/, `export const FOLD_CHARS_PER_LINE = ${mobile.capacity};`)
    .replace(/export const FOLD_BLANK_COST = [\d.]+;/, `export const FOLD_BLANK_COST = ${mobile.blankCost};`)
    .replace(/export const FOLD_LINES = \d+;/, `export const FOLD_LINES = ${mobile.lines};`);
  writeFileSync(SHAPE, src);
  console.log("  written: shape.ts (characters-per-line model, mobile)");
} else {
  console.log("\n  shape.ts NOT changed: the fit is width-based and FOLD_CHARS_PER_LINE counts");
  console.log("  characters, so there is no honest number to put in it. renderedLines keeps its");
  console.log("  own approximation and the preview is the accurate one — which is the split the");
  console.log("  header of this file describes.");
}

console.log("\n  Now rebuild the corpus, because every fold figure in it moves:");
console.log("    node scripts/build-hook-patterns.mjs --console");
console.log("    node scripts/swipe-by-account.mjs");
console.log("  Then re-run both suites, and tell Josh the 39% has been superseded.\n");
