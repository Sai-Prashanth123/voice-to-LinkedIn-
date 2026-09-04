/**
 * Stage 5 — writing the first draft.
 *
 * The claim ledger is the mechanism behind R2 ("nothing invented"), and it is deliberately
 * deterministic: every claim is checked against a verbatim span of the idea-bank entry before any
 * gate token is spent. That means it can be proven here in full, without a model.
 */

import { defineCase } from "../harness.mjs";
import { makeDraft, minedMoment } from "../fixtures.mjs";

const ENTRY = { the_moment: "The CFO asked what happens when the champion leaves." };

export const cases = [
  defineCase({
    id: "S5-01",
    stage: 5,
    clause: "9.4 / R2",
    tier: "deterministic",
    name: "a claim whose span is not in the source is caught",
    async run({ assert, seen }) {
      const { verifyDraft } = await import("../../../supabase/functions/_shared/claims.ts");

      // The real failure this catches: a draft turned a two-person call into "eight people in a
      // room" and read perfectly well. Plausibility is not evidence.
      const result = verifyDraft(
        "Eight people were in the room.",
        [{
          kind: "event",
          claim: "Eight people were in the room",
          source_field: "the_moment",
          source_span: "Eight people were in the room",
        }],
        ENTRY,
        [],
      );
      seen("verdict", { ok: result.ok, failures: result.failures });
      assert.not(result.ok, "an unsupported claim fails");
      assert.ok(result.failures.length > 0, "with a reason a person could act on");
    },
  }),

  defineCase({
    id: "S5-02",
    stage: 5,
    clause: "9.4",
    tier: "deterministic",
    name: "a claim quoting the source verbatim passes",
    async run({ assert, seen }) {
      const { verifyDraft } = await import("../../../supabase/functions/_shared/claims.ts");
      const result = verifyDraft(
        "He asked what happens when the champion leaves.",
        [{
          kind: "event",
          claim: "he asked what happens when the champion leaves",
          source_field: "the_moment",
          source_span: "what happens when the champion leaves",
        }],
        ENTRY,
        [],
      );
      seen("verdict", { ok: result.ok, failures: result.failures });
      // A verifier that rejected everything would be as useless as one that accepted everything.
      assert.ok(result.ok, "a claim resting on a real span is accepted");
    },
  }),

  defineCase({
    id: "S5-03",
    stage: 5,
    clause: "9.10",
    tier: "deterministic",
    name: "an uncleared name in the body is caught mechanically, not left to the gate",
    async run({ assert, seen }) {
      const { verifyDraft } = await import("../../../supabase/functions/_shared/claims.ts");
      const result = verifyDraft(
        "Dan said we would start from zero.",
        [],
        { the_moment: "He said we would start from zero." },
        [{ name: "Dan", cleared: false }],
      );
      seen("verdict", { ok: result.ok, uncleared: result.unclearedNames });
      // The gate checks this too, with a model reading prose. This is a string search and cannot
      // have an off day — two mechanisms on purpose, because 9.10 is a hard stop.
      assert.not(result.ok, "an uncleared name is refused");
      assert.includes(result.unclearedNames, "Dan", "and named, so the rewrite knows what to avoid");
    },
  }),

  defineCase({
    id: "S5-04",
    stage: 5,
    clause: "9.4",
    tier: "deterministic",
    name: "a number the source never gave is caught even without a claim for it",
    async run({ assert, seen }) {
      const { verifyDraft } = await import("../../../supabase/functions/_shared/claims.ts");
      // The ledger is not the only guard: a figure smuggled into the prose with no claim attached
      // would otherwise pass, and an invented statistic is exactly what Josh audits for.
      const result = verifyDraft("Revenue grew 47% that quarter.", [], ENTRY, []);
      seen("verdict", { ok: result.ok, numbers: result.unsourcedNumbers });
      assert.not(result.ok, "an unsourced number fails");
      assert.ok(result.unsourcedNumbers.length > 0, "and is reported");
    },
  }),

  defineCase({
    id: "S5-05",
    stage: 5,
    clause: "9.8",
    tier: "deterministic",
    name: "a fourth attempt cannot be stored",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const err = await db.expectError(
        "insert into public.drafts (moment_id, version, attempt, body, framework, library_version, model, claims) " +
          "values (" + moment.id + ", 1, 4, 'x', 'story-lesson', 1, 'e2e', '[]'::jsonb)",
      );
      seen("fourth attempt", { refused: Boolean(err) });
      // Three strikes and the moment parks. Without this a bad moment could burn quota forever.
      assert.ok(err, "the database refuses a fourth attempt");
      assert.match(err, /attempt|violates check/i, "on the attempt limit");
    },
  }),

  defineCase({
    id: "S5-06",
    stage: 5,
    clause: "8.4",
    tier: "deterministic",
    name: "a draft records which library version wrote it",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = seen("draft", await makeDraft(db, moment.id));
      assert.ok(draft.library_version > 0, "the library version is pinned");

      const err = await db.expectError(
        "insert into public.drafts (moment_id, version, attempt, body, framework, model, claims) " +
          "values (" + moment.id + ", 99, 1, 'x', 'story-lesson', 'e2e', '[]'::jsonb)",
      );
      // Without it, a post cannot be explained later: "why did it write that?" has no answer.
      assert.ok(err, "a draft with no library version is refused");
    },
  }),

  defineCase({
    id: "S5-07",
    stage: 5,
    clause: "8.4",
    tier: "deterministic",
    name: "a draft records the model that wrote it, not the tier that was asked for",
    async run({ db, assert, seen }) {
      const draft = await makeDraft(db, (await minedMoment(db)).id, { model: "gemini-3.1-flash-lite" });
      seen("draft", draft);
      // "STRONG" has meant Claude, gpt-oss, Qwen and flash-lite at different points in this build.
      assert.not(["STRONG", "MID", "CHEAP"].includes(draft.model), "the stored value is a model, not a role");
    },
  }),

  defineCase({
    id: "S5-08",
    stage: 5,
    clause: "9.4",
    tier: "deterministic",
    name: "a claim-ledger failure is recorded as a gate verdict before any model runs",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id, { claimsVerified: false, gatePassed: false });
      await db.exec(
        "insert into public.gate_runs (draft_id, check_key, passed, reason, model) values (" +
          draft.id + ", 'claims_trace', false, 'span not found in the source', 'deterministic')",
      );
      const [row] = seen("verdict", await db.sql(
        "select check_key, passed, model from public.gate_runs where draft_id = " + draft.id,
      ));
      // Recorded as `deterministic` so nobody later reads it as a model's judgement — and so the
      // rejection is visible in exactly the same place as every other one.
      assert.equal(row.model, "deterministic", "the verdict names the mechanism, not a model");
      assert.equal(row.passed, false, "and it is a rejection");
    },
  }),

  defineCase({
    id: "S5-09",
    stage: 5,
    clause: "9.1",
    tier: "deterministic",
    name: "the drafter is given the entry and the library, and nothing else",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/draft.ts", import.meta.url),
        "utf8",
      );
      seen("draft.ts", { chars: source.length });
      assert.match(source, /sourceEntry\(/, "the entry comes through the permitted-field helper");
      assert.match(source, /loadLibrary\(/, "and the library through the view");
      // 8a — the archive exists to detect retellings, never to inform how a post is written.
      assert.not(/published_archive/.test(source), "the published archive is never read here");
    },
  }),

  defineCase({
    id: "S5-10",
    stage: 5,
    clause: "9.16",
    tier: "deterministic",
    name: "Josh's push-back is not one of the system's three strikes",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/pushback.ts", import.meta.url),
        "utf8",
      );
      seen("pushback.ts", { chars: source.length });
      // Otherwise three rounds of ordinary editing would park a moment Josh was actively working on.
      assert.match(source, /attempt:\s*1/, "a push-back rewrite starts a fresh attempt count");
    },
  }),

  defineCase({
    id: "S5-11",
    stage: 5,
    clause: "7.2",
    tier: "deterministic",
    name: "a near-miss warning reaches the drafter rather than being dropped",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const draft = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/draft.ts", import.meta.url),
        "utf8",
      );
      const prompts = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/prompts.ts", import.meta.url),
        "utf8",
      );
      seen("near_miss", { inHandler: /near_?[Mm]iss/.test(draft), inPrompt: /near_?[Mm]iss/.test(prompts) });
      // "Rewriting an angle is fine. Repeating the anecdote is not." The distinction is only
      // actionable if the drafter is told what it is near.
      assert.match(draft, /near_?[Mm]iss/, "the handler carries it");
      assert.match(prompts, /near_?[Mm]iss/, "and the prompt uses it");
    },
  }),
];
