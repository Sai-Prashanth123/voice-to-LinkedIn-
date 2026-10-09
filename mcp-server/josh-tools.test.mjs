/**
 * The decision tools, and the two ways they can be wrong without anything failing.
 *
 * These seventeen tools are how Josh approves a post, holds one, asks for a rewrite, clears a name,
 * decides a library proposal, parks, reopens, and records what came back. They were Telegram buttons
 * until 9 October 2026.
 *
 * Two failure modes are silent and both are checked here:
 *
 *   A tool missing from WRITE_TOOLS is reachable on the READ token — so a read-only client could
 *   authorise a post for publication. Nothing errors; it simply works when it should not.
 *
 *   A tool writing directly to Postgres instead of posting to cc-submit appears to work today,
 *   because the hosted connector falls back to the service role when its scoped key is absent. It
 *   starts failing the day that key is minted, by which time the tool has shipped.
 *
 * Neither is caught by using the tools, which is why they are caught here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { joshTools, joshToolNames } from "./tools/josh.mjs";
import { tools, assertUniqueNames } from "./tools/index.mjs";
import { WRITE_TOOLS, toolsForScope } from "./auth.mjs";

test("every decision tool is registered, once", () => {
  assertUniqueNames();
  for (const name of joshToolNames) {
    assert.ok(tools.some((t) => t.name === name), `${name} is not in the registry`);
  }
});

test("no decision tool is reachable on a read token", () => {
  const readable = toolsForScope(tools, "read").map((t) => t.name);

  for (const name of joshToolNames) {
    assert.ok(WRITE_TOOLS.has(name), `${name} is missing from WRITE_TOOLS`);
    assert.ok(
      !readable.includes(name),
      `${name} is callable with a read token — a read-only client could use it`,
    );
  }

  // And the write token does see them, or the whole re-scope is inert.
  const writable = toolsForScope(tools, "write").map((t) => t.name);
  for (const name of joshToolNames) {
    assert.ok(writable.includes(name), `${name} is not reachable even with a write token`);
  }
});

test("every decision goes through the single write door", () => {
  const source = readFileSync(new URL("./tools/josh.mjs", import.meta.url), "utf8");

  // One `post()` helper, and it targets cc-submit.
  assert.match(source, /functions\/v1\/cc-submit/);

  // Nothing reaches the database itself. `db.from(...)` in here would bypass the validation and the
  // admin client that cc-submit holds, and would be writing with whichever key the connector had.
  assert.ok(!/\bdb\.from\(/.test(source), "a decision tool writes to Postgres directly");
  assert.ok(!/createClient/.test(source), "a decision tool builds its own database client");

  // Every handler is a call to post(), so none of them can quietly do something else.
  for (const tool of joshTools) {
    assert.equal(typeof tool.handler, "function", `${tool.name} has no handler`);
  }
});

test("the one that authorises publishing says so unmistakably", () => {
  const markReady = joshTools.find((t) => t.name === "mark_ready");
  assert.ok(markReady, "mark_ready is gone");

  const description = markReady.config.description;
  // A model picks this tool from its description. If it does not know this is the publish
  // authorisation, it will treat it as bookkeeping.
  assert.match(description, /ONLY THING THAT AUTHORISES/);
  assert.match(description, /LinkedIn/);
  assert.match(description, /date/);

  // And it must take a date. An approval with no date cannot be what 11.2 means, and the database
  // refuses `scheduled` without `scheduled_for` anyway.
  assert.ok("when" in markReady.config.inputSchema, "mark_ready takes no date");
});

test("a kill demands a reason and a park does not", () => {
  const kill = joshTools.find((t) => t.name === "kill_idea");
  const park = joshTools.find((t) => t.name === "park_idea");

  // Killing excludes an idea from everything that selects, scores and learns. That exclusion is
  // invisible later, so the reason is the only thing that makes it readable.
  assert.ok(kill.config.inputSchema.reason, "kill_idea has no reason field");
  assert.match(kill.config.description, /reason is required/i);

  // Parking is "not yet" and should cost nothing to do.
  assert.ok(park.config.inputSchema.reason.isOptional?.() ?? true, "park_idea demands a reason");
});

test("the tools a person would reach for by name all exist", () => {
  // Written as the things Josh says, because that is how the model finds them.
  const expected = [
    "mark_ready", // "put it out Tuesday"
    "hold_post", // "actually, hold that"
    "edit_post", // "change the opening line to this"
    "push_back_on_draft", // "that is not what happened"
    "clear_names", // "Ben is fine to name"
    "park_idea", // "not yet"
    "kill_idea", // "no, not that one"
    "reopen_idea", // "I remembered more about that"
    "set_pillar", // "that is craft, not career"
    "skip_question", // "ask me something else"
    "end_interview", // "that is enough, write it"
    "decide_proposal", // "yes, apply that"
    "add_library_rule", // "never open with a question"
    "append_voice_transcript", // "here is a transcript of me talking"
    "record_post_verdict", // "that one landed"
    "record_conversation", // "it got me a call"
    "mark_notices_read",
    // Running the machinery, rather than waiting for its schedule.
    "run_worker", // "why has nothing been chosen"
    "refresh_sentinels", // "have their habits changed"
    "export_bank", // "give me my data"
  ];

  assert.deepEqual([...joshToolNames].sort(), [...expected].sort());
});
