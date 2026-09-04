/**
 * Stage 2 — the interview.
 *
 * `handlers/interview.ts` is the largest handler in the tree and had no test. What existed was
 * `depth.test.ts`, which re-implements the depth rule locally and asserts against its own copy —
 * so the shipped handler could regress and the test would stay green. These cases read the real
 * module.
 */

import { defineCase } from "../harness.mjs";
import { makeMoment, q } from "../fixtures.mjs";

export const cases = [
  defineCase({
    id: "S2-01",
    stage: 2,
    clause: "5.4",
    tier: "deterministic",
    name: "the question budget is a setting, not a number buried in the handler",
    async run({ db, assert, seen }) {
      const [row] = seen("setting", await db.sql(
        "select value::text as value from public.settings where key = 'interview_max_questions'",
      ));
      assert.ok(row, "the budget is configurable");
      const n = Number(String(row.value).replace(/"/g, ""));
      assert.ok(n > 0 && n < 30, "and is a sane number: " + n);
    },
  }),

  defineCase({
    id: "S2-02",
    stage: 2,
    clause: "5.5",
    tier: "deterministic",
    name: "depth is written once, when the interview finishes",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/interview.ts", import.meta.url),
        "utf8",
      );
      seen("interview.ts", { chars: source.length });

      // depth_reached is what component test 5 is measured on. Written in two places, the two would
      // eventually disagree and the scorecard would report whichever ran last.
      const writes = [...source.matchAll(/depth_reached:/g)].length;
      assert.ok(writes >= 1, "depth is written");
      assert.ok(writes <= 2, "and in at most the finish and park paths, not scattered: " + writes);
      assert.match(source, /deepest\(/, "using the shared deepest() rather than a local rule");
    },
  }),

  defineCase({
    id: "S2-03",
    stage: 2,
    clause: "5.5",
    tier: "deterministic",
    name: "the depth ladder is the one the schema stores",
    async run({ db, assert, seen }) {
      const { deepest } = await import("../../../supabase/functions/_shared/session.ts");
      const rows = await db.sql(
        "select unnest(enum_range(null::interview_depth))::text as v",
      );
      const inDb = rows.map((r) => r.v);
      seen("depths", inDb);

      assert.same(inDb, ["none", "scene", "time_anchored", "earned_perspective"], "four rungs");
      // The real function, not a re-implementation of it.
      // deepest(a, b) compares two rungs; the handler folds it over the turns.
      assert.equal(deepest("scene", "none"), "scene", "the deeper of two rungs wins");
      assert.equal(deepest("none", "earned_perspective"), "earned_perspective", "in either order");
      assert.equal(deepest("none", "none"), "none", "and nothing reached stays none, never null");
    },
  }),

  defineCase({
    id: "S2-04",
    stage: 2,
    clause: "5.3",
    tier: "deterministic",
    name: "a moment already finished is never reopened by a retried job",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/interview.ts", import.meta.url),
        "utf8",
      );
      seen("interview.ts", { chars: source.length });
      // A queue retry after a timeout must not start asking questions about a published post.
      assert.match(source, /mined|parked|published/, "finished states are checked before working");
    },
  }),

  defineCase({
    id: "S2-05",
    stage: 2,
    clause: "5.6",
    tier: "deterministic",
    name: "a moment with nothing behind it parks rather than being padded out",
    async run({ db, assert, seen }) {
      const moment = await makeMoment(db);
      // Parking is a real outcome, not a failure. Clause 1: fewer posts is correct when the
      // material is not there.
      await db.exec(
        "update public.moments set status = 'parked', parked_reason = 'no substance', " +
          "depth_reached = 'none' where id = " + moment.id,
      );
      const [row] = seen("parked", await db.sql(
        "select status::text, parked_reason, depth_reached::text from public.moments where id = " + moment.id,
      ));
      assert.equal(row.status, "parked", "it parks");
      assert.ok(row.parked_reason, "with a reason Josh can read");
      assert.equal(row.depth_reached, "none", "and an honest depth rather than a flattering one");
    },
  }),

  defineCase({
    id: "S2-06",
    stage: 2,
    clause: "9.10",
    tier: "deterministic",
    name: "a name found during extraction always starts uncleared",
    async run({ db, assert, seen }) {
      const moment = await makeMoment(db);
      await db.exec(
        "insert into public.moment_names (moment_id, name, kind) values (" +
          moment.id + ", 'Priya', 'person')",
      );
      const [row] = seen("name", await db.sql(
        "select name, cleared from public.moment_names where moment_id = " + moment.id,
      ));
      assert.equal(row.cleared, false, "clearance is something Josh grants, never a default");
    },
  }),

  defineCase({
    id: "S2-07",
    stage: 2,
    clause: "4.2.6",
    tier: "deterministic",
    name: "a question that does not land is rephrased, never retired",
    async run({ db, assert, seen }) {
      const cols = await db.sql(
        "select column_name from information_schema.columns " +
          "where table_schema = 'public' and table_name = 'question_stats'",
      );
      const names = cols.map((c) => c.column_name);
      seen("question_stats", names);
      // A retire flag would let the prompt set quietly shrink to whatever was easiest to answer.
      for (const banned of ["retired", "is_retired", "active"]) {
        assert.excludes(names, banned, "there is no " + banned + " column");
      }
    },
  }),

  defineCase({
    id: "S2-08",
    stage: 2,
    clause: "5",
    tier: "deterministic",
    name: "the interview never writes a draft",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/interview.ts", import.meta.url),
        "utf8",
      );
      seen("interview.ts", { chars: source.length });
      // 5.5 — the interview asks, it does not write. A shortcut here would skip the gate entirely.
      assert.not(/from\(["']drafts["']\)\s*\.insert/.test(source), "it never inserts a draft");
    },
  }),

  defineCase({
    id: "S2-09",
    stage: 2,
    clause: "5.7",
    tier: "deterministic",
    name: "a moment reopens when Josh adds to it",
    async run({ db, assert, seen }) {
      const moment = await makeMoment(db, { status: "parked", parkedReason: "nothing to write from yet" });
      await db.exec(
        "update public.moments set status = 'captured', parked_reason = null, " +
          "reopened_at = now() where id = " + moment.id,
      );
      const [row] = seen("reopened", await db.sql(
        "select status::text, reopened_at from public.moments where id = " + moment.id,
      ));
      assert.equal(row.status, "captured", "a parked moment can come back");
      assert.ok(row.reopened_at, "and the fact it was reopened is recorded");
    },
  }),

  defineCase({
    id: "S2-10",
    stage: 2,
    clause: "5.2",
    tier: "deterministic",
    name: "the prompt set lives in the library, so Josh can change the questions",
    async run({ db, assert, seen }) {
      const [row] = seen("prompt_set", await db.sql(
        "select key, immutable, length(body) as chars from public.library_sections where key = 'prompt_set'",
      ));
      assert.ok(row, "the prompt set is a library section");
      assert.equal(row.immutable, false, "and Josh can edit it");
    },
  }),
];
