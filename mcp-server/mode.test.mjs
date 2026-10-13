/**
 * The writing mode, and the one place it was read by the code but not by the advice.
 *
 * Josh asked on 13 October 2026 to stop being interviewed and to stop having old ideas pulled out
 * of the bank. Three mechanisms were changed to obey him — capture, the selection worker and
 * next_work — and `next_action` was not. That tool is the second call of every session by
 * CLAUDE.md's own instruction, and it answered "answer the interview on 1 candidate" for as long
 * as a candidate existed. A session that followed its own start-here instructions would have put
 * the complaint straight back to him, with every mechanism underneath working perfectly.
 *
 * So this file tests the advice, not the mechanism: that in one_step mode nothing next_action says
 * sends the session into the idea bank, that the ideas are still counted so none of them look
 * deleted, and that turning the mode off brings the interview advice back unchanged. The last one
 * matters most — "for the time being" is what he actually said.
 *
 * Offline by construction: the db is a stub, so this runs in CI with no credentials.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// The registry first: onestep.mjs imports it to reuse the other tools' handlers, and it imports
// onestep.mjs back, so importing onestep on its own hits the cycle mid-evaluation. The registry is
// also the honest way to reach a tool — it is how the server reaches it.
import { tools } from "./tools/index.mjs";
import { inspectTools } from "./tools/inspect.mjs";
import { modeName, ONE_STEP_MODE } from "./mode.mjs";

const nextAction = inspectTools.find((t) => t.name === "next_action");

/** A project with one of everything the idea bank can hold, and one draft waiting on Josh. */
function stub({ oneStep }) {
  return {
    async request(path) {
      if (path.includes("status=eq.mined")) return [{ id: 70 }];
      if (path.includes("status=eq.half_mined")) return [{ id: 71, title: "half answered" }];
      if (path.includes("status=eq.captured")) return [{ id: 89, title: "Champion mover" }];
      if (path.startsWith("/drafts") || path.includes("drafts?")) return [{ id: 63 }];
      if (path.includes("posts?")) return [{ id: 16 }];
      if (path.includes("library_proposals")) return [{ id: 9 }];
      throw new Error(`unexpected read: ${path}`);
    },
    async select(table, opts) {
      assert.equal(table, "settings");
      assert.equal(opts.key, `eq.${ONE_STEP_MODE}`);
      return [{ value: oneStep }];
    },
  };
}

const every = (result) => [result.next, ...result.then];

test("in one_step mode nothing it says sends the session into the idea bank", async () => {
  const result = await nextAction.handler({}, { db: stub({ oneStep: true }) });

  assert.equal(result.mode, "one_step");

  const said = JSON.stringify(every(result));
  for (const forbidden of ["next_interview_question", "answer_interview", "next_work"]) {
    assert.ok(!said.includes(forbidden), `one_step mode still points at ${forbidden}`);
  }
  // "Answer the interview on 1 candidate" was the exact wording that would have reached him.
  assert.ok(!/Answer the interview/i.test(said));
  assert.ok(!/Draft 1 mined moment/i.test(said));

  // Still the most useful thing: the draft he has not judged.
  assert.match(result.next.do, /Review 1 post/);
  // And a library decision is his either way — it is not an idea-bank action.
  assert.ok(every(result).some((a) => /library proposal/.test(a.do)));
});

test("the held ideas are still counted, so nothing looks deleted", async () => {
  const result = await nextAction.handler({}, { db: stub({ oneStep: true }) });

  assert.deepEqual(result.counts, {
    ready_to_draft: 1,
    awaiting_interview: 1,
    just_arrived: 1,
    drafts_waiting_on_josh: 1,
    open_proposals: 1,
    drafts_total: 1,
  });

  // And it says so in words, once, as a fact rather than a task.
  const note = every(result).find((a) => /held in the bank/.test(a.do));
  assert.ok(note, "one_step mode never mentions that the ideas are kept");
  assert.equal(note.do, "3 idea(s) are held in the bank and nothing will be drafted from them");
  assert.match(note.where, /do not start an interview/);
  assert.match(note.why, /set_writing_mode/);
});

test("with the mode off the interview advice comes back, unchanged", async () => {
  const result = await nextAction.handler({}, { db: stub({ oneStep: false }) });

  assert.equal(result.mode, "interviewed");

  const said = JSON.stringify(every(result));
  assert.ok(said.includes("next_interview_question"));
  assert.ok(said.includes("next_work"));
  assert.match(said, /Answer the interview on 1 candidate/);
  // The one_step note is a one_step thing and must not leak into the other mode.
  assert.ok(!/held in the bank/.test(said));
});

test("the two runtimes spell the mode the same way", () => {
  assert.equal(modeName(true), "one_step");
  assert.equal(modeName(false), "interviewed");
  assert.equal(ONE_STEP_MODE, "one_step_mode");
});

/*
 * And the third route to the same silence, which is not about advice but about composition.
 *
 * A thin paste parks itself in applyExtraction, correctly. get_drafting_brief does not refuse a
 * parked moment, only a killed one. list_calendar withholds drafts sitting on parked ideas from
 * his review, also correctly. Composed, those three gave him a post written from material the
 * system had already judged too thin, and then hid it from him — he pastes something and nothing
 * comes back, which is the sentence he wrote in to complain about.
 */
test("a parked paste stops the chain and comes back as a sentence, not a silence", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      name: "a thin one",
      status: "parked",
      note: "Applied, and the moment parked itself: There is a moment here but nothing you took " +
        "from it yet. It reopens the moment he adds to it.",
      uncleared_names: [],
    }),
  });

  try {
    const writePost = tools.find((t) => t.name === "write_post");

    // This db answers the settings read and throws on anything else, so reaching the drafting
    // brief — which reads the library, the material and the names — fails the test by itself.
    const db = {
      async select(table) {
        assert.equal(table, "settings", "write_post read a table after a park");
        return [{ value: true }];
      },
      async request(path) {
        throw new Error(`write_post kept going after a park and read ${path}`);
      },
    };

    const result = await writePost.handler(
      { moment_id: 99, extracted: { the_moment: "something happened" } },
      { db, url: "https://example.supabase.co", key: "test" },
    );

    assert.equal(result.wrote_nothing, true);
    assert.equal(result.drafting_brief, undefined, "it returned a brief for a parked idea");
    assert.match(result.why, /parked itself/);
    assert.match(result.tell_him, /not enough in it/);
    assert.match(result.to_continue, /Nothing is lost/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
