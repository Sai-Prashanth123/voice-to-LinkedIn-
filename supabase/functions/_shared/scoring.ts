/**
 * 7.1 — deciding what gets written next, and being able to say why.
 *
 *   "Weigh strength of material, pillar balance, time-sensitivity, what Josh has posted recently,
 *    and who the post is for."
 *
 * FIVE factors. The first version of this weighed four, and one of those four was doing double duty:
 * pillar balance was standing in for "what he has posted recently" as well as for itself, and
 * audience never entered the score at all. Two moments aimed at the same reader queued back to back
 * and nothing noticed.
 *
 * It lives here, as a pure function, because it was inline in the worker and therefore untestable —
 * which is exactly how a missing factor sits unnoticed. Everything it needs is passed in.
 *
 * Arithmetic rather than a model call, deliberately: it is inspectable, it is free, it is the same
 * every run, and Josh can be told exactly why a moment was chosen. That last part is not decorative.
 * 7.4 gives him three overrides — pin, kill, not this month — and an override on a ranking he cannot
 * see is a guess.
 */

import type { InterviewDepth } from "./types.ts";

export interface ScorableMoment {
  id: number;
  ref: string;
  pillar: string | null;
  audience: string | null;
  strength: number | null;
  pinned: boolean;
  killed: boolean;
  time_sensitive: boolean;
  decays_at: string | null;
  not_before: string | null;
  captured_at: string;
  depth_reached: InterviewDepth | string | null;
}

export interface ScoringContext {
  /** How many published posts in the last eight weeks carried each pillar. */
  pillarCounts: Map<string, number>;
  /** The same, for audience. */
  audienceCounts: Map<string, number>;
  /** Pillars and audiences already in flight — queued or drafted but not yet published. */
  inFlightPillars: Set<string>;
  inFlightAudiences: Set<string>;
  /** Today, as an ISO date. Passed in so tests are not at the mercy of the clock. */
  today: string;
  now: number;
  /** How hard resemblance to recent posts pushes a candidate down. Set in `settings`. */
  recencySpacingWeight: number;
}

export interface Scored {
  moment: ScorableMoment;
  score: number;
  /** Plain language, in the order the terms were applied. Stored and shown to Josh. */
  reasons: string[];
}

/** Why a moment is not eligible at all this run, or null if it is. */
export function ineligible(m: ScorableMoment, ctx: ScoringContext): string | null {
  if (m.killed) return "you said not to write this one";
  if (m.not_before && m.not_before > ctx.today) return `you said not before ${m.not_before}`;
  if (m.time_sensitive && m.decays_at && m.decays_at < ctx.today) {
    return "time sensitive, and its moment has passed";
  }
  return null;
}

const DEPTH_POINTS: Record<string, number> = {
  scene: 8,
  time_anchored: 4,
  earned_perspective: 2,
  none: -20,
};

export function scoreMoment(m: ScorableMoment, ctx: ScoringContext): Scored {
  const reasons: string[] = [];
  let score = 0;

  // ── 7.4, first, because it is not really a factor: it is Josh overruling the factors ─────────
  if (m.pinned) {
    score += 1000;
    reasons.push("you pinned it to the front");
  }

  // ── Factor 1: strength of the material ───────────────────────────────────────────────────────
  const strength = m.strength ?? 3;
  score += strength * 10;
  reasons.push(
    strength >= 4
      ? `strong material (${strength}/5)`
      : strength <= 2
      ? `thin material (${strength}/5)`
      : `middling material (${strength}/5)`,
  );

  // Depth is corroborating evidence for strength rather than a factor of its own: a real scene is
  // harder to fake than a rating. `none` is punished hard — the interview found nothing.
  const depth = String(m.depth_reached ?? "none");
  const depthPoints = DEPTH_POINTS[depth] ?? 0;
  score += depthPoints;
  if (depth === "scene") reasons.push("the interview reached an actual scene");
  else if (depth === "none") reasons.push("the interview never reached any depth");

  // ── Factor 2: pillar balance ─────────────────────────────────────────────────────────────────
  // Under-served pillars rise, so he is not posting the same theme four weeks running.
  const maxPillar = Math.max(1, ...ctx.pillarCounts.values());
  if (m.pillar) {
    const used = ctx.pillarCounts.get(m.pillar) ?? 0;
    const lift = (1 - used / maxPillar) * 8;
    score += lift;
    if (used === 0) reasons.push(`nothing on ${m.pillar} recently`);
    else if (lift < 2) reasons.push(`plenty on ${m.pillar} lately`);

    // Something already written and waiting on the same pillar is not "recently published" yet, but
    // it will be. Two posts on one theme back to back is the thing 7.1 is guarding against.
    if (ctx.inFlightPillars.has(m.pillar)) {
      score -= 6;
      reasons.push(`another ${m.pillar} post is already waiting`);
    }
  }

  // ── Factor 5: who the post is for ────────────────────────────────────────────────────────────
  // Same shape as pillar balance, with one difference that matters. An unknown audience scores the
  // MIDDLE of the range, not the bottom: 5.6 treats an admitted gap as more honest than a guessed
  // reader, so it must not be punished — and a bank where nothing has an audience yet must not
  // spend every run in a self-inflicted tie. Scoring it zero, as the first version of this did,
  // made "unknown" indistinguishable from "he has written for these people four times this month".
  const AUDIENCE_WEIGHT = 6;
  if (m.audience) {
    const maxAudience = Math.max(1, ...ctx.audienceCounts.values());
    const used = ctx.audienceCounts.get(m.audience) ?? 0;
    score += (1 - used / maxAudience) * AUDIENCE_WEIGHT;
    if (used === 0) reasons.push(`nothing aimed at ${m.audience} recently`);

    if (ctx.inFlightAudiences.has(m.audience)) {
      score -= 5;
      reasons.push(`another post for ${m.audience} is already waiting`);
    }
  } else {
    score += AUDIENCE_WEIGHT / 2;
    // Said out loud rather than left implicit, because 6.1 means he can now fix it in one edit.
    reasons.push("no reader recorded for this one yet");
  }

  // ── Factor 3: time sensitivity ───────────────────────────────────────────────────────────────
  // Anything that decays moves up before it stops being worth posting. Already-decayed moments are
  // excluded by `ineligible` rather than scored low, because writing it late is worse than not.
  if (m.time_sensitive && m.decays_at) {
    const daysLeft = (new Date(m.decays_at).getTime() - ctx.now) / 86_400_000;
    const urgency = Math.max(0, 14 - daysLeft);
    score += urgency;
    if (urgency > 0) {
      reasons.push(
        daysLeft <= 1
          ? "time sensitive — today or not at all"
          // These reasons are written to the bank and shown to Josh, so "1 days left" matters.
          : `time sensitive — about ${Math.round(daysLeft)} day${Math.round(daysLeft) === 1 ? "" : "s"} left`,
      );
    }
  }

  // A gentle preference for older material, so nothing good sits forever behind a stream of new
  // arrivals. Capped, because age is not a virtue.
  const ageDays = (ctx.now - new Date(m.captured_at).getTime()) / 86_400_000;
  const agePoints = Math.min(ageDays * 0.2, 6);
  score += agePoints;
  if (agePoints >= 5) reasons.push("has been waiting a while");

  return { moment: m, score, reasons };
}

/**
 * Factor 4, applied after the fact: what Josh has posted recently.
 *
 * Distinct from pillar balance, which is about theme. This is about the material itself resembling
 * something that has just gone out — the same story told from a slightly different angle, which 7.2
 * explicitly permits ("rewriting an angle is fine") but which should not run the week after the
 * original.
 *
 * It reuses the similarity number the retelling check already computes. One mechanism, three uses:
 * a block above `dedupe_block_similarity`, a warning to the drafter above `dedupe_warn_similarity`,
 * and graded spacing below both. Nothing extra is embedded or called to get it.
 */
export function applyRecencySpacing(
  scored: Scored,
  similarity: number | null,
  ctx: ScoringContext,
): Scored {
  if (similarity === null || similarity <= 0) return scored;

  const penalty = similarity * ctx.recencySpacingWeight;
  if (penalty < 1) return scored;

  return {
    ...scored,
    score: scored.score - penalty,
    reasons: [
      ...scored.reasons,
      `close to something published recently (${Math.round(similarity * 100)}%)`,
    ],
  };
}

/** Highest first. Ties broken by the older moment, so nothing starves behind a newer equal. */
export function rank(scored: Scored[]): Scored[] {
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.moment.captured_at).getTime() - new Date(b.moment.captured_at).getTime();
  });
}
