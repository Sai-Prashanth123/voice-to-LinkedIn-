/**
 * continue_post, EXECUTED — because it would have thrown on its own main path.
 *
 * WHY THIS FILE EXISTS
 *
 * `resembles-wired.test.mjs` asserts the route is wired and `material.test.ts` executes the server
 * half. Neither runs the tool, and running the tool is what matters here, because the first version
 * of this handler called `get_extraction_brief` without `redo`.
 *
 * That brief REFUSES a moment whose status is in WRITTEN_UP — mined, queued, drafted, gated,
 * scheduled, published — and a continuation is nearly always of a moment that has already been
 * drafted, because "actually, make it about X" arrives after he has read something. So the one
 * route built to end the duplicate-idea defect would have failed in exactly the situation it exists
 * for, and the only way forward would have been `start_post`: the defect, restored, by the fix.
 *
 * It was caught by reading the refusal rather than by running it, which is luck and not a method.
 * This runs it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tools } from "./tools/index.mjs";
import { WRITTEN_UP } from "../supabase/functions/_shared/extraction.ts";

const continuePost = tools.find((t) => t.name === "continue_post");
const brief = tools.find((t) => t.name === "get_extraction_brief");
assert.ok(continuePost, "continue_post is not registered");
assert.ok(brief, "get_extraction_brief is not registered");

/**
 * Drive the handler with the two outside edges held still: the write door, and the brief.
 *
 * Both are replaced rather than reached. What is being tested is which arguments this handler
 * sends, and a test that needed the live project could not run at all — clause 6.3 means a row it
 * filed could never be removed.
 */
async function run(status, { text = "Actually, make it about timing." } = {}) {
  const sent = [];
  const briefCalls = [];

  const realFetch = globalThis.fetch;
  const realBriefHandler = brief.handler;

  globalThis.fetch = (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return Promise.resolve(new Response(
      JSON.stringify({
        ok: true,
        appended: true,
        moment_id: 158,
        name: "TAM SAM SOM",
        status,
        inputs_now: 3,
      }),
      { headers: { "content-type": "application/json" } },
    ));
  };
  brief.handler = (args) => {
    briefCalls.push(args);
    return Promise.resolve({ material: "stub brief", moment_id: args.moment_id });
  };

  try {
    const out = await continuePost.handler(
      { moment_id: 158, text },
      { url: "https://example.test", key: "test-key", db: null },
    );
    return { out, sent, briefCalls };
  } finally {
    globalThis.fetch = realFetch;
    brief.handler = realBriefHandler;
  }
}

test("a moment already written up gets redo, so the brief does not refuse it", async () => {
  // This is the path that was broken. `drafted` is the commonest status a continuation lands on.
  for (const status of WRITTEN_UP) {
    const { briefCalls } = await run(status);
    assert.equal(briefCalls.length, 1, `no brief was fetched for status "${status}"`);
    assert.equal(
      briefCalls[0].redo,
      true,
      `status "${status}" is written up and redo was not passed — get_extraction_brief refuses ` +
        `this, so continue_post would throw and the caller's only way on would be start_post`,
    );
  }
});

test("a moment still at captured is not given redo, because it has nothing to redo", async () => {
  // Passing it anyway would work, but it would mean "re-extract" on an idea never extracted, and
  // the parameter's own description says it is only for an idea Josh asked to be written up again.
  const { briefCalls } = await run("captured");
  assert.equal(briefCalls.length, 1);
  assert.equal(briefCalls[0].redo, undefined, "a never-extracted idea was told to redo");
});

test("it posts to the write door with the moment id, which is what makes it an append", async () => {
  const { sent } = await run("drafted");
  assert.equal(sent.length, 1, "it did not call cc-submit");
  assert.match(sent[0].url, /\/functions\/v1\/cc-submit$/);
  assert.equal(sent[0].body.kind, "capture");
  // Without moment_id this is start_post: a new idea. With it, cc-submit appends.
  assert.equal(sent[0].body.moment_id, 158, "the moment id did not travel, so a new idea is made");
  assert.equal(sent[0].body.text, "Actually, make it about timing.");
});

test("his words go to the door untidied", async () => {
  // Every claim in the finished post is checked span by span against this text.
  const messy = "  scrap that — it's about WHO is in pain   \n\n right now  ";
  const { sent } = await run("drafted", { text: messy });
  assert.equal(sent[0].body.text, messy, "the tool tidied his words before storing them");
});

test("the reply tells the caller to redo, and not to call start_post", async () => {
  // The next step has to be in the reply: a session that re-extracts without redo gets a 409, and
  // a session that reaches for start_post recreates the defect.
  const { out } = await run("drafted");
  assert.equal(out.appended, true);
  assert.equal(out.inputs_now, 3);
  assert.match(out.then, /redo: true/);
  assert.match(out.how.join(" "), /everything he has said|all of it/i);

  const captured = await run("captured");
  assert.ok(!/redo/.test(captured.out.then), "a never-extracted idea was told to redo");
});

test("a refusal from the write door is raised, not swallowed into a success", async () => {
  // A parked, killed or published idea is refused by cc-submit with a reason worth reading. A
  // handler that dropped it would report an append that never happened.
  const realFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(
      JSON.stringify({ error: 'That idea is parked: "SaaS bubble". Call reopen_idea first.' }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));
  try {
    await assert.rejects(
      () => continuePost.handler({ moment_id: 158, text: "more" }, {
        url: "https://example.test",
        key: "test-key",
        db: null,
      }),
      /parked/,
      "a 409 from the write door did not reach the caller",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
