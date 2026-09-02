import { test } from "node:test";
import assert from "node:assert/strict";
import { type Counts, overall, score, summarise, voiceGuideWarning } from "./acceptance.ts";

/**
 * Clause 17 is what the engagement is judged by, so the scoreboard has to be honest in the two
 * directions it could lie: reporting progress that has not happened, and reporting failure where
 * nothing has been measured.
 */

const EMPTY: Counts = {
  voiceNotes: 0,
  voiceTranscribed: 0,
  promptedSessions: 0,
  promptedFullDepth: 0,
  callMoments: 0,
  ccMoments: 0,
  reachedDepth: 0,
  reachedNone: 0,
  interviewEngaged: 0,
  interviewEngagedWithDepth: 0,
  gatePassedDrafts: 0,
  namesOnFile: 0,
  gateChecksRun: 0,
  gateAcceptanceRun: false,
  gateFixtureBatch: 0,
  gateFixtureRejected: 0,
  gateFixtureModel: null,
  selectionRuns: 0,
  selectionWeeks: 0,
  visualsBuilt: 0,
  realPublished: 0,
  publishedWithoutJosh: 0,
  calendarWeeks: 0,
  proposals: 0,
  outcomesWithMetrics: 0,
  outcomesWithDiff: 0,
  conversationAsked: 0,
  editClasses: [],
  voiceGuideSupplied: false,
};

test("an empty system passes nothing and claims nothing", () => {
  const r = score(EMPTY);
  assert.equal(r.length, 12, "clause 17b lists twelve component tests");
  assert.equal(r.filter((x) => x.verdict === "passing").length, 0);
});

test("17a with no measurements is unmeasurable, not zero", () => {
  const f = overall(EMPTY);
  // The distinction the whole scoreboard turns on. Reporting 0 of 6 would say the drafts were
  // rewritten; no draft has been approved at all.
  assert.equal(f.verdict, "blocked");
  assert.match(f.actual, /unmeasurable/);
  assert.doesNotMatch(f.actual, /0 of 6/);
  assert.match(f.blocker ?? "", /6 more drafts/);
});

test("17a is the 17a bar: five of the last six, newest first", () => {
  const five = { ...EMPTY, editClasses: ["light", "light", "rewrite", "light", "light", "light"] as const };
  assert.equal(overall({ ...five, editClasses: [...five.editClasses] }).verdict, "passing");

  const four = { ...EMPTY, editClasses: ["light", "rewrite", "rewrite", "light", "light", "light"] as const };
  assert.equal(overall({ ...four, editClasses: [...four.editClasses] }).verdict, "failing");
});

test("17a reads only the last six, however many exist", () => {
  // Seven measurements, of which the OLDEST is a rewrite. It must fall outside the window.
  const c = {
    ...EMPTY,
    editClasses: ["light", "light", "light", "light", "light", "light", "rewrite"] as ("light" | "rewrite")[],
  };
  assert.equal(overall(c).verdict, "passing");
});

test("not started and not good enough are different verdicts", () => {
  // One voice note is not a failing capture test. Nobody has sent twenty.
  const capture = score({ ...EMPTY, voiceNotes: 1, voiceTranscribed: 1 })[0];
  assert.equal(capture.verdict, "blocked");
  assert.match(capture.blocker ?? "", /19 more/);

  // Six moments asked once and never answered is the interview WAITING, not failing. Scored the
  // other way this read "1 of 7 reached depth" and looked like the one actionable defect on the
  // board. It was live: five of seven had a single question and no reply.
  const waiting = score({ ...EMPTY, reachedDepth: 1, reachedNone: 6, interviewEngaged: 1, interviewEngagedWithDepth: 1 })[4];
  assert.equal(waiting.verdict, "blocked");
  assert.match(waiting.blocker ?? "", /asked and left/);

  // Ten moments Josh DID answer, only three reaching depth, is a real failure.
  const real = score({ ...EMPTY, reachedDepth: 3, reachedNone: 7, interviewEngaged: 10, interviewEngagedWithDepth: 3 })[4];
  assert.equal(real.verdict, "failing");
});

test("a blocked test always names what it is blocked on", () => {
  for (const r of score(EMPTY)) {
    if (r.verdict !== "passing") {
      assert.ok(
        (r.blocker ?? "").length > 10,
        `test ${r.n} (${r.name}) is not passing and does not say why`,
      );
    }
  }
});

test("test 11 counts real exceptions, not absence of publishing", () => {
  // Four weeks of running with nothing published without Josh is a pass.
  const clean = score({ ...EMPTY, calendarWeeks: 4, realPublished: 12 })[10];
  assert.equal(clean.verdict, "passing");

  // One exception fails it however long it has run. 17b allows zero.
  const breached = score({ ...EMPTY, calendarWeeks: 8, realPublished: 12, publishedWithoutJosh: 1 })[10];
  assert.notEqual(breached.verdict, "passing");
});

test("the voice-guide warning fires only while the section is empty", () => {
  assert.ok(voiceGuideWarning(EMPTY), "a gate check that cannot fail should be flagged");
  assert.equal(voiceGuideWarning({ ...EMPTY, voiceGuideSupplied: true }), null);
});

test("the summary counts all three verdicts", () => {
  const s = summarise(score({ ...EMPTY, reachedDepth: 3, reachedNone: 7, interviewEngaged: 10, interviewEngagedWithDepth: 3 }));
  assert.match(s, /0 of 12 passing/);
  assert.match(s, /1 failing/);
});
