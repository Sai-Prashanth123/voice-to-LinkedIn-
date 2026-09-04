/**
 * Stage 1 — the five ways material gets in.
 *
 * Slack had zero coverage of any kind before this file: no test, no assertion, not even a count in
 * the clause-17 scorecard. It ships switched off, and "off by default" is exactly the sort of
 * setting that quietly becomes "on by default" in a later migration with nobody noticing.
 */

import { defineCase } from "../harness.mjs";
import { makeJob, makeMoment, q } from "../fixtures.mjs";

export const cases = [
  defineCase({
    id: "S1-01",
    stage: 1,
    clause: "4.1.2",
    tier: "deterministic",
    name: "a voice note without audio is refused",
    async run({ db, assert }) {
      const moment = await makeMoment(db);
      // A voice row with no file is a moment that can never be transcribed, and it would sit in the
      // bank looking like captured material forever.
      const err = await db.expectError(
        "insert into public.raw_inputs (moment_id, kind) values (" + moment.id + ", 'voice')",
      );
      assert.match(err, /audio|violates check/i, "the database refuses a voice input with no audio");

      await db.exec(
        "insert into public.raw_inputs (moment_id, kind, audio_path) values (" +
          moment.id + ", 'voice', '1/x.ogg')",
      );
      const [{ n }] = await db.sql(
        "select count(*)::int as n from public.raw_inputs where moment_id = " + moment.id,
      );
      assert.equal(n, 1, "the same row with audio is accepted");
    },
  }),

  defineCase({
    id: "S1-02",
    stage: 1,
    clause: "4.3.2 / 4.4.4",
    tier: "deterministic",
    name: "only automatic sources can arrive as a candidate",
    async run({ db, assert }) {
      // half_mined means "surfaced by the system, not yet interviewed". A voice note Josh sent is
      // never that — it goes to captured and gets a question back.
      const err = await db.expectError(
        "insert into public.moments (source, status) values ('raw_capture', 'half_mined')",
      );
      assert.match(err, /half_mined|violates check/i, "a raw capture cannot be a candidate");

      const ok = await db.expectError(
        "insert into public.moments (source, status) values ('claude_code', 'half_mined')",
      );
      assert.equal(ok, null, "an automatic source can be");
    },
  }),

  defineCase({
    id: "S1-03",
    stage: 1,
    clause: "4.5.2",
    tier: "deterministic",
    name: "Slack ships switched off",
    async run({ db, assert, seen }) {
      const [row] = await db.sql(
        "select value::text as value from public.settings where key = 'slack_enabled'",
      );
      seen("slack_enabled", row);
      assert.ok(row, "the setting exists");
      assert.match(row.value, /false/, "and is false on a fresh database");
    },
  }),

  defineCase({
    id: "S1-04",
    stage: 1,
    clause: "4.5.3",
    tier: "deterministic",
    name: "a name from Slack is never cleared automatically",
    async run({ db, assert, seen }) {
      // 4.5.3: this is other people's words in a place they did not expect quoting. A name lifted
      // from a Slack thread must start uncleared like any other, and the column default is what
      // guarantees it whatever the worker does.
      const moment = await makeMoment(db, { source: "slack", status: "half_mined" });
      await db.exec(
        "insert into public.moment_names (moment_id, name, kind) values (" +
          moment.id + ", 'Someone In A Thread', 'person')",
      );
      const [name] = seen("name", await db.sql(
        "select name, cleared from public.moment_names where moment_id = " + moment.id,
      ));
      assert.equal(name.cleared, false, "it defaults to uncleared");
    },
  }),

  defineCase({
    id: "S1-05",
    stage: 1,
    clause: "13.2",
    tier: "deterministic",
    name: "the same delivery twice creates one job, not two",
    async run({ db, assert, seen }) {
      // Telegram retries, transcript webhooks retry, cc-agent re-sends after a failure. Without the
      // dedupe key a retried delivery becomes a second moment about the same thing.
      const key = "triage:call_transcript:e2e-same-id";
      await makeJob(db, "triage_digest", { source: "call_transcript" }, { dedupeKey: key });
      const err = await db.expectError(
        "insert into public.jobs (type, payload, status, dedupe_key) values " +
          "('triage_digest', '{}'::jsonb, 'pending', " + q(key) + ")",
      );
      seen("second insert", { refused: Boolean(err) });
      assert.ok(err, "a duplicate delivery is refused by the unique dedupe key");
      assert.match(err, /dedupe|unique|duplicate/i, "and refused for that reason");
    },
  }),

  defineCase({
    id: "S1-06",
    stage: 1,
    clause: "4.1",
    tier: "deterministic",
    name: "an unauthorised chat is recorded with its id rather than dropped in silence",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/telegram-webhook/index.ts", import.meta.url),
        "utf8",
      );
      seen("telegram-webhook", { chars: source.length });

      // Rejecting an unknown chat has to stay silent to the sender (15.4). But silence is also what
      // a total credential failure looks like from outside, and a real message was dropped that way
      // while the function returned 200. Recording the id distinguishes them — and it is how Josh
      // gets let in when he first messages the bot.
      assert.match(source, /telegram_unauthorised/, "the rejection is logged");
      assert.match(source, /chat_id: msg\.chat\.id/, "with the chat id, so the sender can be identified");
      assert.match(source, /expected_configured/, "and whether an allowlist was configured at all");
    },
  }),

  defineCase({
    id: "S1-07",
    stage: 1,
    clause: "4.3",
    tier: "deterministic",
    name: "the transcript webhook understands every shape it claims to",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/transcript-webhook/index.ts", import.meta.url),
        "utf8",
      );
      seen("transcript-webhook", { chars: source.length });

      for (const adapter of ["fireflies", "fathom", "flat", "generic"]) {
        assert.match(source, new RegExp(adapter), adapter + " is handled");
      }
      // A transcript that arrives and is ignored must say so, or a missing call looks like a quiet
      // week rather than a webhook pointed at the wrong shape.
      assert.match(source, /transcript_ignored/, "an unrecognised payload is recorded, not swallowed");
    },
  }),

  defineCase({
    id: "S1-08",
    stage: 1,
    clause: "4.1.1",
    tier: "deterministic",
    name: "a moment gets a human reference the moment it is created",
    async run({ db, assert, seen }) {
      const moment = seen("moment", await makeMoment(db));
      // Josh refers to M-000012 in a message; the system has to mean the same thing by it.
      assert.match(moment.ref, /^M-\d{6}$/, "the reference is generated, not left null");
    },
  }),

  defineCase({
    id: "S1-09",
    stage: 1,
    clause: "10",
    tier: "deterministic",
    name: "an image with no vision-capable provider is deferred, not lost",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const visual = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/visual.ts", import.meta.url),
        "utf8",
      );
      const select = fs.readFileSync(
        new URL("../../../supabase/functions/worker-select/index.ts", import.meta.url),
        "utf8",
      );
      seen("visual path", { visual: visual.length, select: select.length });

      // The failure this replaced: the rebuild was asked to redraw a picture it had never been
      // shown, and failed schema validation five times reaching a conclusion knowable in advance.
      assert.match(visual, /canSeeImages/, "the handler asks whether the provider can see images");
      assert.match(visual, /visual_pending/, "and records the deferral against the moment");
      assert.match(select, /resumeDeferredVisuals/, "and the selector sweeps deferred visuals back in");
    },
  }),

  defineCase({
    id: "S1-10",
    stage: 1,
    clause: "4.1",
    tier: "deterministic",
    name: "courtesy is not a moment",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/telegram-webhook/index.ts", import.meta.url),
        "utf8",
      );
      seen("telegram-webhook", { chars: source.length });
      // "thanks" and "ok" should not each become an entry in the bank Josh has to triage later.
      assert.match(source, /isChatter/, "a chatter filter exists on the real webhook");
    },
  }),
];
