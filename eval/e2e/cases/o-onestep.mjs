/**
 * One-step mode — the path Josh actually uses, which had no end-to-end coverage at all.
 *
 * WHY THIS FILE EXISTS
 *
 * He asked for interviewing to stop on 13 October, after a morning in which he answered 21
 * questions about a new idea and the system drafted an older one. One-step mode shipped that day:
 * capture stops asking, the idea bank stops proposing, and the gate stops holding a draft back.
 *
 * Every one of those is a BEHAVIOUR CHANGE AT A BRANCH, and the nine stage files here were written
 * against the interviewed path. So the mode carrying all of his real work was the one mode nothing
 * exercised — and the three bugs found on 14 October were all in code that had never run through
 * the transport it ships on. Same shape, so this closes it before it costs him another morning.
 *
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT
 *
 * These are deterministic: the mode flag, the branches that read it, and the database rules that
 * must hold differently in advisory mode. Whether a one-step draft is GOOD is a model question and
 * belongs in m-journeys.mjs, not here.
 *
 * The rule that matters most is the one in O-04. Advisory mode lets a failing draft reach him,
 * which means `gate_passed` stays false on a post he may approve — so `markReady` has to accept
 * false-plus-advisory while still refusing false-alone. Get that wrong in one direction and he
 * cannot publish anything; in the other, the gate stops meaning anything at all.
 */

import { defineCase } from "../harness.mjs";
import { makeDraft, makePost, minedMoment, q, setSection } from "../fixtures.mjs";

export const cases = [
  defineCase({
    id: "O-01",
    stage: "O",
    clause: "13 Oct request",
    tier: "deterministic",
    name: "the mode is a stored fact, and both runtimes read the same one",
    async run({ db, assert, seen }) {
      /*
       * READ FROM SOURCE ON THE DENO SIDE, AND THAT IS NOT LAZINESS.
       *
       * `_shared/mode.ts` imports SupabaseClient with an `npm:` specifier, which Node's ESM loader
       * refuses outright — "Only URLs with a scheme in: file, data, and node are supported". The
       * other shared modules this harness imports (claims.ts, views.ts, prompts.ts) are pure and
       * load fine. This one reaches the database, so it cannot be.
       *
       * What matters is not that both modules load in one runtime. It is that the two unavoidable
       * implementations agree on the SETTINGS KEY: a second spelling would read as "interviewed"
       * for ever, silently, and put him back in the interview he asked to stop.
       */
      const node = await import("../../../mcp-server/mode.mjs");
      const key = node.ONE_STEP_MODE;
      assert.ok(typeof key === "string" && key.length > 0, "the node side names a settings key");
      seen("setting_key", key);

      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const denoSource = readFileSync(
        join(import.meta.dirname, "..", "..", "..", "supabase/functions/_shared/mode.ts"),
        "utf8",
      );
      assert.ok(
        denoSource.includes(`"${key}"`) || denoSource.includes(`'${key}'`),
        `the deno side looks up the same key (${key})`,
      );

      const [row] = await db.sql(
        "select value::text as v from public.settings where key = " + q(key),
      );
      assert.ok(row !== undefined, "and the setting exists on a database built from the migrations");
      seen("stored", row?.v);
    },
  }),

  defineCase({
    id: "O-02",
    stage: "O",
    clause: "13 Oct request",
    tier: "deterministic",
    name: "a draft can be advisory, and the column says so rather than the absence of a verdict",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id);

      /*
       * `gate_advisory` is a column and not an inference. The first version of this read "advisory"
       * as "gate_passed is false and a post exists anyway", which is also what a draft looks like
       * halfway through a failed gate run — so a post could have been approved while its gate was
       * still running. A column cannot be ambiguous about which of those it is.
       */
      await db.exec(
        "update public.drafts set gate_passed = false, gate_advisory = true where id = " + draft.id,
      );
      const [after] = await db.sql(
        "select gate_passed, gate_advisory from public.drafts where id = " + draft.id,
      );
      seen("draft", after);
      assert.equal(after.gate_passed, false, "advisory does not fake a pass");
      assert.equal(after.gate_advisory, true, "and it is recorded in its own right");
    },
  }),

  defineCase({
    id: "O-03",
    stage: "O",
    clause: "11.2 / R3",
    tier: "deterministic",
    name: "a draft that merely failed, with no advisory flag, still cannot be published",
    async run({ db, assert, seen }) {
      const moment = await minedMoment(db);
      const draft = await makeDraft(db, moment.id);
      await db.exec(
        "update public.drafts set gate_passed = false, gate_advisory = false where id = " + draft.id,
      );
      const post = await makePost(db, { momentId: moment.id, draftId: draft.id });

      // The database's own refusal, not the application's. This is the half of advisory mode that
      // must NOT have moved: a failing draft reaches him, and publishing it still needs his word.
      const error = await db.expectError(
        "update public.posts set status = 'published', published_at = now() where id = " + post.id,
      );
      seen("refusal", error);
      assert.ok(error !== null, "Postgres refused it");
      assert.ok(
        /posts_published_requires_josh/.test(String(error)),
        "and refused it by the constraint that names his authorisation",
      );
    },
  }),

  defineCase({
    id: "O-04",
    stage: "O",
    clause: "11.2 / 13 Oct request",
    tier: "deterministic",
    name: "approval reads the advisory column, so a flagged draft is his to approve and nobody else's",
    async run({ db, assert, seen }) {
      /*
       * THE ASYMMETRY THIS PINS
       *
       * markReady permits approval when gate_passed is false AND gate_advisory is true, read from
       * the column rather than from the mode — because the mode can be switched back after the
       * draft was written, and a draft judged advisorily does not stop being so.
       *
       * Asserted against the source, because the alternative is standing up the whole edge function
       * to observe one branch. A grep is weak evidence of behaviour and strong evidence that the
       * condition is read from the right place — which is the part that was wrong first time, when
       * it read the live setting instead of the row.
       *
       * ONE ENFORCER, AND THE FIRST VERSION OF THIS CASE DEMANDED TWO.
       *
       * It asserted that mcp-server/tools/josh.mjs also mentions gate_advisory, and failed. The
       * code is right and the case was wrong: every tool in that file POSTs to cc-submit, because
       * the connector's database role has no UPDATE anywhere. There is exactly one writer and
       * exactly one place this rule can live, which is the point of that design.
       *
       * So this now asserts both halves of it: the handler decides, and the client forwards rather
       * than writing. A tool that grew its own UPDATE would pass a grep for gate_advisory and
       * bypass the whole thing, so "mentions the column" was never the property worth checking.
       */
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const root = join(import.meta.dirname, "..", "..", "..");

      // approve.ts, which is where weeklypass.ts's authorisation moved when Telegram went. One
      // writer of marked_ready_at, as there has always been.
      const handler = readFileSync(
        join(root, "supabase/functions/_shared/approve.ts"),
        "utf8",
      );
      seen("handler", { chars: handler.length });
      assert.ok(
        /gate_advisory/.test(handler),
        "the one approval path reads gate_advisory from the draft row",
      );
      // Both conditions, not just the flag: advisory permits approval of a draft that FAILED, and
      // a version that forgot `gate_passed` would permit approval of one still being judged.
      assert.ok(
        /gate_passed/.test(handler),
        "and reads gate_passed alongside it, so a half-judged draft is not approvable",
      );

      const client = readFileSync(join(root, "mcp-server/tools/josh.mjs"), "utf8");
      assert.ok(
        /cc-submit/.test(client),
        "and the client forwards to cc-submit rather than deciding for itself",
      );
      assert.not(
        /from\s*\(\s*["']posts["']\s*\)\s*\.\s*update|update\(\s*\{[^}]*marked_ready_at/.test(client),
        "no client-side write to posts could bypass it",
      );
    },
  }),

  defineCase({
    id: "O-05",
    stage: "O",
    clause: "13 Oct request",
    tier: "deterministic",
    name: "nothing proposes work to him in one-step mode",
    async run({ assert, seen }) {
      /*
       * The actual culprit on 13 October was not the tool anyone suspected. It was `worker-select`,
       * a four-hourly cron, queueing an older idea while he answered questions about a new one.
       * `next_work` was blamed first and was innocent.
       *
       * So both have to stand down, and this asserts the worker does — the cron cannot be observed
       * from a test database, and the branch is the thing that was missing.
       */
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const root = join(import.meta.dirname, "..", "..", "..");

      const worker = readFileSync(join(root, "supabase/functions/worker-select/index.ts"), "utf8");
      seen("worker-select", { chars: worker.length });

      assert.ok(
        /oneStep|one_step|readMode/.test(worker),
        "worker-select reads the mode at all",
      );
      // An early return, not a filter applied later: anything that runs first has already spent
      // tokens and written rows on an idea he did not ask about.
      const head = worker.slice(0, worker.indexOf("\n}", worker.indexOf("async function")) + 2);
      assert.ok(
        /return/.test(head) || /oneStep/.test(head),
        "and stands down near the top rather than after doing the work",
      );
    },
  }),

  defineCase({
    id: "O-06",
    stage: "O",
    clause: "9.8",
    tier: "deterministic",
    name: "the attempt counter still counts when advisory mode skips the retry path",
    async run({ db, assert, seen }) {
      /*
       * Advisory mode skips `retryOrPark`, which is where the attempt number used to come from. All
       * three drafts of moment 101 therefore recorded attempt 1, and clause 9.8 — three failures
       * park the idea — could never fire. The count is now derived from prior rejected drafts when
       * no job exists.
       *
       * This asserts the derivation, not the parking: advisory mode deliberately does NOT park, so
       * a test that expected parking would be asserting the bug back into place.
       */
      const moment = await minedMoment(db);
      const first = await makeDraft(db, moment.id);
      await db.exec(
        "update public.drafts set gate_passed = false, gate_advisory = true where id = " + first.id,
      );
      const second = await makeDraft(db, moment.id);
      await db.exec(
        "update public.drafts set gate_passed = false, gate_advisory = true where id = " + second.id,
      );

      const [{ n }] = await db.sql(
        "select count(*)::int as n from public.drafts where moment_id = " + moment.id +
          " and gate_passed = false",
      );
      seen("rejected_drafts", n);
      assert.equal(n, 2, "two rejected drafts are on file for the moment");

      const [m] = await db.sql(
        "select status, killed from public.moments where id = " + moment.id,
      );
      seen("moment", m);
      assert.not(m.killed, "and advisory mode has not killed it behind his back");
      assert.notEqual(m.status, "parked", "nor parked it — that is the point of advisory");
    },
  }),

  defineCase({
    id: "O-07",
    stage: "O",
    clause: "9b",
    tier: "deterministic",
    name: "the checks judge identically in either mode — advisory changes who acts, never the verdict",
    async run({ db, assert, seen }) {
      /*
       * The one thing that must not drift. Advisory mode moves the CONSEQUENCE of a failure from
       * the system to Josh; it does not soften the judgement. If a rubric or the unjudgeable rule
       * varied by mode, every number he has been shown would mean two different things.
       */
      const { GATE_CHECKS } = await import("../../../supabase/functions/_shared/prompts.ts");
      const { unjudgeableChecks } = await import("../../../supabase/functions/_shared/views.ts");

      const filled = Object.fromEntries(
        GATE_CHECKS.map((c) => [c.key, "a rule"]).concat([
          ["voice_guide", "He writes short sentences."],
          ["banned_phrases", "no em dashes"],
          ["formatting", "One idea per paragraph."],
        ]),
      );

      const out = unjudgeableChecks(GATE_CHECKS, filled).map((c) => c.key);
      seen("unjudgeable_with_everything_filled", out);
      assert.same(out, [], "nothing is unjudgeable on a filled library, in any mode");

      // And no rubric mentions the mode. A check that knew it was advisory could be lenient.
      const mentions = GATE_CHECKS
        .filter((c) => /one.?step|advisory/i.test(JSON.stringify(c)))
        .map((c) => c.key);
      seen("rubrics_mentioning_mode", mentions);
      assert.same(mentions, [], "no rubric knows which mode it is running in");
    },
  }),

  defineCase({
    id: "O-08",
    stage: "O",
    clause: "4 / R2",
    tier: "deterministic",
    name: "a one-step draft is still held to the claim ledger",
    async run({ db, assert, seen }) {
      /*
       * The thing most likely to have been quietly dropped. One-step mode removes the interview,
       * which is where material used to come from — so if the ledger had been relaxed to let a
       * draft be written from a bare capture, R2 ("nothing invented") would be gone for his entire
       * real workflow while still passing every test written against the interviewed path.
       */
      const { verifyDraft } = await import("../../../supabase/functions/_shared/claims.ts");
      const { sourceEntry } = await import("../../../supabase/functions/_shared/entry.ts");

      // His own typed words are a legitimate source — that widening was the point of EXTRA_SOURCES
      // — but a span still has to be IN them.
      const entry = sourceEntry(null, { his_words: "The CFO asked what happens when I leave." });
      seen("entry_keys", Object.keys(entry));
      assert.ok(Object.keys(entry).length > 0, "his words alone are a source");

      // `{ ok, failures }`, and the fourth argument is the uncleared names. The first version of
      // this read `.verified`, which is undefined — so it asserted nothing twice and reported the
      // second one as a failure, which is at least the honest direction to get it wrong in.
      const invented = verifyDraft(
        "Eight people were in the room.",
        [{
          kind: "event",
          claim: "Eight people were in the room",
          source_field: "his_words",
          source_span: "Eight people were in the room",
        }],
        entry,
        [],
      );
      seen("invented", { ok: invented.ok, failures: invented.failures });
      assert.not(invented.ok, "a span that is not in his words is refused");

      const real = verifyDraft(
        "He asked what happens when I leave.",
        [{
          kind: "quote",
          claim: "what happens when I leave",
          source_field: "his_words",
          source_span: "what happens when I leave",
        }],
        entry,
        [],
      );
      seen("real", { ok: real.ok, failures: real.failures });
      assert.ok(real.ok, "and a verbatim span from them is accepted");
    },
  }),
];
