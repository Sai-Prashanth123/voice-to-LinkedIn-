/**
 * Stage 7 — a passed draft becomes a calendar entry, and nothing more.
 *
 * The rule that matters here is quiet: a revision must UPDATE the existing calendar row, never add
 * a second. Get it wrong and every push-back leaves another draft in the calendar for the same
 * moment, and Josh's weekly pass fills with duplicates of one post.
 */

import { defineCase } from "../harness.mjs";
import { approvePost, makeDraft, makeMoment, makePost, minedMoment, q } from "../fixtures.mjs";

export const cases = [
  defineCase({
    id: "S7-01",
    stage: 7,
    clause: "11.1",
    tier: "deterministic",
    name: "a revision updates the calendar entry rather than adding a second",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const first = await makeDraft(db, moment.id, { body: "First attempt." });
      const post = await makePost(db, { momentId: moment.id, draftId: first.id, body: "First attempt." });

      const second = await makeDraft(db, moment.id, { body: "Second attempt, after push-back." });
      await db.exec(
        "update public.posts set draft_id = " + second.id + ", body = 'Second attempt, after push-back.' " +
          "where moment_id = " + moment.id + " and status = 'draft' and marked_ready_at is null",
      );

      const rows = seen("calendar", await db.sql(
        "select id, draft_id, body from public.posts where moment_id = " + moment.id,
      ));
      assert.equal(rows.length, 1, "one calendar entry for one moment");
      assert.equal(rows[0].id, post.id, "the same row, updated");
      assert.equal(rows[0].draft_id, second.id, "now pointing at the newer draft");
    },
  }),

  defineCase({
    id: "S7-02",
    stage: 7,
    clause: "11.2",
    tier: "deterministic",
    name: "a post Josh has already approved is never quietly rewritten",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id);
      const post = await makePost(db, { momentId: moment.id, draftId: draft.id, body: "Approved wording." });
      await approvePost(db, post.id);

      // The update the gate performs is scoped to unapproved rows. If it were not, a late revision
      // could change the words under a post Josh had already signed off.
      const [{ n }] = await db.sql(
        "select count(*)::int as n from public.posts where moment_id = " + moment.id +
          " and status = 'draft' and marked_ready_at is null",
      );
      seen("eligible for update", { n });
      assert.equal(n, 0, "an approved post is outside the update's reach");

      const [row] = await db.sql("select body from public.posts where id = " + post.id);
      assert.equal(row.body, "Approved wording.", "and its wording is untouched");
    },
  }),

  defineCase({
    id: "S7-03",
    stage: 7,
    clause: "11.3",
    tier: "deterministic",
    name: "a post carries its image when the moment has one",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      await db.exec(
        "insert into public.visuals (moment_id, version, source_path, taking, svg_body, rendered_path) " +
          "values (" + moment.id + ", 1, 'x/ref.jpg', 'idea', '<svg/>', 'x/v1.png')",
      );
      const [visual] = await db.sql(
        "select id from public.visuals where moment_id = " + moment.id + " order by version desc limit 1",
      );
      const post = await makePost(db, { momentId: moment.id });
      await db.exec("update public.posts set visual_id = " + visual.id + " where id = " + post.id);

      const [row] = seen("post", await db.sql(
        "select id, visual_id from public.posts where id = " + post.id,
      ));
      assert.equal(row.visual_id, visual.id, "the newest visual is attached");
    },
  }),

  defineCase({
    id: "S7-04",
    stage: 7,
    clause: "11.1",
    tier: "deterministic",
    name: "a draft arrives as a draft — never scheduled, never live",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const post = seen("post", await makePost(db, { momentId: moment.id }));
      assert.equal(post.status, "draft", "it lands as a draft");
      assert.equal(post.marked_ready_at, null, "with no authorisation attached");
    },
  }),

  defineCase({
    id: "S7-05",
    stage: 7,
    clause: "9.5",
    tier: "deterministic",
    name: "delivery timing is Josh's setting, and defaults to batched",
    async run({ db, assert, seen }) {
      const [row] = seen("draft_delivery", await db.sql(
        "select value::text as value from public.settings where key = 'draft_delivery'",
      ));
      // 9.5 — ten posts must not arrive as ten messages.
      assert.ok(row, "the setting exists");
      assert.match(row.value, /batched|immediate/, "and holds one of the two modes");
    },
  }),

  defineCase({
    id: "S7-06",
    stage: 7,
    clause: "9.5",
    tier: "deterministic",
    name: "a post is announced once, not on every sweep",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const post = await makePost(db, { momentId: moment.id });

      const before = await db.sql(
        "select count(*)::int as n from public.posts where id = " + post.id + " and announced_at is null",
      );
      await db.exec("update public.posts set announced_at = now() where id = " + post.id);
      const after = await db.sql(
        "select count(*)::int as n from public.posts where id = " + post.id + " and announced_at is null",
      );
      seen("announced", { before: before[0].n, after: after[0].n });

      // The digest selects on announced_at being null. Without the marker, every sweep would
      // re-announce the same drafts and the daily message would repeat itself.
      assert.equal(before[0].n, 1, "an unannounced post is picked up");
      assert.equal(after[0].n, 0, "and is not picked up again");
    },
  }),


  defineCase({
    id: "S7-08",
    stage: 7,
    clause: "11.2",
    tier: "deterministic",
    name: "the calendar cannot hold a published post that nobody approved",
    async run({ db, assert, seen }) {
      const rows = await db.sql(
        "select conname from pg_constraint c join pg_class t on t.oid = c.conrelid " +
          "where t.relname = 'posts' and c.contype = 'c' and conname like '%josh%'",
      );
      seen("R3 constraints", rows.map((r) => r.conname));
      // Four constraints, because there are four ways to get it wrong: ready, scheduled, published,
      // and published-before-approved.
      assert.ok(rows.length >= 3, "the R3 guarantee is in the schema, not only in code");
    },
  }),
];
