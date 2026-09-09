/**
 * The only thing between 24 tools and the internet.
 *
 * Over stdio there was no auth question at all — the server ran as a child process of the person
 * who started it. These tests exist because that stopped being true the moment there was a URL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { authorise, refuseWrite, toolsForScope, WRITE_TOOLS } from "./auth.mjs";
import { tools } from "./tools/index.mjs";
import { writeTools } from "./tools/write.mjs";
import { visualTools } from "./tools/visual.mjs";
import { sessionTools } from "./tools/sessions.mjs";

const ENV = { MCP_READ_TOKEN: "read-token-aaaaaaaaaaaaaaaa", MCP_WRITE_TOKEN: "write-token-bbbbbbbbbbbbbbb" };

test("no tokens configured refuses everything, rather than accepting everything", () => {
  // FAILS CLOSED. The inverse of this is the exact bug the desk's own middleware had for months:
  // an unset allowlist made the condition short-circuit and let every signed-in user through.
  const r = authorise("Bearer read-token-aaaaaaaaaaaaaaaa", {});
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test("a missing or malformed header is refused", () => {
  for (const header of [undefined, "", "Bearer", "Basic abc", "   "]) {
    const r = authorise(header, ENV);
    assert.equal(r.ok, false, `"${header}" was accepted`);
    assert.equal(r.status, 401);
  }
});

test("a wrong token is refused, and does not throw", () => {
  // It threw in the deployed function, because auth.mjs used the `Buffer` global that Deno does
  // not have — so "not recognised" arrived as an opaque 500. Caught by probing the live endpoint.
  const r = authorise("Bearer wrong-token-cccccccccccccccc", ENV);
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.match(r.error, /not recognised/);
});

test("a token of a different length is refused rather than crashing", () => {
  // timingSafeEqual throws on a length mismatch, so the length is compared first. Token length is
  // not a secret; the contents are.
  assert.equal(authorise("Bearer short", ENV).ok, false);
  assert.equal(authorise(`Bearer ${"x".repeat(500)}`, ENV).ok, false);
});

test("each token resolves to its own scope", () => {
  assert.deepEqual(authorise("Bearer read-token-aaaaaaaaaaaaaaaa", ENV), { ok: true, scope: "read" });
  assert.deepEqual(authorise("Bearer write-token-bbbbbbbbbbbbbbb", ENV), { ok: true, scope: "write" });
});

test("the Bearer prefix is optional and case-insensitive", () => {
  assert.equal(authorise("read-token-aaaaaaaaaaaaaaaa", ENV).scope, "read");
  assert.equal(authorise("bearer read-token-aaaaaaaaaaaaaaaa", ENV).scope, "read");
});

test("a read token cannot reach a single tool that changes anything", () => {
  const allowed = toolsForScope(tools, "read").map((t) => t.name);
  for (const name of WRITE_TOOLS) {
    assert.ok(!allowed.includes(name), `${name} is reachable on a read token`);
  }
  assert.ok(allowed.length > 0, "a read token reaches nothing at all");
});

test("a write token reaches everything", () => {
  assert.equal(toolsForScope(tools, "write").length, tools.length);
});

test("everything in the write module is treated as a write", () => {
  // THE TEST THAT MATTERS MOST HERE. WRITE_TOOLS is hand-maintained, and a new write tool added
  // without touching it would be silently reachable on a read token — invisible until somebody
  // noticed a draft they had not authorised.
  //
  // write.mjs is the one module whose entire purpose is writing, so this is structural rather than
  // a restatement of the list.
  for (const t of writeTools) {
    assert.ok(
      WRITE_TOOLS.has(t.name),
      `${t.name} is in write.mjs but not WRITE_TOOLS, so a read token can call it`,
    );
  }
});

test("a write anywhere else is caught by what it is called", () => {
  // visual.mjs and sessions.mjs each hold BOTH kinds — get_visual_brief reads, create_visual
  // writes — so module membership proves nothing there. This is deliberately a heuristic on the
  // verb, because it catches the realistic case: somebody adds create_/submit_/record_ to a module
  // that already has reads in it, and does not think about the token scope.
  //
  // It is not proof. It is the cheapest thing that would have caught the mistake.
  const WRITE_VERBS = /^(create|submit|record|propose|update|delete|approve|publish|scan)_/;

  for (const t of [...visualTools, ...sessionTools, ...tools]) {
    if (!WRITE_VERBS.test(t.name)) continue;
    assert.ok(
      WRITE_TOOLS.has(t.name),
      `${t.name} is named like a write but is not in WRITE_TOOLS, so a read token can call it`,
    );
  }
});

test("nothing in WRITE_TOOLS has been renamed out of existence", () => {
  // The other direction: a name in the list that no longer matches a real tool is dead weight, and
  // dead weight in an access list is how somebody later concludes the list is decorative.
  const names = new Set(tools.map((t) => t.name));
  for (const name of WRITE_TOOLS) {
    assert.ok(names.has(name), `WRITE_TOOLS names "${name}", which is not a registered tool`);
  }
});

test("refusing a write says why, rather than hiding the tool", () => {
  // A model told "that tool does not exist" tries to achieve the same thing another way. Told it
  // is on a read token, it stops and says so.
  const err = refuseWrite("create_draft");
  assert.match(err.message, /read only/i);
  assert.match(err.message, /Nothing was written/);
});
