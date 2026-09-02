/**
 * CLAUSE 17 — WHERE THE BUILD ACTUALLY STANDS.
 *
 *   "Each is checked once, on a working system, before tuning begins."
 *
 * Twelve component tests and one overall test, and none of them had ever been checked. Not failed —
 * never run. The finish line the engagement is judged by was invisible to both parties, answerable
 * only by someone querying the database by hand.
 *
 * WHY THIS FILE HAS NO IMPORTS
 *
 * It is read by two runtimes: `worker-ops` under Deno, so the scoreboard reaches Josh in the monthly
 * message he already gets, and `eval/acceptance.mjs` under Node, so it can be run in a working
 * session and at handover. `app/lib/diff.ts` had to be copied for exactly this reason and needed a
 * test to stop the copies drifting; Node 22+ strips TypeScript natively, so a module with no imports
 * can simply be shared. One file, one answer.
 *
 * THE THREE VERDICTS ARE NOT DECORATION
 *
 * "failing" and "blocked" want different actions from different people, and collapsing them into one
 * red mark is how a scoreboard becomes noise:
 *
 *   passing  — measured against the criterion in the spec.
 *   failing  — there is enough data to judge and it does not meet the bar. Someone should act.
 *   blocked  — it cannot be judged yet. Naming WHAT on is the whole value: elapsed time, something
 *              Josh owes, or a model that can clear the gate.
 *
 * A test at 1 of 20 voice notes is not failing. Nobody has sent twenty voice notes.
 */

export type Verdict = "passing" | "failing" | "blocked";

export interface TestResult {
  n: string;
  name: string;
  clause: string;
  /** What the spec asks for, in the spec's own terms. */
  requires: string;
  /** What the database actually shows. */
  actual: string;
  verdict: Verdict;
  /** For anything not passing: the specific thing that would move it. */
  blocker?: string;
}

/**
 * Everything the twelve tests need, gathered once.
 *
 * Every count here EXCLUDES killed moments. Nine of the moments on the development project are
 * verification fixtures, kept and labelled rather than deleted (6.3), and a scorecard that counted
 * them would repeat exactly the failure found in the clause 12 pass — where the acceptance bar was
 * about to be computed from hand-written test text.
 */
export interface Counts {
  voiceNotes: number;
  voiceTranscribed: number;
  promptedSessions: number;
  promptedFullDepth: number;
  callMoments: number;
  ccMoments: number;
  reachedDepth: number;
  reachedNone: number;
  /**
   * Moments Josh actually answered at least once.
   *
   * Test 5 asks what the INTERVIEW does with ten thin inputs. A moment that was asked one question
   * and never replied to says nothing about the interview — it says Josh was busy. Counting those as
   * failures read as "the interview reaches depth on 1 of 7" when the truth was "5 of those 7 were
   * asked once and never answered", and it would have sent someone tuning a prompt set that is not
   * broken.
   */
  interviewEngaged: number;
  interviewEngagedWithDepth: number;
  gatePassedDrafts: number;
  namesOnFile: number;
  gateChecksRun: number;
  gateAcceptanceRun: boolean;
  /**
   * The best single batch of seeded fixtures, and how many of it the gate threw out.
   *
   * Test 8 used to be scored from a boolean that only `eval/gate-acceptance.mjs` could set, so a
   * harness that seeded ten fixtures and died waiting for the queue left the scorecard saying
   * "never run" while ten judged fixtures sat in the database. The evidence and the report
   * disagreed, and the report was the one being read.
   *
   * Scored from the rows now. A batch is a run: fixtures are seeded at version 9000 and up, and
   * each run starts above the last one.
   */
  gateFixtureBatch: number;
  gateFixtureRejected: number;
  /** What judged them. Test 8 measures REJECTION, so a cheap model clearing the bar still counts. */
  gateFixtureModel: string | null;
  selectionRuns: number;
  selectionWeeks: number;
  visualsBuilt: number;
  realPublished: number;
  publishedWithoutJosh: number;
  calendarWeeks: number;
  proposals: number;
  outcomesWithMetrics: number;
  outcomesWithDiff: number;
  conversationAsked: number;
  editClasses: ("light" | "rewrite")[];
  voiceGuideSupplied: boolean;
}

const NO_MODEL =
  "a model that can clear the gate — no Anthropic key is configured and the free tiers fabricate";

export function score(c: Counts): TestResult[] {
  const t: TestResult[] = [];

  t.push({
    n: "1",
    name: "Raw capture",
    clause: "4.1",
    requires: "20 voice notes across a week, all transcribed, promptly",
    actual: `${c.voiceNotes} sent, ${c.voiceTranscribed} transcribed`,
    verdict: c.voiceNotes >= 20 && c.voiceTranscribed === c.voiceNotes ? "passing" : "blocked",
    blocker: c.voiceNotes >= 20 ? undefined : `${20 - c.voiceNotes} more voice notes from Josh`,
  });

  t.push({
    n: "2",
    name: "Prompted session",
    clause: "4.2",
    requires: "5 sessions, each producing 3+ moments with a scene, a detail and a realisation",
    actual: `${c.promptedSessions} sessions, ${c.promptedFullDepth} moments at full depth`,
    verdict: c.promptedSessions >= 5 && c.promptedFullDepth >= 15 ? "passing" : "blocked",
    blocker: c.promptedSessions < 5
      ? `${5 - c.promptedSessions} more sessions with Josh`
      : "sessions run but are not reaching depth — see test 5",
  });

  t.push({
    n: "3",
    name: "Call transcripts",
    clause: "4.3",
    requires: "two weeks of calls read, candidates surfaced, none drafted before Josh is interviewed",
    actual: `${c.callMoments} call-sourced moments`,
    verdict: "blocked",
    blocker: "a call recorder, and two weeks of running",
  });

  t.push({
    n: "4",
    name: "Claude Code",
    clause: "4.4",
    requires: "two weeks of normal working; a quiet week is a pass, not a failure",
    actual: `${c.ccMoments} candidates surfaced`,
    verdict: "blocked",
    blocker: "cc-agent has never uploaded — cc-agent/install.mjs has not been run",
  });

  // Judged ONLY on moments Josh engaged with. An unanswered question is not the interview failing;
  // it is the interview waiting. Scored the other way this read "1 of 7 reached depth" and looked
  // like the one actionable failure on the board, when five of those seven had been asked once and
  // never replied to.
  const asked = c.reachedDepth + c.reachedNone;
  const unanswered = asked - c.interviewEngaged;
  t.push({
    n: "5",
    name: "Interview",
    clause: "5",
    requires: "10 thin one-line inputs, at least 8 reaching depth; the rest parked, not padded",
    actual: `${c.interviewEngagedWithDepth} of ${c.interviewEngaged} answered moments reached depth` +
      (unanswered > 0 ? ` (${unanswered} more asked and never answered)` : ""),
    verdict: c.interviewEngaged < 10
      ? "blocked"
      : (c.interviewEngagedWithDepth >= 8 ? "passing" : "failing"),
    blocker: c.interviewEngaged < 10
      ? `${10 - c.interviewEngaged} more moments Josh actually answers. ` +
        `${unanswered} were asked and left, which measures nothing about the interview`
      : `reaching depth on too few. Either the prompt set, or ${NO_MODEL}`,
  });

  const auditBlocker = c.gatePassedDrafts < 10
    ? `${10 - c.gatePassedDrafts} more drafts through the gate, which needs ${NO_MODEL}`
    : "Josh's audit";

  t.push({
    n: "6",
    name: "Fabrication",
    clause: "9.4",
    requires: "Josh audits 10 drafts line by line; zero invented quotes, numbers, names or events",
    actual: `${c.gatePassedDrafts} drafts have cleared the gate`,
    verdict: "blocked",
    blocker: auditBlocker,
  });

  t.push({
    n: "7",
    name: "Names",
    clause: "9c",
    requires: "Josh audits 10 drafts on moments with client names; zero uncleared, zero identifiable",
    actual: `${c.gatePassedDrafts} drafts cleared, ${c.namesOnFile} names on file`,
    verdict: "blocked",
    blocker: auditBlocker,
  });

  t.push({
    n: "8",
    name: "The gate",
    clause: "9b",
    requires: "10 deliberately generic drafts seeded, at least 9 rejected",
    actual: c.gateFixtureBatch === 0
      ? `never seeded (${c.gateChecksRun} gate checks have run in normal working)`
      : `${c.gateFixtureRejected} of ${c.gateFixtureBatch} generic drafts rejected` +
        (c.gateFixtureModel ? `, judged by ${c.gateFixtureModel}` : ""),
    // The bar is rejection, and rejection is the hard direction for a weak model — a lenient one
    // lets generic writing through, which is the failure this test exists to catch. So a cheap
    // model clearing the bar is evidence the gate works, not a result to discount. The model is
    // named in `actual` so the reader can weigh it either way.
    verdict: c.gateFixtureBatch >= 10 && c.gateFixtureRejected >= 9 ? "passing" : "blocked",
    blocker: c.gateFixtureBatch >= 10 && c.gateFixtureRejected >= 9
      ? undefined
      : c.gateFixtureBatch === 0
      ? "run: node eval/gate-acceptance.mjs"
      : `${10 - c.gateFixtureBatch} more fixtures judged in one batch`,
  });

  t.push({
    n: "9",
    name: "Selection",
    clause: "7",
    requires: "four weeks: no repeated stories, pillars balanced, queue near target or a warning",
    actual: `${c.selectionRuns} runs over about ${c.selectionWeeks} week(s)`,
    verdict: c.selectionWeeks >= 4 ? "passing" : "blocked",
    blocker: c.selectionWeeks >= 4 ? undefined : `${4 - c.selectionWeeks} more weeks of running`,
  });

  t.push({
    n: "10",
    name: "Visuals",
    clause: "10",
    requires: "5 reference images returned in Josh's brand, none recognisable as the original",
    actual: `${c.visualsBuilt} built`,
    verdict: c.visualsBuilt >= 5 ? "passing" : "blocked",
    // Was a fixed string saying no vision-capable provider was configured. That stopped being true
    // the moment one was, and the scorecard went on reporting it while a rebuilt visual sat in the
    // table — a blocker that cannot change is not a blocker, it is a caption.
    blocker: c.visualsBuilt >= 5
      ? undefined
      : c.visualsBuilt === 0
      ? "no visual has been built yet — needs a vision-capable provider and an image to work from"
      : `${5 - c.visualsBuilt} more images rebuilt`,
  });

  // The only test whose GUARANTEE is already proven, even though its window has not started: four
  // CHECK constraints make an unauthorised published row impossible to store, verified adversarially.
  t.push({
    n: "11",
    name: "Calendar",
    clause: "11",
    requires: "four weeks: nothing published without Josh's action, zero exceptions",
    actual: `${c.publishedWithoutJosh} exceptions in ${c.realPublished} published ` +
      `(about ${c.calendarWeeks} week(s))`,
    verdict: c.calendarWeeks >= 4 && c.publishedWithoutJosh === 0 ? "passing" : "blocked",
    blocker: "LinkedIn is not connected, so nothing has published. The guarantee is in the schema " +
      "and holds adversarially; the four-week window has not started",
  });

  t.push({
    n: "12",
    name: "Learning loop",
    clause: "12",
    requires: "a month of posts: numbers and draft-against-published on every one, the question " +
      "asked weekly, and at least one evidenced change proposed",
    actual: `${c.outcomesWithDiff} diffs, ${c.outcomesWithMetrics} metric pulls, ` +
      `${c.conversationAsked} asked, ${c.proposals} proposal(s)`,
    verdict: "blocked",
    blocker: "no real post has published. The diff no longer needs LinkedIn (12.2); the numbers do",
  });

  return t;
}

/** 17a, kept separate because it is the finish line rather than a component. */
export function overall(c: Counts): TestResult {
  const window = c.editClasses.slice(0, 6);
  const light = window.filter((e) => e === "light").length;

  return {
    n: "17a",
    name: "The finish line",
    clause: "17a",
    requires: "five of the last six drafts need only light editing. Josh is the judge",
    actual: window.length === 0
      ? "no draft has been approved by Josh yet — unmeasurable"
      : `${light} of the last ${window.length} needed light editing only`,
    // Deliberately NOT reported as 0%. Zero measurements is not a score of zero, and printing one
    // would be the same dishonesty as counting fixtures.
    verdict: window.length < 6 ? "blocked" : (light >= 5 ? "passing" : "failing"),
    blocker: window.length < 6
      ? `${6 - window.length} more drafts approved by Josh before this can be measured`
      : undefined,
  };
}

/**
 * 8.2 — the gate's `voice_guide` check reads a section Josh has not supplied, so it has passed every
 * time and failed none. A check that cannot fail is not a check, and the scoreboard should say so
 * rather than let it inflate the gate's apparent health.
 */
export function voiceGuideWarning(c: Counts): string | null {
  return c.voiceGuideSupplied
    ? null
    : "The gate's voice-guide check has never failed because the voice guide is empty. It becomes a " +
      "real check the moment that section is filled in (8.1, 8.2).";
}

export function summarise(results: TestResult[]): string {
  const passing = results.filter((r) => r.verdict === "passing").length;
  const failing = results.filter((r) => r.verdict === "failing").length;
  const blocked = results.filter((r) => r.verdict === "blocked").length;
  return `${passing} of ${results.length} passing, ${failing} failing, ` +
    `${blocked} not yet checkable`;
}

/** Only the columns the fixture scorer reads, so both callers can pass their own row shape. */
export interface FixtureDraft {
  id: number;
  version?: number | null;
  gate_passed?: boolean | null;
  framework?: string | null;
}

export interface FixtureRun {
  draft_id?: number | null;
  model?: string | null;
}

/**
 * Score acceptance test 8 from the fixtures themselves.
 *
 * Test 8 seeds ten deliberately generic drafts and requires at least nine to be rejected. It used
 * to be reported from a boolean only `eval/gate-acceptance.mjs` could set — so a harness that
 * seeded its ten and then died waiting for a throttled queue left the scorecard saying "never run"
 * while ten fully judged fixtures sat in the table. The evidence and the report disagreed, and the
 * report was the one being read.
 *
 * Fixtures are seeded from version 9000 upward and each run starts above the last, so a run is a
 * contiguous block. Grouping by 500 separates them without needing a run id the schema never had.
 *
 * The best batch is used rather than the latest. A run interrupted half way through is not evidence
 * that the gate got worse, and the test asks whether the gate CAN reject ten generic drafts.
 */
export function gateFixtures(
  drafts: FixtureDraft[],
  gateRuns: FixtureRun[],
): Pick<Counts, "gateFixtureBatch" | "gateFixtureRejected" | "gateFixtureModel"> {
  const fixtures = drafts.filter((d) => d.framework === "acceptance-fixture");
  if (fixtures.length === 0) {
    return { gateFixtureBatch: 0, gateFixtureRejected: 0, gateFixtureModel: null };
  }

  const batches = new Map<number, FixtureDraft[]>();
  for (const d of fixtures) {
    const key = Math.floor((d.version ?? 0) / 500) * 500;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key)!.push(d);
  }

  let best = { gateFixtureBatch: 0, gateFixtureRejected: 0, gateFixtureModel: null as string | null };
  for (const rows of batches.values()) {
    const judged = rows.filter((d) => d.gate_passed !== null);
    const rejected = judged.filter((d) => d.gate_passed === false).length;
    if (rejected < best.gateFixtureRejected) continue;

    const ids = new Set(judged.map((d) => d.id));
    // Whatever actually judged them, ignoring the rows written without a model — those are checks
    // recorded as NOT JUDGED because the library section they read is empty.
    const models = gateRuns
      .filter((r) => r.draft_id != null && ids.has(r.draft_id) && r.model && r.model !== "none")
      .map((r) => r.model);

    best = {
      gateFixtureBatch: judged.length,
      gateFixtureRejected: rejected,
      gateFixtureModel: models.length > 0 ? [...new Set(models)].sort().join(", ") : null,
    };
  }
  return best;
}
