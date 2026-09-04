/**
 * The end-to-end harness: how a case is written, run, and evidenced.
 *
 * WHY THIS EXISTS RATHER THAN MORE UNIT TESTS
 *
 * Nearly every bug found in this build has the same shape — two readers of the same thing
 * disagreeing, with both halves individually correct:
 *
 *   isSupplied() said a section was empty while a real voice recording sat in it
 *   the MCP gate brief and the edge-function gate judged the same empty section differently
 *   drafts.model recorded the literal "STRONG" rather than the model
 *   compatText picked its model from GROQ_MODELS whatever the provider was
 *   voice_guide passed 18 of 18 drafts because it had nothing to judge against
 *
 * None was caught by a test, because each half had a passing test of its own. So the unit of work
 * here is a CASE with EVIDENCE: what it read, what it observed, and why that satisfies the clause.
 *
 * THE THREE RULES THE OUTPUT DEPENDS ON
 *
 *   1. A skip is never silently a pass. Several existing tests `return` early when the database
 *      has no suitable row, so they can cover nothing and stay green. Here a skip must name what
 *      was missing, and it is counted and printed.
 *   2. `blocked` is not `fail`. A rate limit is not a quality failure — the same distinction
 *      _shared/acceptance.ts already makes for clause 17.
 *   3. Every assertion cites what it read. A green tick with no evidence is exactly what let
 *      voice_guide pass eighteen times.
 */

/** Thrown by skip(); carries the reason so the report can print it. */
export class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Skip";
  }
}

/** Thrown by block(); something outside the code prevents the case from being judged. */
export class Blocked extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Blocked";
  }
}

/**
 * The case could not run because the fixture it needs does not exist.
 *
 * Requires a reason and refuses an empty one — a skip whose cause nobody wrote down is the failure
 * mode this whole file is arguing against.
 */
export function skip(reason) {
  if (!reason || !String(reason).trim()) {
    throw new Error("skip() needs a reason. A skip without one is a silent pass.");
  }
  throw new Skip(reason);
}

/** The case cannot be judged yet — no model configured, no LinkedIn, a rate limit. */
export function block(reason) {
  if (!reason || !String(reason).trim()) {
    throw new Error("block() needs a reason.");
  }
  throw new Blocked(reason);
}

/* ── Assertions ───────────────────────────────────────────────────────────── */

/**
 * Assertions carry the observed value, not just a boolean.
 *
 * `assert.ok(x)` tells a reader nothing when it fails. These record what was actually seen so the
 * report can show it without re-running anything.
 */
export function makeAssert(evidence) {
  const record = (ok, what, observed, expected) => {
    evidence.checks.push({ ok, what, observed, expected });
    if (!ok) {
      const detail = expected === undefined
        ? `observed ${JSON.stringify(observed)}`
        : `expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`;
      throw new Error(`${what} — ${detail}`);
    }
  };

  return {
    ok: (value, what) => record(Boolean(value), what, value),
    not: (value, what) => record(!value, what, value),
    equal: (actual, expected, what) =>
      record(Object.is(actual, expected), what, actual, expected),
    notEqual: (actual, expected, what) =>
      record(!Object.is(actual, expected), what, actual, expected),
    same: (actual, expected, what) =>
      record(JSON.stringify(actual) === JSON.stringify(expected), what, actual, expected),
    match: (text, re, what) =>
      record(re.test(String(text ?? "")), what, String(text ?? "").slice(0, 200), String(re)),
    includes: (list, value, what) =>
      record((list ?? []).includes(value), what, list, value),
    excludes: (list, value, what) =>
      record(!(list ?? []).includes(value), what, list, value),
    /** For the many cases whose whole point is that the system REFUSES something. */
    rejects: async (fn, re, what) => {
      let threw = null;
      try {
        await fn();
      } catch (err) {
        threw = err?.message ?? String(err);
      }
      if (threw === null) return record(false, what, "did not refuse", String(re));
      return record(re.test(threw), what, threw.slice(0, 250), String(re));
    },
  };
}

/* ── Cases ────────────────────────────────────────────────────────────────── */

/**
 * @param {object} spec
 * @param {string} spec.id      Stable, e.g. "S6-07". Referenced in reports and commits.
 * @param {number|string} spec.stage  Pipeline stage 0-9, or "X" for cross-reader consistency.
 * @param {string} spec.clause  The build-spec clause this defends.
 * @param {"deterministic"|"live"|"model"} spec.tier
 * @param {string} spec.name    What it proves, in the spec's own terms.
 * @param {(ctx: object) => Promise<any>} spec.run  Gathers evidence. May skip() or block().
 */
export function defineCase(spec) {
  // Presence, not truthiness. `stage: 0` is a perfectly good stage — the wiring checks — and a
  // falsy test rejected every one of them on the first run. The same mistake in a status filter
  // would drop a real row somewhere and be far harder to see.
  for (const key of ["id", "stage", "clause", "tier", "name", "run"]) {
    if (spec[key] === undefined || spec[key] === null || spec[key] === "") {
      throw new Error(`case ${spec.id ?? "?"} is missing "${key}"`);
    }
  }
  if (!["deterministic", "live", "model"].includes(spec.tier)) {
    throw new Error(`case ${spec.id} has an unknown tier "${spec.tier}"`);
  }
  return spec;
}

/** Run one case and return its record. Never throws — a thrown case is a reported failure. */
export async function runCase(spec, context) {
  const started = Date.now();
  const evidence = { checks: [], queries: [], observed: {} };

  const ctx = {
    ...context,
    assert: makeAssert(evidence),
    /** Anything worth showing in the report that is not an assertion. */
    note: (key, value) => {
      evidence.observed[key] = value;
    },
    /** Wraps a read so the report can show what the case actually looked at. */
    seen: (what, rows) => {
      evidence.queries.push({
        what,
        rows: Array.isArray(rows) ? rows.length : rows === null ? 0 : 1,
        sample: Array.isArray(rows) ? rows.slice(0, 3) : rows,
      });
      return rows;
    },
  };

  const base = {
    id: spec.id,
    stage: spec.stage,
    clause: spec.clause,
    tier: spec.tier,
    name: spec.name,
    at: new Date().toISOString(),
  };

  try {
    await spec.run(ctx);
    // A case that asserted nothing proves nothing, however cleanly it ran.
    if (evidence.checks.length === 0) {
      return {
        ...base,
        verdict: "fail",
        reason: "the case ran without asserting anything",
        evidence,
        duration_ms: Date.now() - started,
      };
    }
    return { ...base, verdict: "pass", evidence, duration_ms: Date.now() - started };
  } catch (err) {
    const verdict = err instanceof Skip ? "skipped" : err instanceof Blocked ? "blocked" : "fail";
    return {
      ...base,
      verdict,
      reason: err?.message ?? String(err),
      evidence,
      duration_ms: Date.now() - started,
    };
  }
}

/** Two cases sharing an id would silently shadow one another in the report. */
export function assertUniqueIds(cases) {
  const seen = new Set();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`two cases share the id "${c.id}"`);
    seen.add(c.id);
  }
  return cases;
}
