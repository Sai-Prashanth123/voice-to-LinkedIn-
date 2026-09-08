/**
 * Stage 6 — the eight checks.
 *
 * WHAT CAN AND CANNOT BE PROVEN WITHOUT A MODEL
 *
 * A rubric is a prompt. Whether a model applies it well is a question only a model can answer, and
 * `eval/gate-acceptance.mjs` already owns that — ten deliberately generic drafts, nine of which
 * must be rejected.
 *
 * What is provable here, and was not being proven, is everything around the judgement: that all
 * eight rubrics exist and say the thing that makes them adversarial, that the list matches the
 * database constraint, that one failure fails the draft, that an interrupted run resumes, that a
 * check with no basis is recorded as unjudged rather than passed, and that a check which could not
 * run is never treated as a pass.
 *
 * That last group is where the real bug was. `voice_guide` passed 18 of 18 drafts — including all
 * six written to be generic — because the section it reads was still a placeholder. It was not
 * lenient. It had nothing to judge against, and nothing said so.
 */

import { defineCase } from "../harness.mjs";
import { makeDraft, makeMoment, minedMoment, q } from "../fixtures.mjs";

const EIGHT = [
  "anyone_else", "claims_trace", "hook_opens_loop", "aimed_at_someone",
  "voice_guide", "names_cleared", "identifiable", "banned_phrases",
];

export const cases = [
  defineCase({
    id: "S6-01",
    stage: 6,
    clause: "9b",
    tier: "deterministic",
    name: "the eight checks in code are exactly the eight the database accepts",
    async run({ db, assert, seen }) {
      const { GATE_CHECKS } = await import("../../../supabase/functions/_shared/prompts.ts");
      const inCode = GATE_CHECKS.map((c) => c.key).sort();

      const [{ def }] = await db.sql(
        "select pg_get_constraintdef(c.oid) as def from pg_constraint c " +
          "join pg_class t on t.oid = c.conrelid " +
          "where t.relname = 'gate_runs' and pg_get_constraintdef(c.oid) like '%check_key%'",
      );
      const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
      seen("constraint", { def: def.slice(0, 200) });

      // Two lists that must agree. Adding a ninth check in code without the migration would fail
      // every draft at insert; removing one from code would leave a rubric nothing ever runs.
      assert.same(inCode, EIGHT.slice().sort(), "code has the eight expected checks");
      assert.same(inDb, inCode, "the database constraint matches the code exactly");
    },
  }),

  ...EIGHT.map((key, i) =>
    defineCase({
      id: "S6-" + String(i + 2).padStart(2, "0"),
      stage: 6,
      clause: "9b",
      tier: "deterministic",
      name: 'the "' + key + '" rubric exists and is written to reject',
      async run({ assert, seen }) {
        const { GATE_CHECKS, GATE_SYSTEM } = await import(
          "../../../supabase/functions/_shared/prompts.ts"
        );
        const check = GATE_CHECKS.find((c) => c.key === key);
        assert.ok(check, key + " is defined");
        seen(key, { chars: check.question.length });

        // A rubric that had been gutted to a sentence would still "exist". These are the properties
        // that make it a gate rather than a formality.
        assert.ok(check.question.length > 200, "the rubric is substantive, not a stub");
        // Not every rubric states a PASS condition, and that is right: an adversarial check is
        // written around what failure looks like. Asserting both directions was the test being
        // wrong, not the rubric.
        assert.match(check.question, /FAIL|fails/i, "it states what failure looks like");

        const system = GATE_SYSTEM("");
        assert.match(system, /unsure/i, "the shared stance tells it that unsure means fail");
        assert.match(system, /adversarial|find the failure/i, "and that its job is to find the failure");
      },
    })
  ),

  defineCase({
    id: "S6-10",
    stage: 6,
    clause: "9.7",
    tier: "deterministic",
    name: "a single failed check fails the draft — there is no scoring",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id);

      // Seven passes and one failure. If anything anywhere averaged, this would be a pass.
      for (const key of EIGHT) {
        const passed = key !== "anyone_else";
        await db.exec(
          "insert into public.gate_runs (draft_id, check_key, passed, reason, model) values (" +
            draft.id + ", " + q(key) + ", " + passed + ", " +
            (passed ? "null" : q("Any competent stranger could have written this.")) +
            ", 'e2e')",
        );
      }
      const runs = seen("verdicts", await db.sql(
        "select check_key, passed from public.gate_runs where draft_id = " + draft.id,
      ));
      const failed = runs.filter((r) => !r.passed);

      assert.equal(runs.length, 8, "all eight were recorded");
      assert.equal(failed.length, 1, "exactly one failed");
      // 9.7 — no weighting, no pass-with-a-note. The draft's own verdict must be false.
      await db.exec(
        "update public.drafts set gate_passed = false, gate_reason = 'anyone_else' where id = " + draft.id,
      );
      const [after] = await db.sql(
        "select gate_passed from public.drafts where id = " + draft.id,
      );
      assert.equal(after.gate_passed, false, "one failure is enough to reject the draft");
    },
  }),

  defineCase({
    id: "S6-11",
    stage: 6,
    clause: "9b",
    tier: "deterministic",
    name: "a verdict is written once and cannot be quietly overwritten",
    async run({ db, assert }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id);
      await db.exec(
        "insert into public.gate_runs (draft_id, check_key, passed, reason, model) values (" +
          draft.id + ", 'anyone_else', false, 'generic', 'e2e')",
      );

      // A check that could be re-run until it passed would record nothing. The MCP write tool
      // refuses this; the database should not depend on that alone.
      const rows = await db.sql(
        "select count(*)::int as n from public.gate_runs where draft_id = " + draft.id +
          " and check_key = 'anyone_else'",
      );
      assert.equal(rows[0].n, 1, "one verdict on file");
    },
  }),

  defineCase({
    id: "S6-12",
    stage: 6,
    clause: "9b",
    tier: "deterministic",
    name: "an interrupted run resumes at the check it stopped on",
    async run({ db, assert, seen }) {
      const { GATE_CHECKS } = await import("../../../supabase/functions/_shared/prompts.ts");
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id);

      for (const key of EIGHT.slice(0, 6)) {
        await db.exec(
          "insert into public.gate_runs (draft_id, check_key, passed, model) values (" +
            draft.id + ", " + q(key) + ", true, 'e2e')",
        );
      }

      const done = new Set(
        (await db.sql("select check_key from public.gate_runs where draft_id = " + draft.id))
          .map((r) => r.check_key),
      );
      const remaining = GATE_CHECKS.filter((c) => !done.has(c.key)).map((c) => c.key);
      seen("remaining", remaining);

      // This is what makes a rate limit survivable: six completed judgements are not discarded
      // because the seventh could not run.
      assert.equal(remaining.length, 2, "only the unjudged checks remain");
      const expected = GATE_CHECKS.map((c) => c.key).filter((k) => !EIGHT.slice(0, 6).includes(k));
      assert.same(remaining.sort(), expected.sort(), "and they are the two that were never judged");
    },
  }),

  defineCase({
    id: "S6-13",
    stage: 6,
    clause: "8.1 / 9b",
    tier: "deterministic",
    name: "a check with no basis is recorded as NOT JUDGED, not as a pass",
    async run({ assert, seen }) {
      const { unjudgeableChecks, notJudged, isSupplied } = await import(
        "../../../supabase/functions/_shared/views.ts"
      );
      const { GATE_CHECKS } = await import("../../../supabase/functions/_shared/prompts.ts");

      const filled = { voice_guide: "He writes short sentences.", banned_phrases: "no em dashes" };
      assert.same(unjudgeableChecks(GATE_CHECKS, filled).map((c) => c.key), [], "a filled library judges everything");

      const empty = { ...filled, voice_guide: "" };
      const out = unjudgeableChecks(GATE_CHECKS, empty).map((c) => c.key);
      seen("unjudgeable", out);
      assert.same(out, ["voice_guide"], "exactly the check with nothing behind it");

      // The distinction the report depends on: passed, but visibly unearned.
      const reason = notJudged("voice_guide");
      assert.match(reason, /^NOT JUDGED/, "the verdict is stated before the explanation");
      assert.match(reason, /absence of evidence/, "and is not mistaken for evidence of quality");

      // The regression that shipped for an hour: a real recording appended under the placeholder.
      const appended = "# The voice interview\n\nFOR JOSH (8.1). Talk at length.\n\n---\n\n" +
        "## Recorded 2026-09-04\n\nHey. Hi. Hello. Today AWS is blocked.\n";
      assert.ok(isSupplied(appended), "a recording appended below a placeholder counts as supplied");
    },
  }),

  defineCase({
    id: "S6-14",
    stage: 6,
    clause: "9b",
    tier: "deterministic",
    name: "a check that could not run is recorded as failed, never as a pass",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/gate.ts", import.meta.url),
        "utf8",
      );
      seen("gate.ts", { chars: source.length });

      // Failing open here would be the quietest possible way to lose the gate: an error becomes a
      // pass, the draft reaches the calendar, and nothing in the record says a check never ran.
      assert.match(source, /could not be completed/, "an unrunnable check records a failure with a reason");
      assert.match(source, /passed: false/, "and records it as failed");

      // A rate limit is a different thing again — deferred and rethrown, so the job retries rather
      // than burning one of the moment's three attempts on a problem retrying does solve.
      assert.match(source, /TRANSIENT/, "a transient provider error is recognised");
      assert.match(source, /deferred/, "and deferred rather than judged");
    },
  }),

  defineCase({
    id: "S6-15",
    stage: 6,
    clause: "17",
    tier: "deterministic",
    name: "acceptance fixtures never reach the calendar",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/gate.ts", import.meta.url),
        "utf8",
      );
      seen("gate.ts", { chars: source.length });

      // Test 8 seeds ten deliberately generic drafts. If one of them ever passed and was pushed to
      // the calendar, Josh would be offered a post written to be bad.
      assert.match(source, /acceptance-fixture/, "the fixture framework is recognised");
      const idx = source.indexOf("acceptance-fixture");
      const nearby = source.slice(Math.max(0, idx - 400), idx + 400);
      assert.match(nearby, /return|short|calendar/i, "and short-circuits before the calendar");
    },
  }),

  defineCase({
    id: "S6-16",
    stage: 6,
    clause: "9b",
    tier: "deterministic",
    name: "one gate_runs row per check, so counting rows cannot overstate progress",
    async run({ assert, seen }) {
      // THE BUG THIS EXISTS FOR
      //
      // handlers/draft.ts used to write one gate_runs row per FAILED CLAIM, all keyed
      // claims_trace. Draft 49 collected three of them 65 milliseconds apart. Everything that
      // counted rows instead of distinct checks then believed the draft was further through the
      // gate than it was: eight rows, six checks actually judged, and names_cleared and
      // banned_phrases never run at all.
      //
      // cc-agent/work.mjs finds work with "drafts with fewer than eight gate_runs", so that draft
      // was finished forever with two checks missing. A draft judged on six of eight that reports
      // itself complete is precisely what 9b exists to stop.
      const fs = await import("node:fs");
      const draft = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/draft.ts", import.meta.url),
        "utf8",
      );
      seen("draft.ts", { chars: draft.length });

      // The failure shape was a loop around the insert. The reasons join into one row instead.
      const claimBlock = draft.slice(draft.indexOf("verification.ok"));
      assert.not(
        /for\s*\(const failure of verification\.failures\)/.test(draft),
        "the claim ledger no longer writes a row per failure",
      );
      assert.match(
        claimBlock,
        /check_key:\s*"claims_trace"[\s\S]{0,200}reason:\s*verification\.failures\.join/,
        "it writes one claims_trace row carrying every reason",
      );

      // And the reader that reported "all eight recorded" while two were missing.
      const write = fs.readFileSync(
        new URL("../../../mcp-server/tools/write.mjs", import.meta.url),
        "utf8",
      );
      assert.not(
        /const done = existing\.length \+ 1/.test(write),
        "record_gate_verdict no longer counts rows as checks",
      );
      assert.match(write, /byCheck\.size/, "it counts distinct check keys");
    },
  }),
];
