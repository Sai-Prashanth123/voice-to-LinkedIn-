/**
 * Proves this is an MCP server rather than a script that happens to run.
 *
 * It speaks the real protocol over a real stdio pipe to a real child process. A test that imported
 * the tool handlers directly would pass while the transport was broken, and the transport is the
 * half that is easy to break: one stray console.log on stdout corrupts every message after it.
 *
 * Task 1.6 extends this to every tool against live data. For now it covers the handshake, the tool
 * listing, and one round trip.
 *
 *   node --test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(HERE, "index.mjs")],
    cwd: HERE,
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

test("completes the MCP handshake and reports its name", async () => {
  const { client, close } = await connect();
  try {
    assert.equal(client.getServerVersion()?.name, "content-system");
  } finally {
    await close();
  }
});

test("lists its tools, each with a description a model can act on", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 1, "at least one tool is registered");

    const names = tools.map((t) => t.name);
    assert.ok(names.includes("health"), "health is registered");
    assert.equal(new Set(names).size, names.length, "no two tools share a name");

    for (const tool of tools) {
      assert.ok(
        (tool.description ?? "").length > 30,
        `${tool.name} needs a description long enough to be useful to a model`,
      );
    }
  } finally {
    await close();
  }
});

test("health reaches the live project and reports whether the role can read", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "health", arguments: {} });
    assert.ok(!result.isError, `health failed: ${result.content?.[0]?.text}`);

    const body = JSON.parse(result.content[0].text);
    assert.equal(body.ok, true);
    assert.match(body.url, /^https:\/\/.+\.supabase\.co$/);
    assert.equal(typeof body.round_trip_ms, "number");
    // Deliberately not asserting can_read is true. Before task 1.4 the role has no grants, and
    // a test that demanded otherwise would be asserting that unfinished work is finished.
    assert.equal(typeof body.can_read, "boolean");
  } finally {
    await close();
  }
});

test("a tool that throws comes back as a readable error, not a dead connection", async () => {
  const { client, close } = await connect();
  try {
    const bad = await client.callTool({ name: "no_such_tool", arguments: {} });
    assert.equal(bad.isError, true, "an unknown tool is an error result, not a protocol failure");
    assert.match(bad.content[0].text, /not found/i);

    // The connection must survive an unknown tool — otherwise one bad call ends the session.
    const after = await client.callTool({ name: "health", arguments: {} });
    assert.ok(!after.isError, "the server still answers after a bad call");
  } finally {
    await close();
  }
});

/*
 * THE STDIO PATH, WHICH HAD NO GUARD AT ALL.
 *
 * `get_reference_posts` takes `handle`. Asked for `writer`, it used to ignore the filter and return
 * the newest posts across all eight writers — four other people, no error, no note. http.mjs has
 * refused that since yesterday by reading the raw body. stdio could not: the SDK strips unknown
 * keys against the zod shape before any handler runs, so by then the mistake is gone.
 *
 * Both halves are asserted over a real spawned server, because this is the second day running that
 * something passed `node index.mjs --check` and failed across the transport.
 */
test("stdio refuses an argument the tool does not declare", async () => {
  const { client, close } = await connect();
  try {
    const bad = await client.callTool({
      name: "get_reference_posts",
      arguments: { writer: "mattjbarker1" },
    });

    assert.equal(bad.isError, true, "stdio accepted an undeclared argument");
    assert.match(bad.content[0].text, /no argument "writer"/);
    // It names the right parameter, because that is the next thing the caller needs.
    assert.match(bad.content[0].text, /handle/);

    // And the correct name still works, so the guard refuses the mistake and nothing else.
    const good = await client.callTool({
      name: "get_reference_posts",
      arguments: { handle: "mattjbarker1", limit: 1 },
    });
    assert.ok(!good.isError, `the right argument was refused: ${good.content?.[0]?.text}`);
  } finally {
    await close();
  }
});

test("stdio still answers a tool that declares no arguments", async () => {
  // The guard sits in front of the transport precisely so it cannot repeat this morning's failure,
  // where a check in the dispatch was handed the SDK's own context and refused health outright.
  const { client, close } = await connect();
  try {
    for (const name of ["health", "system_status"]) {
      const result = await client.callTool({ name, arguments: {} });
      assert.ok(!result.isError, `${name} refused: ${result.content?.[0]?.text}`);
    }
  } finally {
    await close();
  }
});
