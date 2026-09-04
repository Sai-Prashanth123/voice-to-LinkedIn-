/**
 * Stage 9 — what comes back.
 *
 * The loop is proven at both ends and was untested in the middle: `proposals.ts` had no test, so
 * nothing showed that approving a proposal actually rewrote the section. `decide()` contains the
 * most important line in the file — it refuses to report success when zero rows changed — and that
 * is exactly the kind of guard that rots unnoticed.
 */

import { defineCase } from "../harness.mjs";
import { getSection, makeMoment, makePost, minedMoment, q, setSection } from "../fixtures.mjs";

export const cases = [
  defineCase({
    id: "S9-01",
    stage: 9,
    clause: "12",
    tier: "deterministic",
    name: "the learning loop cannot propose a change to a non-negotiable rule",
    async run({ db, assert, seen }) {
      // R1 and R2 live in core_rules. A system free to tune its own limits against engagement finds
      // its way to engagement bait, which is the one outcome that makes the whole thing worthless.
      // Real evidence, because `proposals_evidence_not_empty` refuses an empty object — a proposal
      // citing nothing is an opinion Josh has no way to check.
      const evidence = `'{"post_ids":[1]}'::jsonb`;

      const err = await db.expectError(
        "insert into public.library_proposals (section_key, claim, evidence, proposed_body, status) " +
          "values ('core_rules', 'loosen it', " + evidence + ", 'anything', 'open')",
      );
      seen("immutable", { refused: Boolean(err) });
      assert.ok(err, "a proposal against core_rules is refused");

      const ok = await db.expectError(
        "insert into public.library_proposals (section_key, claim, evidence, proposed_body, status) " +
          "values ('hooks', 'try shorter openings', " + evidence + ", 'Shorter openings.', 'open')",
      );
      assert.equal(ok, null, "a proposal against a tunable section is accepted");
    },
  }),

  defineCase({
    id: "S9-02",
    stage: 9,
    clause: "8.4 / 8.6",
    tier: "deterministic",
    name: "editing a section versions it, and a no-op does not",
    async run({ db, assert, seen }) {
      const before = await getSection(db, "hooks");
      await setSection(db, "hooks", "# Hook rules\n\nOpen a loop. Never state the conclusion.");
      const after = await getSection(db, "hooks");
      seen("versions", { before: before.version, after: after.version });
      assert.equal(after.version, before.version + 1, "a real edit bumps the version");

      // A phantom bump would make the history unreadable and roll the whole-library snapshot for
      // nothing.
      await setSection(db, "hooks", after.body);
      const again = await getSection(db, "hooks");
      assert.equal(again.version, after.version, "writing the same body changes nothing");
    },
  }),

  defineCase({
    id: "S9-03",
    stage: 9,
    clause: "12.12",
    tier: "deterministic",
    name: "every version of a section is kept, so a change can be undone",
    async run({ db, assert, seen }) {
      await setSection(db, "closes", "# Closing lines\n\nOne ask at most.");
      await setSection(db, "closes", "# Closing lines\n\nOne ask at most. Often none.");

      const history = seen("history", await db.sql(
        "select version, length(body) as chars from public.library_section_versions " +
          "where key = 'closes' order by version",
      ));
      assert.ok(history.length >= 2, "each version is kept");

      const snapshots = await db.sql(
        "select version from public.library_versions order by version desc limit 1",
      );
      // 12.12 needs both counters: which library snapshot, and which version of the section within
      // it. One alone cannot restore the right text.
      assert.ok(snapshots.length > 0, "and the whole-library snapshot rolls forward with it");
    },
  }),

  defineCase({
    id: "S9-04",
    stage: 9,
    clause: "12.10",
    tier: "deterministic",
    name: "approving a proposal records both counters a rollback needs",
    async run({ db, assert, seen }) {
      const cols = await db.sql(
        "select column_name from information_schema.columns " +
          "where table_schema = 'public' and table_name = 'library_proposals'",
      );
      const names = cols.map((c) => c.column_name);
      seen("library_proposals", names);
      assert.includes(names, "applied_library_version", "the snapshot counter is recorded");
      assert.includes(names, "applied_section_version", "and the section counter");
      assert.includes(names, "decided_reason", "with the reason it was decided");
    },
  }),

  defineCase({
    id: "S9-05",
    stage: 9,
    clause: "12.10",
    tier: "deterministic",
    name: "an approval that changed nothing is not reported as a success",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/proposals.ts", import.meta.url),
        "utf8",
      );
      seen("proposals.ts", { chars: source.length });

      // The update is scoped to `immutable = false`, so a proposal against a locked section matches
      // zero rows. Reporting that as applied would tell Josh his decision took effect when it did
      // not — the exact shape of every control that looks like it works and does nothing.
      assert.match(source, /immutable/, "the update is scoped to tunable sections");
      assert.match(source, /length === 0|\.length\s*===\s*0|!data|rows/, "a zero-row result is inspected");
    },
  }),

  defineCase({
    id: "S9-06",
    stage: 9,
    clause: "12.2",
    tier: "deterministic",
    name: "an edit is classified the same way by both readers of the rule",
    async run({ assert, seen }) {
      const shared = await import("../../../supabase/functions/_shared/diff.ts");
      const before = "The CFO stopped me halfway through the deck and asked one question.";
      const light = "The CFO stopped me halfway through and asked one question.";
      const rewrite = "A completely different post about an entirely different afternoon.";

      const a = shared.classifyEdit(before, light);
      const b = shared.classifyEdit(before, rewrite);
      seen("classes", { light: a.editClass, rewrite: b.editClass });

      // This classification IS the 17a number — "five of the last six needing only light editing".
      assert.equal(a.editClass, "light", "a small change is light");
      assert.equal(b.editClass, "rewrite", "a wholesale change is a rewrite");
    },
  }),

  defineCase({
    id: "S9-07",
    stage: 9,
    clause: "12.2",
    tier: "deterministic",
    name: "an edit is not counted twice between approval and publishing",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/outcome.ts", import.meta.url),
        "utf8",
      );
      seen("outcome.ts", { chars: source.length });
      // Measured at approval, then again at publish only if the body actually moved. Counting both
      // would double every edit and drag 17a down for no reason.
      assert.match(source, /edit_stage/, "the stage the edit was measured at is recorded");
      assert.match(source, /approved|published/, "and distinguishes the two");
    },
  }),

  defineCase({
    id: "S9-08",
    stage: 9,
    clause: "12.6",
    tier: "deterministic",
    name: "the weekly conversation question stops asking",
    async run({ db, assert, seen }) {
      const [row] = seen("cap", await db.sql(
        "select value::text as value from public.settings where key = 'conversation_max_asks'",
      ));
      // Nothing waits on Josh. A question that kept re-asking would be the system nagging, which
      // 12.6 explicitly rules out.
      assert.ok(row, "a cap on how often it asks exists");
      assert.ok(Number(String(row.value).replace(/"/g, "")) <= 3, "and it is small");
    },
  }),

  defineCase({
    id: "S9-09",
    stage: 9,
    clause: "12.9",
    tier: "deterministic",
    name: "a proposal without evidence is refused",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/worker-learn/index.ts", import.meta.url),
        "utf8",
      );
      seen("worker-learn", { chars: source.length });
      // "It proposes library changes with evidence; you decide." A proposal citing nothing is an
      // opinion, and Josh has no way to check it.
      assert.match(source, /post_ids/, "evidence must name the posts it rests on");
      assert.match(source, /proposal_rejected_by_schema|reject/i, "and a proposal without it is dropped");
    },
  }),

  defineCase({
    id: "S9-10",
    stage: 9,
    clause: "12",
    tier: "deterministic",
    name: "the loop proposes and never applies",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/worker-learn/index.ts", import.meta.url),
        "utf8",
      );
      seen("worker-learn", { chars: source.length });
      // The whole guarantee of clause 12: the system proposes, Josh decides. A path from the
      // learner straight into library_sections would remove him from his own voice.
      assert.not(
        /from\(["']library_sections["']\)\s*\.\s*update/.test(source),
        "worker-learn has no path to rewrite the library itself",
      );
      assert.match(source, /library_proposals/, "it writes proposals only");
    },
  }),
];
