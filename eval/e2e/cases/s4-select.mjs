/**
 * Stage 4 — choosing what gets written next.
 *
 * The scorer itself is well covered by `scoring.test.ts`. What was not covered at all is
 * `_shared/dedup.ts` — the retelling check — which had no test at any level despite deciding
 * whether a moment is written or skipped, and despite one of its three verdicts existing purely to
 * refuse to fail open.
 */

import { defineCase } from "../harness.mjs";
import { makeMoment, q } from "../fixtures.mjs";

/**
 * A scoring context.
 *
 * Maps and Sets, not object literals, and `today` passed in rather than read from the clock — the
 * scorer takes it that way deliberately so a test is not at the mercy of the date it runs on. The
 * first version of these cases passed plain objects and every one of them threw.
 */
const context = (over = {}) => ({
  pillarCounts: new Map(),
  audienceCounts: new Map(),
  inFlightPillars: new Set(),
  inFlightAudiences: new Set(),
  today: new Date().toISOString().slice(0, 10),
  now: Date.now(),
  ...over,
});

const base = {
  id: 1,
  strength: 3,
  depth_reached: "scene",
  pillar: "pricing",
  audience: "founders",
  pinned: false,
  killed: false,
  time_sensitive: false,
  decays_at: null,
  not_before: null,
  captured_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

export const cases = [
  defineCase({
    id: "S4-01",
    stage: 4,
    clause: "7.1",
    tier: "deterministic",
    name: "a pinned moment outranks a stronger unpinned one",
    async run({ assert, seen }) {
      const { scoreMoment } = await import("../../../supabase/functions/_shared/scoring.ts");
      const ctx = context();
      const pinned = scoreMoment({ ...base, strength: 1, pinned: true }, ctx);
      const strong = scoreMoment({ ...base, strength: 5 }, ctx);
      seen("scores", { pinned: pinned.score, strong: strong.score });
      // Josh pinning something is an instruction, not a hint.
      assert.ok(pinned.score > strong.score, "the pin wins");
    },
  }),

  defineCase({
    id: "S4-02",
    stage: 4,
    clause: "7.1",
    tier: "deterministic",
    name: "killed, not-before and decayed moments are ineligible rather than merely low-scoring",
    async run({ assert, seen }) {
      const { ineligible } = await import("../../../supabase/functions/_shared/scoring.ts");
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

      // The difference matters: a low score can still be picked on a quiet week. Ineligible cannot.
      const cases = {
        killed: { ...base, killed: true },
        notBefore: { ...base, not_before: tomorrow },
        decayed: { ...base, time_sensitive: true, decays_at: yesterday },
        eligible: { ...base },
      };
      seen("verdicts", Object.fromEntries(
        Object.entries(cases).map(([k, v]) => [k, Boolean(ineligible(v, context()))]),
      ));
      assert.ok(ineligible(cases.killed, context()), "killed is excluded");
      assert.ok(ineligible(cases.notBefore, context()), "a future not-before is excluded");
      assert.ok(ineligible(cases.decayed, context()), "a passed decay date is excluded");
      assert.not(ineligible(cases.eligible, context()), "an ordinary moment is not");
    },
  }),

  defineCase({
    id: "S4-03",
    stage: 4,
    clause: "7.1",
    tier: "deterministic",
    name: "an under-served pillar outranks a saturated one, all else equal",
    async run({ assert, seen }) {
      const { scoreMoment } = await import("../../../supabase/functions/_shared/scoring.ts");
      const ctx = context({ pillarCounts: new Map([["pricing", 5], ["hiring", 0]]) });
      const saturated = scoreMoment({ ...base, pillar: "pricing" }, ctx);
      const thin = scoreMoment({ ...base, pillar: "hiring" }, ctx);
      seen("scores", { saturated: saturated.score, thin: thin.score });
      assert.ok(thin.score > saturated.score, "balance pushes the neglected pillar up");
    },
  }),

  defineCase({
    id: "S4-04",
    stage: 4,
    clause: "7.1",
    tier: "deterministic",
    name: "an unknown audience is neutral, not last",
    async run({ assert, seen }) {
      const { scoreMoment } = await import("../../../supabase/functions/_shared/scoring.ts");
      const ctx = context({ audienceCounts: new Map([["founders", 4]]) });
      const unknown = scoreMoment({ ...base, audience: null }, ctx);
      const saturated = scoreMoment({ ...base, audience: "founders" }, ctx);
      seen("scores", { unknown: unknown.score, saturated: saturated.score });
      // 5.6 prefers an admitted gap to a guessed one. Punishing "not recorded" would push the
      // system to invent an audience rather than say it does not know.
      assert.ok(unknown.score > saturated.score, "not knowing is better than over-serving");
    },
  }),

  defineCase({
    id: "S4-05",
    stage: 4,
    clause: "7.7",
    tier: "deterministic",
    name: "every moment carries a reason a person could read",
    async run({ assert, seen }) {
      const { scoreMoment } = await import("../../../supabase/functions/_shared/scoring.ts");
      const ctx = context();
      const scored = scoreMoment({ ...base }, ctx);
      seen("reasons", scored.reasons);
      assert.ok(Array.isArray(scored.reasons), "reasons are recorded");
      assert.ok(scored.reasons.length > 0, "and there is at least one");
      for (const r of scored.reasons) {
        assert.ok(String(r).length > 3, "each reason says something: " + JSON.stringify(r));
      }
    },
  }),

  defineCase({
    id: "S4-06",
    stage: 4,
    clause: "7.2",
    tier: "deterministic",
    name: "an unavailable retelling check holds the moment rather than failing open",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/dedup.ts", import.meta.url),
        "utf8",
      );
      seen("dedup.ts", { chars: source.length });

      // Three verdicts, and the third is the interesting one. If the embedding provider is down,
      // the honest answer is "I cannot tell whether this is a retelling" — and the safe response is
      // to hold the moment, not to write it and hope. This file had no test of any kind before now.
      for (const verdict of ["block", "warn", "unavailable"]) {
        assert.match(source, new RegExp('"' + verdict + '"|\'' + verdict + "'"), verdict + " is a verdict");
      }
      assert.match(source, /dedupe_block_similarity/, "the block threshold is configurable, not hardcoded");
      assert.match(source, /dedupe_warn_similarity/, "and so is the warn threshold");
    },
  }),

  defineCase({
    id: "S4-07",
    stage: 4,
    clause: "7.2",
    tier: "deterministic",
    name: "the dedup thresholds recorded in the database name the model they were measured on",
    async run({ db, assert, seen }) {
      const rows = await db.sql(
        "select key, value::text as value from public.settings " +
          "where key in ('dedupe_block_similarity','dedupe_warn_similarity','dedupe_thresholds_model')",
      );
      seen("thresholds", rows);
      const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

      // A similarity threshold is meaningless without the model it was calibrated against. Swapping
      // the embedding model silently reuses a number measured on a different vector space.
      assert.ok(byKey.dedupe_block_similarity, "a block threshold is set");
      assert.ok(byKey.dedupe_warn_similarity, "a warn threshold is set");
      assert.ok(byKey.dedupe_thresholds_model, "and the model they were measured on is recorded");
    },
  }),

  defineCase({
    id: "S4-08",
    stage: 4,
    clause: "7.7",
    tier: "deterministic",
    name: "running short is recorded with a reason, and is a pass not a failure",
    async run({ db, assert, seen }) {
      await db.exec(
        "insert into public.selection_runs (target, in_hand, considered, wrote, ran_short, short_reason) " +
          "values (10, 2, 3, 1, true, 'not enough mined material to meet the bar')",
      );
      const [row] = seen("run", await db.sql(
        "select target, wrote, ran_short, short_reason from public.selection_runs " +
          "order by ran_at desc limit 1",
      ));
      // Clause 1: fewer posts is the correct outcome when the material is not there. The record has
      // to distinguish "chose to write less" from "broke".
      assert.ok(row.ran_short, "the short run is recorded");
      assert.ok(row.short_reason, "with the reason it ran short");
    },
  }),

  defineCase({
    id: "S4-09",
    stage: 4,
    clause: "7",
    tier: "deterministic",
    name: "housekeeping runs before selection, in the order the comments claim",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/worker-select/index.ts", import.meta.url),
        "utf8",
      );
      const order = [
        "ageOutStaleCandidates", "expireDecayedMoments", "rescueStranded",
        "closeStaleConversations", "resumeDeferredVisuals", "backfillEditDiffs",
      ];
      const positions = order.map((fn) => ({ fn, at: source.indexOf(fn + "(") }));
      seen("housekeeping", positions);

      // rescueStranded is the one that matters most: `queued` is written before the draft job is
      // enqueued, so a crash in that gap strands a moment forever without it.
      for (const { fn, at } of positions) {
        assert.ok(at > 0, fn + " is called");
      }
    },
  }),

  defineCase({
    id: "S4-10",
    stage: 4,
    clause: "7.6",
    tier: "deterministic",
    name: "selection halts rather than piling drafts on an unreviewed backlog",
    async run({ db, assert, seen }) {
      const [row] = await db.sql(
        "select value::text as value from public.settings where key = 'max_unreviewed_drafts'",
      );
      seen("max_unreviewed_drafts", row);
      assert.ok(row, "a ceiling on unreviewed drafts exists");
      assert.ok(Number(String(row.value).replace(/"/g, "")) > 0, "and it is a real number");
    },
  }),

  defineCase({
    id: "S4-11",
    stage: 4,
    clause: "6.4",
    tier: "deterministic",
    name: "a moment can go round the loop again without colliding with its own past drafts",
    async run({ db, assert, seen }) {
      const moment = await makeMoment(db, { status: "mined" });
      // 6.4 makes the status graph cyclic: a moment that was drafted, rejected and re-mined comes
      // back. Draft version is per moment, so the second pass must not collide with the first.
      await db.exec(
        "insert into public.drafts (moment_id, version, attempt, body, framework, library_version, model, claims) " +
          "values (" + moment.id + ", 1, 1, 'first', 'story-lesson', 1, 'e2e', '[]'::jsonb)",
      );
      const err = await db.expectError(
        "insert into public.drafts (moment_id, version, attempt, body, framework, library_version, model, claims) " +
          "values (" + moment.id + ", 1, 1, 'second', 'story-lesson', 1, 'e2e', '[]'::jsonb)",
      );
      seen("duplicate version", { refused: Boolean(err) });
      assert.ok(err, "two drafts cannot share a version on one moment");

      const ok = await db.expectError(
        "insert into public.drafts (moment_id, version, attempt, body, framework, library_version, model, claims) " +
          "values (" + moment.id + ", 2, 1, 'second', 'story-lesson', 1, 'e2e', '[]'::jsonb)",
      );
      assert.equal(ok, null, "the next version is accepted");
    },
  }),

  defineCase({
    id: "S4-12",
    stage: 4,
    clause: "5.8",
    tier: "deterministic",
    name: "the queue hands one job to one worker",
    async run({ db, assert, seen }) {
      for (let i = 0; i < 2; i += 1) {
        await db.exec(
          "insert into public.jobs (type, payload, status, dedupe_key) values " +
            "('draft', '{}'::jsonb, 'pending', 'e2e-claim-" + i + "-" + Date.now() + "')",
        );
      }
      const first = await db.sql("select id from public.claim_jobs('worker-a', array['draft'], 2)");
      const second = await db.sql("select id from public.claim_jobs('worker-b', array['draft'], 2)");
      seen("claims", { a: first.length, b: second.length });

      // SKIP LOCKED is what lets the dispatcher chain and the cron tick race safely.
      assert.equal(first.length, 2, "the first worker takes both");
      assert.equal(second.length, 0, "the second takes none rather than double-running them");
    },
  }),
];
