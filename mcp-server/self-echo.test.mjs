/**
 * The own-words check, against the case that actually happened.
 *
 * On 29 October four drafts for four different moments opened on the identical sentence and nothing
 * in the system noticed, because the only cross-post check compares embeddings and there were six
 * of those against 122 moments. These tests pin the behaviour that would have caught it, and the
 * one that must stay quiet — a redraft of the same moment keeping its opening.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { selfEcho, selfEchoReport, firstLine } from "./self-echo.mjs";

const COLD_CALL = "The number of reps who don't want to cold call shocks me.";

/** The four real openings, as they sit in the drafts table. */
const priorDrafts = [
  { id: 103, moment_id: 119, body: COLD_CALL + "\n\nTheir managers have a theory about why." },
  { id: 104, moment_id: 120, body: COLD_CALL + "\n\nI get it, though. It's hard." },
  { id: 105, moment_id: 121, body: COLD_CALL + "\n\nSales leaders have a theory about why. So do I." },
];

test("it catches the opening that opened four posts for four different moments", () => {
  const echo = selfEcho(COLD_CALL + "\n\nThe phone has a competitor.", 122, priorDrafts);
  assert.equal(echo.same_opening.length, 3, "all three earlier moments should be named");
  assert.deepEqual(
    echo.same_opening.map((o) => o.moment_id).sort(),
    [119, 120, 121],
  );
  const report = selfEchoReport(echo);
  assert.ok(report, "a finding must produce a report");
  assert.match(report.join(" "), /opens on the same line/);
});

test("a redraft of the SAME moment keeping its opening says nothing", () => {
  // Version 5 of a moment legitimately opens as version 4 did. Flagging that would put a finding on
  // every single revision, which is how a check teaches people to ignore it.
  const echo = selfEcho(COLD_CALL + "\n\nA different second line.", 119, [priorDrafts[0]]);
  assert.equal(echo.same_opening.length, 0);
  assert.equal(selfEchoReport(echo), null);
});

test("it reports its basis even when it finds nothing, so silence means something", () => {
  const echo = selfEcho("An opening nobody has used before.", 200, priorDrafts);
  assert.equal(echo.checked, 3);
  assert.equal(echo.same_opening.length, 0);
  assert.equal(selfEchoReport(echo), null, "nothing found reports nothing, and the caller says so");
});

test("it needs no embedding provider, which is the whole point", () => {
  // The retelling check compares moment_embeddings and published_archive. This one takes rows and
  // returns an answer, so an empty embeddings table cannot silence it.
  const echo = selfEcho(COLD_CALL, 999, priorDrafts);
  assert.equal(echo.same_opening.length, 3);
});

test("a shared seven-word run is found across moments and not within one", () => {
  const body = "Something new entirely.\n\nTheir managers have a theory about why it happens.";
  const across = selfEcho(body, 999, priorDrafts);
  assert.ok(across.shared_runs.length > 0, "the run from draft 103 should be found");
  const within = selfEcho(body, 119, priorDrafts.slice(0, 1));
  assert.equal(within.shared_runs.length, 0, "the same moment is skipped entirely");
});

test("an empty prior set is reported as nothing looked, not as clean", () => {
  const echo = selfEcho(COLD_CALL, 1, []);
  assert.equal(echo.checked, 0);
  assert.equal(echo.same_opening.length, 0);
});

test("firstLine takes the first NON-BLANK line", () => {
  assert.equal(firstLine("\n\n  The line.  \n\nmore"), "The line.");
  assert.equal(firstLine(""), "");
  assert.equal(firstLine(null), "");
});

test("the opening comparison absorbs case and trailing punctuation", () => {
  // normaliseRun is the normaliser clause 8.3 already uses, reused rather than reinvented so the
  // two cannot disagree about whether a line is the same line.
  const echo = selfEcho(
    "THE NUMBER OF REPS WHO DON'T WANT TO COLD CALL SHOCKS ME",
    999,
    [priorDrafts[0]],
  );
  assert.equal(echo.same_opening.length, 1, "case and a missing full stop must not hide an echo");
});

test("a dropped apostrophe DOES hide an echo, and that is a known limit", () => {
  /*
   * normaliseRun keeps apostrophes on purpose — "its" and "it's" are different words and clause
   * 8.3 depends on telling them apart. The consequence here is that "dont" and "don't" are
   * different openings to this check.
   *
   * Pinned as a test rather than fixed. Fixing it would mean a second normaliser, and two
   * normalisers that disagree about whether a run is the same run is the defect this repository
   * keeps finding. A missed echo is advisory; a disagreement between the borrowed-run guard and
   * this one would be a refusal that moves depending on which module looked.
   */
  const echo = selfEcho(
    "the number of reps who dont want to cold call shocks me",
    999,
    [priorDrafts[0]],
  );
  assert.equal(echo.same_opening.length, 0);
});
