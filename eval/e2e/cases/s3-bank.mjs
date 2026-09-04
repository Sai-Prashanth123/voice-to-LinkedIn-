/**
 * Stage 3 — the idea bank.
 *
 * Clause 6.3 is the one Josh was given in writing: nothing he has said can be destroyed by any code
 * path. It is asserted here from both directions — the grant, and an actual attempted delete as
 * each role the system connects as.
 */

import { defineCase } from "../harness.mjs";
import { makeMaterial, makeMoment, minedMoment, q } from "../fixtures.mjs";

const APP_ROLES = ["anon", "authenticated", "service_role"];

export const cases = [
  ...APP_ROLES.map((role, i) =>
    defineCase({
      id: "S3-0" + (i + 1),
      stage: 3,
      clause: "6.3",
      tier: "deterministic",
      name: "the " + role + " role cannot delete a moment",
      async run({ db, assert, seen }) {
        const moment = await makeMoment(db);
        const err = await db.asRole(role, "delete from public.moments where id = " + moment.id);
        seen("attempt", { role, refused: Boolean(err) });
        assert.ok(err, role + " is refused");
        assert.match(err, /permission denied|insufficient_privilege/i, "on privileges, not on a policy");

        const [{ n }] = await db.sql(
          "select count(*)::int as n from public.moments where id = " + moment.id,
        );
        assert.equal(n, 1, "the row is still there");
      },
    })
  ),

  defineCase({
    id: "S3-04",
    stage: 3,
    clause: "6.3",
    tier: "deterministic",
    name: "no application role can truncate a table either",
    async run({ db, assert, seen }) {
      // DELETE was revoked everywhere and the guarantee was written down. TRUNCATE was not: it
      // empties a table, is not a DELETE so nothing guarding DELETE saw it, and no policy applies.
      // One line in one worker could have emptied the bank with every safeguard looking away.
      const rows = await db.sql(
        "select grantee, table_name, privilege_type from information_schema.role_table_grants " +
          "where table_schema = 'public' and privilege_type in ('DELETE','TRUNCATE') " +
          "and grantee in ('anon','authenticated','service_role','content_mcp')",
      );
      seen("destructive grants", rows);
      assert.same(rows, [], "no application role holds DELETE or TRUNCATE anywhere in public");
    },
  }),

  defineCase({
    id: "S3-05",
    stage: 3,
    clause: "6.3",
    tier: "deterministic",
    name: "a moment is killed and labelled rather than removed",
    async run({ db, assert, seen }) {
      const moment = await makeMoment(db);
      await db.exec(
        "update public.moments set killed = true, notes = 'declined by Josh' where id = " + moment.id,
      );
      const [row] = seen("killed", await db.sql(
        "select id, killed, notes, ref from public.moments where id = " + moment.id,
      ));
      assert.ok(row.killed, "it is marked killed");
      assert.ok(row.notes, "with a label saying why");
      assert.equal(row.ref, moment.ref, "and keeps its reference, so it can still be talked about");
    },
  }),

  defineCase({
    id: "S3-06",
    stage: 3,
    clause: "6.4",
    tier: "deterministic",
    name: "a parked moment cannot be parked without a reason",
    async run({ db, assert }) {
      const moment = await makeMoment(db);
      // "Parked" with no reason is indistinguishable from lost. Josh has to be able to read why.
      const err = await db.expectError(
        "update public.moments set status = 'parked' where id = " + moment.id,
      );
      assert.match(err, /park|reason|violates check/i, "parking demands a reason");

      const ok = await db.expectError(
        "update public.moments set status = 'parked', parked_reason = 'not enough to write from' " +
          "where id = " + moment.id,
      );
      assert.equal(ok, null, "with one, it parks");
    },
  }),

  defineCase({
    id: "S3-07",
    stage: 3,
    clause: "6.5",
    tier: "deterministic",
    name: "search survives whatever Josh types into it",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      await makeMaterial(db, moment.id, { the_moment: "The pricing conversation that went sideways." })
        .catch(() => {});

      // to_tsquery throws on an ordinary phrase; websearch_to_tsquery does not. A search box that
      // 500s on "what happened with pricing" is a search box nobody uses twice.
      for (const term of ["pricing", "what happened with pricing", "a & b", "quote \"this\"", "-- ;"]) {
        const rows = await db.sql(
          "select moment_id from public.search_moments(" + q(term) + ", 10)",
        );
        seen("search: " + term, rows);
        assert.ok(Array.isArray(rows), "searching for " + JSON.stringify(term) + " does not throw");
      }
    },
  }),

  defineCase({
    id: "S3-08",
    stage: 3,
    clause: "16 / 14.2",
    tier: "deterministic",
    name: "every table Josh owns is listed for export",
    async run({ db, assert, seen }) {
      const listed = await db.sql("select * from public.exportable_tables()");
      const actual = await db.sql(
        "select table_name as name from information_schema.tables " +
          "where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
      );
      seen("export list", { listed: listed.length, tables: actual.length });

      const listedNames = new Set(listed.map((r) => r.table_name));
      // A table added later and forgotten here is data Josh cannot take with him — the quiet way
      // "no lock-in" stops being true.
      const missing = actual
        .map((r) => r.name)
        .filter((n) => !listedNames.has(n) && !["exportable_tables"].includes(n));
      assert.same(missing, [], "no table is missing from the export list");
    },
  }),

  defineCase({
    id: "S3-09",
    stage: 3,
    clause: "9.1 / 8a",
    tier: "deterministic",
    name: "the drafter sees exactly the ten permitted fields, and never the archive",
    async run({ assert, seen }) {
      const { SOURCE_FIELDS, sourceEntry } = await import(
        "../../../supabase/functions/_shared/entry.ts"
      );
      seen("fields", SOURCE_FIELDS);

      assert.equal(SOURCE_FIELDS.length, 10, "ten fields, as clause 9.1 describes");
      assert.excludes([...SOURCE_FIELDS], "published_archive", "the archive is not among them (8a)");

      // A widened entry is how the claim ledger stops meaning anything: the drafter could cite a
      // field the verifier never checks.
      const entry = sourceEntry({
        the_moment: "kept",
        secret_internal_note: "must not appear",
        the_detail: "  ",
      });
      assert.same(Object.keys(entry), ["the_moment"], "unknown fields are dropped, blank ones omitted");
    },
  }),
];
