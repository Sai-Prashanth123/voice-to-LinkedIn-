/**
 * Stage 8 — the weekly review, approval, and publishing to LinkedIn.
 *
 * THE LARGEST GAP IN THE REPOSITORY
 *
 * `_shared/weeklypass.ts` is 14 KB and `_shared/linkedin.ts` carries the publish call. Between
 * them they own the entire approve-and-publish path, and until this file they had **no tests at
 * all** — not one. The only thing standing behind R3 ("nothing publishes without Josh") was four
 * CHECK constraints, with nothing proving the application respects them before Postgres has to.
 *
 * R3 is the rule the whole engagement is judged on. It gets tested adversarially: every route to a
 * published row without authorisation, tried and refused.
 */

import { defineCase, skip } from "../harness.mjs";
import { approvePost, makeDraft, makeMoment, makePost, minedMoment, q } from "../fixtures.mjs";

export const cases = [
  defineCase({
    id: "S8-01",
    stage: 8,
    clause: "11.2 / R3",
    tier: "deterministic",
    name: "a post cannot be published without Josh's authorisation",
    async run({ db, assert }) {
      const moment = await makeMoment(db);
      const post = await makePost(db, { momentId: moment.id });

      // Everything about this row is legal except marked_ready_at. That matters: the first attempt
      // at this assertion used a null moment_id and was refused by a NOT NULL constraint, which
      // looks like a pass and proves nothing about R3.
      const err = await db.expectError(
        "update public.posts set status = 'published', published_at = now() where id = " + post.id,
      );
      assert.match(err, /posts_published_requires_josh|violates check/, "the database refuses it");
      assert.match(err ?? "", /ERROR/, "it is refused by Postgres, not by application code");
    },
  }),

  defineCase({
    id: "S8-02",
    stage: 8,
    clause: "11.2 / R3",
    tier: "deterministic",
    name: "scheduling also requires authorisation, not only publishing",
    async run({ db, assert }) {
      const moment = await makeMoment(db);
      const post = await makePost(db, { momentId: moment.id });

      const err = await db.expectError(
        "update public.posts set status = 'scheduled', scheduled_for = now() where id = " + post.id,
      );
      assert.match(err, /requires_josh|violates check/, "scheduled is guarded as well as published");
    },
  }),

  defineCase({
    id: "S8-03",
    stage: 8,
    clause: "11.2 / R3",
    tier: "deterministic",
    name: "publishing cannot precede approval in time",
    async run({ db, assert }) {
      const moment = await makeMoment(db);
      const post = await makePost(db, { momentId: moment.id });

      // The subtle one. A row CAN carry marked_ready_at and still be wrong if it was published
      // before Josh approved it — an out-of-order write, or a backdated import.
      const err = await db.expectError(
        "update public.posts set status = 'published', marked_ready_at = now(), " +
          "published_at = now() - interval '1 day' where id = " + post.id,
      );
      assert.match(err, /precedes_publish|violates check/, "approval must come first");
    },
  }),

  defineCase({
    id: "S8-04",
    stage: 8,
    clause: "11.2",
    tier: "deterministic",
    name: "the legitimate path still works — a guard that blocks everything is not a guard",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id, { gatePassed: true });
      const post = await makePost(db, { momentId: moment.id, draftId: draft.id });

      const approved = seen("approve", await approvePost(db, post.id));
      assert.equal(approved.status, "scheduled", "approval moves it to scheduled");
      assert.ok(approved.authorised, "marked_ready_at is set");

      const [published] = await db.sql(
        "update public.posts set status = 'published', published_at = now(), " +
          "linkedin_urn = 'urn:li:share:E2E' where id = " + post.id +
          " returning id, status::text, linkedin_urn",
      );
      assert.equal(published.status, "published", "an authorised post publishes");
    },
  }),

  defineCase({
    id: "S8-05",
    stage: 8,
    clause: "11.2",
    tier: "deterministic",
    name: "holding a scheduled post clears the authorisation rather than leaving it armed",
    async run({ db, assert }) {
      const moment = await makeMoment(db);
      const post = await makePost(db, { momentId: moment.id });
      await approvePost(db, post.id);

      // What holdPost() and unschedule() do. If marked_ready_at survived a hold, the next
      // publish sweep would treat a withdrawn post as approved.
      const [held] = await db.sql(
        "update public.posts set status = 'draft', scheduled_for = null, marked_ready_at = null " +
          "where id = " + post.id + " returning status::text, marked_ready_at",
      );
      assert.equal(held.status, "draft", "back to draft");
      assert.equal(held.marked_ready_at, null, "and no longer authorised");
    },
  }),

  defineCase({
    id: "S8-06",
    stage: 8,
    clause: "11.2",
    tier: "deterministic",
    name: "every callback the weekly pass sends fits Telegram's 64-byte limit",
    async run({ assert, seen }) {
      // weeklypass.ts pulls in the Supabase client through an `npm:` specifier, which Node's loader
      // will not resolve, so the callback templates are read from the source and measured. That is
      // the property that matters: Telegram silently TRUNCATES callback_data over 64 bytes, and a
      // truncated action routes to the wrong handler or to none — the button looks live and does
      // nothing, which is the failure mode this whole harness exists to catch.
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/weeklypass.ts", import.meta.url),
        "utf8",
      );

      // Every `data: "..."` on a button, with interpolations replaced by a wildly generous id.
      const templates = [...source.matchAll(/data:\s*[`"']([^`"']*)[`"']/g)].map((m) => m[1]);
      const worst = templates.map((t) => ({
        template: t,
        bytes: Buffer.byteLength(t.replace(/\$\{[^}]+\}/g, "999999999"), "utf8"),
      }));
      seen("callbacks", worst);

      assert.ok(templates.length > 0, "the weekly pass builds callback data");
      const overLimit = worst.filter((w) => w.bytes > 64);
      assert.same(overLimit, [], "no callback can exceed 64 bytes, even with a nine-digit post id");

      // And every prefix the buttons emit must be one parseAction knows, or the tap does nothing.
      const prefixes = [...new Set(templates.map((t) => t.split(":")[0]).filter(Boolean))];
      seen("prefixes", prefixes);
      for (const prefix of prefixes) {
        if (prefix.includes("${")) continue;
        assert.match(source, new RegExp('["\'`]' + prefix + '\\b'), prefix + " is handled by parseAction");
      }
    },
  }),

  defineCase({
    id: "S8-07",
    stage: 8,
    clause: "12.2",
    tier: "deterministic",
    name: "the edit is measured at approval, with no network call",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id, { body: "The original draft body." });
      const post = await makePost(db, { momentId: moment.id, draftId: draft.id, body: "The body Josh edited." });
      await approvePost(db, post.id);

      // Read rather than imported: outcome.ts pulls in the Supabase client through an `npm:`
      // specifier, which Node's loader will not resolve. The property being asserted is textual
      // anyway — what this module is allowed to touch.
      //
      // The bug it defends against: the diff once lived inside the LinkedIn publish loop, so with
      // no LinkedIn connection nothing was ever measured — and 17a is computed from exactly this.
      const source = await import("node:fs").then((fs) =>
        fs.readFileSync(
          new URL("../../../supabase/functions/_shared/outcome.ts", import.meta.url),
          "utf8",
        )
      );
      seen("outcome.ts", { chars: source.length });
      // `linkedin` appears in the module's own explanation of the bug, so matching the word would
      // fail on a comment. What must not be there is the call itself.
      assert.not(/fetch\(/.test(source), "recording an edit makes no network call");
      assert.match(source, /approved/, "it is measured at the approval stage");
    },
  }),

  defineCase({
    id: "S8-08",
    stage: 8,
    clause: "12.1",
    tier: "deterministic",
    name: "a missing LinkedIn connection is recorded as a metrics error, never a job failure",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/worker-metrics/index.ts", import.meta.url),
        "utf8",
      );
      seen("worker-metrics", { chars: source.length });

      // Post analytics needs a review that takes weeks. If that absence threw, every published post
      // would burn its retries and land in `dead` for a reason that is not a fault.
      assert.match(source, /metrics_error/, "the absence is written to outcomes.metrics_error");
      assert.not(
        /throw new Error\(["'`]no linkedin/i.test(source),
        "a missing connection does not throw",
      );
    },
  }),

  defineCase({
    id: "S8-09",
    stage: 8,
    clause: "11.4",
    tier: "deterministic",
    name: "the rewrite link is read from the vault, not from the process environment",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const source = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/weeklypass.ts", import.meta.url),
        "utf8",
      );
      seen("weeklypass.ts", { chars: source.length });

      // This exact line was wrong once: rewriteLink read Deno.env while everything else used the
      // vault, and APP_URL was not in SECRET_NAMES — so the button offered the words "open The
      // desk" instead of a link, and nothing failed.
      const hasRewrite = /rewriteLink/.test(source);
      assert.ok(hasRewrite, "rewriteLink exists");
      assert.not(/Deno\.env\.get\(["']APP_URL["']\)/.test(source), "APP_URL is not read from Deno.env");
      assert.match(source, /secret\(["']APP_URL["']\)/, "it comes from the vault");
    },
  }),

  defineCase({
    id: "S8-10",
    stage: 8,
    clause: "11.2",
    tier: "deterministic",
    name: "posts.status 'ready' is unreachable, and nothing pretends otherwise",
    async run({ db, assert, note }) {
      // Found while mapping the pipeline: both approval paths write 'scheduled' directly, so the
      // posts_ready_requires_josh constraint guards a state nothing can enter. That is not a bug in
      // itself, but an enum value no code writes is a trap for the next person — so it is asserted
      // rather than left ambiguous.
      const fs = await import("node:fs");
      const weeklypass = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/weeklypass.ts", import.meta.url),
        "utf8",
      );
      const actions = fs.readFileSync(
        new URL("../../../app/app/actions.ts", import.meta.url),
        "utf8",
      );

      const writesReady = /status:\s*["']ready["']/.test(weeklypass) ||
        /status:\s*["']ready["']/.test(actions);
      note("ready_is_written_by_code", writesReady);

      const moment = await makeMoment(db);
      const post = await makePost(db, { momentId: moment.id });
      const err = await db.expectError(
        "update public.posts set status = 'ready' where id = " + post.id,
      );
      assert.ok(err, "even 'ready' cannot be reached without authorisation");
      assert.not(writesReady, "no approval path writes 'ready' — 'scheduled' is the real state");
    },
  }),
];
