import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRecencySpacing,
  ineligible,
  rank,
  scoreMoment,
  type ScorableMoment,
  type ScoringContext,
} from "./scoring.ts";

/**
 * The scorer decides what Josh publishes. It was previously inline in the worker and therefore
 * untestable, which is how it went four factors instead of five without anyone noticing.
 *
 * These pin the behaviour that would be embarrassing to get wrong in front of a client: an override
 * that does not override, a decayed moment written late, and a bank full of unknown audiences
 * penalising itself into a tie.
 */

const NOW = new Date("2026-08-26T12:00:00Z").getTime();
const TODAY = "2026-08-26";

function ctx(over: Partial<ScoringContext> = {}): ScoringContext {
  return {
    pillarCounts: new Map(),
    audienceCounts: new Map(),
    inFlightPillars: new Set(),
    inFlightAudiences: new Set(),
    today: TODAY,
    now: NOW,
    recencySpacingWeight: 12,
    ...over,
  };
}

function moment(over: Partial<ScorableMoment> = {}): ScorableMoment {
  return {
    id: 1,
    ref: "M-000001",
    pillar: null,
    audience: null,
    strength: 3,
    pinned: false,
    killed: false,
    time_sensitive: false,
    decays_at: null,
    not_before: null,
    captured_at: "2026-08-25T12:00:00Z",
    depth_reached: "time_anchored",
    ...over,
  };
}

/* ── 7.4, the three overrides ────────────────────────────────────────────── */

test("a pinned moment outranks a stronger unpinned one", () => {
  const pinned = scoreMoment(moment({ id: 1, pinned: true, strength: 1 }), ctx());
  const stronger = scoreMoment(moment({ id: 2, strength: 5, depth_reached: "scene" }), ctx());

  assert.ok(pinned.score > stronger.score, `${pinned.score} should beat ${stronger.score}`);
  assert.ok(pinned.reasons.some((r) => r.includes("pinned")));
});

test("killed and not-before are ineligible, not merely low-scoring", () => {
  const c = ctx();
  assert.match(ineligible(moment({ killed: true }), c) ?? "", /not to write/);
  assert.match(ineligible(moment({ not_before: "2026-09-30" }), c) ?? "", /not before/);
});

test("a not-before date that has passed no longer blocks it", () => {
  assert.equal(ineligible(moment({ not_before: "2026-08-01" }), ctx()), null);
  // The boundary matters: "not before today" means today is allowed.
  assert.equal(ineligible(moment({ not_before: TODAY }), ctx()), null);
});

/* ── Factor 3, time sensitivity ──────────────────────────────────────────── */

test("a decayed moment is excluded rather than written late", () => {
  const dead = moment({ time_sensitive: true, decays_at: "2026-08-20" });
  assert.match(ineligible(dead, ctx()) ?? "", /moment has passed/);
});

test("something about to decay outranks the same moment with time to spare", () => {
  const urgent = scoreMoment(
    moment({ id: 1, time_sensitive: true, decays_at: "2026-08-27" }),
    ctx(),
  );
  const relaxed = scoreMoment(
    moment({ id: 2, time_sensitive: true, decays_at: "2026-09-30" }),
    ctx(),
  );

  assert.ok(urgent.score > relaxed.score);
  assert.ok(urgent.reasons.some((r) => r.includes("time sensitive")));
});

/* ── Factor 2, pillar balance ────────────────────────────────────────────── */

test("an under-served pillar outranks a saturated one, all else equal", () => {
  const c = ctx({ pillarCounts: new Map([["Positioning", 6], ["Hiring", 0]]) });

  const saturated = scoreMoment(moment({ id: 1, pillar: "Positioning" }), c);
  const fresh = scoreMoment(moment({ id: 2, pillar: "Hiring" }), c);

  assert.ok(fresh.score > saturated.score);
  assert.ok(fresh.reasons.some((r) => r.includes("Nothing on Hiring") || r.includes("nothing on Hiring")));
});

test("a pillar already waiting in the queue is pushed down", () => {
  const base = ctx({ pillarCounts: new Map([["Hiring", 0]]) });
  const withQueued = ctx({
    pillarCounts: new Map([["Hiring", 0]]),
    inFlightPillars: new Set(["Hiring"]),
  });

  const alone = scoreMoment(moment({ pillar: "Hiring" }), base);
  const crowded = scoreMoment(moment({ pillar: "Hiring" }), withQueued);

  assert.ok(crowded.score < alone.score);
  assert.ok(crowded.reasons.some((r) => r.includes("already waiting")));
});

/* ── Factor 5, who the post is for ───────────────────────────────────────── */

test("audience is actually weighed — it used not to be", () => {
  const c = ctx({ audienceCounts: new Map([["founders", 5], ["heads of sales", 0]]) });

  const saturated = scoreMoment(moment({ id: 1, audience: "founders" }), c);
  const fresh = scoreMoment(moment({ id: 2, audience: "heads of sales" }), c);

  assert.ok(fresh.score > saturated.score, "an under-served audience must rise");
});

test("an unknown audience is neutral, not last", () => {
  // 5.6: an admitted gap is more honest than a guessed reader, so it must not be punished. And a
  // bank where nothing has an audience yet must not spend the whole run in a self-inflicted tie.
  const c = ctx({ audienceCounts: new Map([["founders", 4]]) });

  const unknown = scoreMoment(moment({ id: 1, audience: null }), c);
  const saturated = scoreMoment(moment({ id: 2, audience: "founders" }), c);
  const fresh = scoreMoment(moment({ id: 3, audience: "heads of sales" }), c);

  assert.ok(unknown.score > saturated.score, "unknown must beat an over-served audience");
  assert.ok(fresh.score > unknown.score, "but a genuinely fresh audience still beats unknown");
});

/* ── Factor 4, spacing against what went out recently ────────────────────── */

test("resembling a recent post pushes a moment down without blocking it", () => {
  const plain = scoreMoment(moment({ strength: 5 }), ctx());
  const echo = applyRecencySpacing(plain, 0.62, ctx());

  assert.ok(echo.score < plain.score);
  assert.ok(echo.reasons.some((r) => r.includes("published recently")));
});

test("no similarity, or a trivial one, changes nothing", () => {
  const plain = scoreMoment(moment(), ctx());
  assert.equal(applyRecencySpacing(plain, null, ctx()).score, plain.score);
  assert.equal(applyRecencySpacing(plain, 0.02, ctx()).score, plain.score);
});

/* ── Reasons, because 7.4 depends on them ────────────────────────────────── */

test("every moment comes back with a reason Josh could read", () => {
  const scored = scoreMoment(moment({ strength: 5, depth_reached: "scene" }), ctx());
  assert.ok(scored.reasons.length > 0);
  for (const r of scored.reasons) {
    assert.equal(typeof r, "string");
    assert.ok(r.length > 3);
    assert.ok(!/[_{}]/.test(r), `"${r}" reads like a field name, not a sentence`);
  }
});

test("the interview reaching nothing is stated plainly and costs a great deal", () => {
  const hollow = scoreMoment(moment({ strength: 3, depth_reached: "none" }), ctx());
  const real = scoreMoment(moment({ strength: 3, depth_reached: "scene" }), ctx());

  assert.ok(real.score - hollow.score >= 28);
  assert.ok(hollow.reasons.some((r) => r.includes("never reached any depth")));
});

/* ── Ordering ────────────────────────────────────────────────────────────── */

test("ranking is highest first, and a tie goes to the moment that has waited longer", () => {
  const older = moment({ id: 1, ref: "M-000001", captured_at: "2026-07-01T00:00:00Z" });
  const newer = moment({ id: 2, ref: "M-000002", captured_at: "2026-08-20T00:00:00Z" });

  // Same score, forced: age is the only difference, and the age bonus is capped so both hit it.
  const a = { moment: older, score: 50, reasons: [] };
  const b = { moment: newer, score: 50, reasons: [] };

  assert.deepEqual(rank([b, a]).map((s) => s.moment.ref), ["M-000001", "M-000002"]);
  assert.deepEqual(
    rank([{ ...a, score: 10 }, { ...b, score: 90 }]).map((s) => s.moment.ref),
    ["M-000002", "M-000001"],
  );
});
