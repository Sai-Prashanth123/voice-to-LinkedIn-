/**
 * Does the calibration recover an answer it is given? And does the experiment report the truth?
 *
 * WHY A SELF-TEST AND NOT JUST WAITING FOR REAL READINGS
 *
 * `scripts/calibrate-fold.mjs` has existed since 26 October and has never once run with data. The
 * day the readings arrive, its output will be believed — the whole point is that it replaces three
 * guesses with a measurement. A fitter nobody has watched recover a known answer is a fitter nobody
 * knows works, and "it printed some numbers" is not evidence that they are the right ones.
 *
 * So this picks a surface, generates observations FROM it with the same renderer the fit scores
 * against, and checks the fit comes back with the surface it started from. If it cannot recover a
 * known answer from clean synthetic data it will not recover an unknown one from eight real
 * readings, and we would never find that out from the output.
 *
 * It also checks the thing the whole plan turns on: that the W-versus-i comparison reports
 * "width-based" when the truth is a proportional font and "character-based" when it is not. That
 * verdict decides whether the width model is needed at all, so a verdict that cannot be wrong is
 * worthless.
 *
 * THIS FILE IS SLOW — ABOUT FIVE MINUTES, AND DELIBERATELY SO.
 *
 * Each test spawns the real script and runs a real parameter sweep; there is no way to test a
 * fitter without fitting. It is already two orders of magnitude cheaper than it was: memoising
 * `widthIn` took one `foldFor` from 0.735ms to 0.043ms, and a coarse-then-fine sweep replaced a
 * 118,000-candidate grid that ran past ten minutes without finishing.
 *
 * If it needs to be faster, narrow the SWEEP in calibrate-fold.mjs and accept that the fit can
 * then miss a true answer outside the narrowed range. Do not thin out the cases here: three of
 * these twelve exist because they caught a bug that made the fitter confidently wrong, and two of
 * those bugs were in earlier versions of these very tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { foldFor } from "../supabase/functions/_shared/fold-preview.ts";
import { SANS_WIDTHS } from "../supabase/functions/_shared/fold-metrics.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "calibrate-fold.mjs");
const PROBES = join(ROOT, "scripts", "fold-probes.mjs");

/** The probe texts, from the generator rather than copied — or the test fits different strings. */
const probes = JSON.parse(execFileSync("node", [PROBES, "--json"], { encoding: "utf8" }));

/**
 * Observations as if a renderer with `truth` had drawn each probe.
 *
 * The "last visible" tail is taken from the renderer's own output, which is what makes this a
 * recovery test: the fit is being asked to find parameters that reproduce readings those exact
 * parameters produced.
 */
function observe(truth, surfaceName) {
  return probes.map((p) => {
    const { shown } = foldFor(p.text, truth);
    const flatShown = shown.join(" ").replace(/\s+/g, " ").trim();
    const base = { probe: p.id, surface: surfaceName, where: "synthetic", text: p.text };

    /*
     * A COUNT for the repetitive probes, a tail for the rest — the same split the real stub asks
     * for, and for the same reason. A tail of a run of one character occurs dozens of times in its
     * post, so the reading is ambiguous; the first version of this helper sent one anyway, the
     * fitter resolved it to the last occurrence, and the recovery test failed with capacity 47
     * against a true 37. The test was wrong in exactly the way a person filling the file in would
     * have been.
     */
    if (p.count_groups) return { ...base, visible_chars: flatShown.length };

    // A tail long enough to be unique. Twelve characters of ordinary prose is, comfortably.
    return { ...base, last_visible: flatShown.slice(-12) };
  });
}

function runFit(observations, against) {
  const dir = mkdtempSync(join(tmpdir(), "fold-fit-"));
  const obs = join(dir, "obs.json");
  const out = join(dir, "fit.json");

  // The fit file has to exist first, the way the real one does.
  writeFileSync(out, readFileSync(join(ROOT, "data", "josh", "fold-fit.json"), "utf8"));
  writeFileSync(obs, JSON.stringify({ fitted_against: against, observations }, null, 2));

  const stdout = execFileSync(
    "node",
    [SCRIPT, "--obs", obs, "--out", out, "--apply", "--no-shape"],
    { encoding: "utf8" },
  );
  return { stdout, fit: JSON.parse(readFileSync(out, "utf8")) };
}

const BASE = {
  name: "Mobile",
  lines: 3,
  seeMoreCost: 0,
  breaksMidWord: false,
  basis: "",
};

/* ── Recovery ─────────────────────────────────────────────────────────────── */

test("it recovers a flat-model surface it was given", () => {
  /*
   * A capacity on the 0.5 grid the sweep actually visits, and a fractional blank cost — the
   * parameter shape.ts floors and this model does not. If the fit cannot find 0.5 here, the
   * fractional search space is decorative.
   */
  const truth = { ...BASE, capacity: 37, blankCost: 0.5, widths: undefined };
  const { fit, stdout } = runFit(observe(truth, "mobile"), "a synthetic flat renderer");

  assert.equal(fit.fitted, true, stdout);
  const got = fit.surfaces.mobile;
  assert.equal(got.lines, 3, `lines came back ${got.lines}`);
  assert.equal(got.widths, null, "it chose a proportional table for flat data");
  assert.ok(
    Math.abs(got.capacity - 37) <= 1.5,
    `capacity came back ${got.capacity}, wanted about 37`,
  );
  assert.ok(
    Math.abs(got.blankCost - 0.5) <= 0.5,
    `blankCost came back ${got.blankCost}, wanted 0.5`,
  );
});

test("it recovers a proportional surface, and prefers the proportional model for it", () => {
  /*
   * THE CASE THE WHOLE PLAN RESTS ON. If real readings come from a proportional renderer and the
   * fit still picks a flat table, the preview can never be letter-exact and nothing in its output
   * would say so — it would just report a mean error nobody has a baseline for.
   */
  const truth = { ...BASE, capacity: 44, blankCost: 1, widths: SANS_WIDTHS };
  const { fit, stdout } = runFit(observe(truth, "mobile"), "a synthetic proportional renderer");

  const got = fit.surfaces.mobile;
  assert.ok(got.widths, `it chose a flat table for proportional data:\n${stdout}`);
  assert.ok(
    Math.abs(got.capacity - 44) <= 2,
    `capacity came back ${got.capacity}, wanted about 44`,
  );
  // And the residuals must actually be small, not merely better than the starting point.
  assert.ok(
    fit.residuals.mobile.mean_abs_chars <= 2,
    `mean error ${fit.residuals.mobile.mean_abs_chars} chars on data generated from the model`,
  );
});

test("it recovers a see-more cost and a mid-word clip", () => {
  const truth = { ...BASE, capacity: 40, blankCost: 1, seeMoreCost: 10, breaksMidWord: true, widths: undefined };
  const { fit } = runFit(observe(truth, "mobile"), "a synthetic renderer that clips mid-word");
  const got = fit.surfaces.mobile;
  assert.ok(got.seeMoreCost > 0, `see-more cost came back ${got.seeMoreCost} against a true 10`);
});

/* ── The experiment ───────────────────────────────────────────────────────── */

test("the W/i probes report width-based when the truth is proportional", () => {
  const truth = { ...BASE, capacity: 44, blankCost: 1, widths: SANS_WIDTHS };
  const { stdout } = runFit(observe(truth, "mobile"), "a synthetic proportional renderer");
  assert.match(stdout, /width-based/, stdout);
  assert.doesNotMatch(stdout, /mobile: W cut at \d+ chars, i cut at \d+ chars — [0-6] apart/);
});

test("the W/i probes report character-based when the truth is flat", () => {
  /*
   * The verdict has to be able to come out the OTHER way, or it is not a measurement. A flat
   * renderer gives both runs the same cut, and the script must say so rather than reaching for the
   * width model because that is what it was built for.
   */
  const truth = { ...BASE, capacity: 42, blankCost: 1, widths: undefined };
  const { stdout } = runFit(observe(truth, "mobile"), "a synthetic flat renderer");
  assert.match(stdout, /character-based/, stdout);
});

/* ── Honesty of the output ────────────────────────────────────────────────── */

test("the written basis names what it was fitted against and how thin the data was", () => {
  const truth = { ...BASE, capacity: 40, blankCost: 1, widths: undefined };
  const { fit } = runFit(observe(truth, "mobile"), "a synthetic flat renderer");

  assert.match(fit.basis, /a synthetic flat renderer/);
  assert.match(fit.fitted_against, /synthetic/);
  assert.ok(fit.fitted_on, "no date was recorded");
  // Eight probes is more than four, so the thin-data warning should NOT fire here.
  assert.doesNotMatch(fit.basis, /FEWER THAN FOUR/);
  // And it must never claim LinkedIn verified it.
  assert.match(fit.basis, /NOT verified against LinkedIn/);
});

test("a thin fit says so in the basis the preview prints", () => {
  /*
   * Three readings, and a surface far enough from the unfitted default that the fit is clearly an
   * improvement. The first version used two readings from a surface close to the default, so the
   * script correctly declined to write anything and the basis stayed unfitted — the test proved
   * the opposite of what it claimed.
   */
  const truth = { ...BASE, capacity: 28, blankCost: 1, widths: undefined };
  const three = observe(truth, "mobile").slice(0, 3);
  const { fit, stdout } = runFit(three, "three readings only");
  assert.equal(fit.fitted, true, stdout);
  assert.match(fit.basis, /FEWER THAN FOUR/, fit.basis);
});

test("a surface with no observations is left exactly as it was", () => {
  /*
   * Mobile and desktop are fitted separately, and readings for one must not move the other. The
   * silent version of this bug would fit desktop to mobile's numbers and report success.
   */
  const truth = { ...BASE, capacity: 37, blankCost: 1, widths: undefined };
  const original = JSON.parse(readFileSync(join(ROOT, "data", "josh", "fold-fit.json"), "utf8"));
  const { fit, stdout } = runFit(observe(truth, "mobile"), "mobile only");

  assert.deepEqual(
    fit.surfaces.desktop,
    original.surfaces.desktop,
    "desktop moved on mobile-only readings",
  );
  assert.match(stdout, /desktop: no observations, left exactly as it was/);
});

test("an unmatchable reading is skipped and named, not silently dropped", () => {
  const truth = { ...BASE, capacity: 40, blankCost: 1, widths: undefined };
  const rows = observe(truth, "mobile");

  /*
   * A probe read back by a TAIL. The first version corrupted `last_visible` on `w-run`, which
   * reads back by a count and was therefore entirely unaffected — the test asserted on a skip
   * message that the script had no reason to print.
   */
  const tailed = rows.find((r) => r.last_visible !== undefined);
  assert.ok(tailed, "no probe in the set reads back by a tail");
  tailed.last_visible = "zzzz-not-in-this-post";

  const { stdout } = runFit(rows, "one bad reading");
  assert.match(stdout, new RegExp(`skipped \\(mobile/${tailed.probe}\\)`), stdout);
  assert.match(stdout, /is not in its post/);
});

test("an ambiguous tail is refused rather than resolved to the wrong end", () => {
  /*
   * THE BUG THE RECOVERY TEST FOUND. A tail taken from a run of one repeated character occurs
   * dozens of times in its post. Matching the last occurrence put the cut near the end of the
   * string and the fit recovered a capacity of 47 against a true 37 — with a clean-looking mean
   * error. Refusing costs one observation; guessing corrupts the fit silently.
   */
  const truth = { ...BASE, capacity: 37, blankCost: 1, widths: undefined };
  const rows = observe(truth, "mobile");
  const wrun = rows.find((r) => r.probe === "w-run");
  delete wrun.visible_chars;
  wrun.last_visible = "WWW WWWW";

  const { stdout } = runFit(rows, "an ambiguous reading");
  assert.match(stdout, /appears more than once/, stdout);
  assert.match(stdout, /skipped \(mobile\/w-run\)/);
});

test("a stub nobody filled in is reported, not quietly fitted around", () => {
  /*
   * An unfilled stub row carries the text and no reading. Dropping those without saying so is how
   * a calibration fits two rows and reports success — and it is exactly what the loader did to
   * every `visible_chars` reading before this was caught.
   */
  const truth = { ...BASE, capacity: 37, blankCost: 1, widths: undefined };
  const rows = observe(truth, "mobile").map((r, i) =>
    i < 4 ? { probe: r.probe, surface: r.surface, where: "", text: r.text, last_visible: "" } : r
  );
  const { stdout } = runFit(rows, "half an unfilled stub");
  assert.match(stdout, /4 row\(s\) carry no reading at all/, stdout);
});

/* ── The file the preview actually reads ──────────────────────────────────── */

test("the live fit file says it is unfitted, and the preview agrees", async () => {
  /*
   * The one that would catch a fit accidentally committed as though it were real. `fitted: false`
   * is what makes every preview print NOT FITTED, so it has to be checked, not assumed.
   */
  const live = JSON.parse(readFileSync(join(ROOT, "data", "josh", "fold-fit.json"), "utf8"));
  const { IS_FITTED, SURFACES } = await import("../supabase/functions/_shared/fold-preview.ts");

  assert.equal(live.fitted, IS_FITTED, "the module and the file disagree about being fitted");
  if (!live.fitted) {
    assert.match(live.basis, /NOT FITTED/);
    assert.match(SURFACES.mobile.basis, /NOT FITTED/);
    assert.equal(live.residuals, null);
  }
  // And the numbers the module exposes are the ones in the file, not a second copy.
  assert.equal(SURFACES.mobile.capacity, live.surfaces.mobile.capacity);
  assert.equal(SURFACES.desktop.capacity, live.surfaces.desktop.capacity);
});
