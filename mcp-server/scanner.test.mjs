/**
 * Claude Code session tracking over the connector (4.4).
 *
 * The input these cover was silent for a month while looking finished. Each test is a way it could
 * go silent again without anybody noticing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { pickBar, MIN_SCORE } from "../cc-agent/index.mjs";
import { render, TARGET } from "./scripts/embed-scanner.mjs";
import { handleSessionRoutes } from "./http.mjs";
import { toolsForScope } from "./auth.mjs";
import { tools } from "./tools/index.mjs";

const ENV = {
  MCP_READ_TOKEN: "read-token-aaaaaaaaaaaaaaaa",
  MCP_WRITE_TOKEN: "write-token-bbbbbbbbbbbbbbb",
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "x",
};

test("the served scanner is the one in the repository", () => {
  // A stale embed is a second copy of the filter that nobody reads, running on every machine.
  assert.equal(
    fs.readFileSync(TARGET, "utf8"),
    render(),
    "generated/scanner-files.mjs is stale: run npm run embed:scanner",
  );
});

test("calibration aims at about two sessions a week", () => {
  const scores = Array.from({ length: 60 }, (_, i) => i + 1); // 60 reflective sessions, 1..60
  const { bar, calibrated } = pickBar([0, 0, 0, ...scores], { spanDays: 28 });
  assert.equal(calibrated, true);
  const passing = scores.filter((s) => s >= bar).length;
  assert.equal(passing, 8, "four weeks at two a week");
});

test("a machine with few reflective sessions lets all of them through", () => {
  // The first real machine: 3 reflective sessions in 30 days, and a bar of 12 none could reach.
  const r = pickBar([4.4, 2.1, 3, 0, 0], { spanDays: 30 });
  assert.equal(r.calibrated, true);
  assert.equal(r.bar, 2.1);
});

test("a machine with no reflective session keeps the default", () => {
  const r = pickBar([0, 0, 0], { spanDays: 30 });
  assert.equal(r.calibrated, false);
  assert.equal(r.bar, MIN_SCORE);
});

test("a machine whose best score is low still gets a bar something can pass", () => {
  // The first real machine scored 4.4 at best against a default of 12.
  const scores = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.2);
  const { bar } = pickBar(scores, { spanDays: 30 });
  assert.ok(bar <= Math.max(...scores));
});

test("the scanner download is public and serves both files", async () => {
  for (const f of ["scanner.mjs", "index.mjs"]) {
    const res = await handleSessionRoutes(new Request(`https://h/functions/v1/mcp/scanner/${f}`), { env: ENV });
    assert.equal(res.status, 200, f);
    assert.ok((await res.text()).length > 1000);
  }
  const missing = await handleSessionRoutes(new Request("https://h/mcp/scanner/secrets.mjs"), { env: ENV });
  assert.equal(missing.status, 404);
});

test("reporting sessions refuses no token and the read token", async () => {
  const post = (auth) => handleSessionRoutes(new Request("https://h/mcp/sessions", {
    method: "POST",
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    body: JSON.stringify({ digests: [] }),
  }), { env: ENV });

  assert.equal((await post(null)).status, 401);
  assert.equal((await post("wrong-token-cccccccccccccccc")).status, 401);
  assert.equal((await post(ENV.MCP_READ_TOKEN)).status, 403);
});

test("other paths are left to the MCP handler", async () => {
  assert.equal(await handleSessionRoutes(new Request("https://h/functions/v1/mcp"), { env: ENV }), null);
});

test("both tracking tools reach the hosted connector", () => {
  const hosted = toolsForScope(tools, "write").filter((t) => !t.localOnly).map((t) => t.name);
  assert.ok(hosted.includes("setup_session_tracking"));
  assert.ok(hosted.includes("session_tracking_status"));
  const readOnly = toolsForScope(tools, "read").map((t) => t.name);
  assert.ok(readOnly.includes("session_tracking_status"));
});

test("setup fills in the connector address and the caller's token", async () => {
  const setup = tools.find((t) => t.name === "setup_session_tracking");
  const out = await setup.handler(
    { platform: "windows" },
    { endpoint: "https://p.supabase.co/functions/v1/mcp", token: "tok-123" },
  );
  const joined = out.commands.windows.join("\n");
  assert.match(joined, /https:\/\/p\.supabase\.co\/functions\/v1\/mcp\/scanner\/scanner\.mjs/);
  assert.match(joined, /--token "tok-123"/);
  assert.equal(out.token_filled_in, true);
});

test("write tools submit with the key from the context, not only process.env", async () => {
  // On the hosted connector the key is in the env object the edge function builds, so process.env
  // has nothing. Every write from Claude Desktop and claude.ai failed with "CONTENT_MCP_KEY is not
  // set" while the local server, which does have it in process.env, passed every check.
  const saved = process.env.CONTENT_MCP_KEY;
  delete process.env.CONTENT_MCP_KEY;
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization });
    return new Response(JSON.stringify({ ok: true, moment_id: 1 }), { status: 200 });
  };
  try {
    const capture = tools.find((t) => t.name === "capture_thought");
    await capture.handler({ text: "x" }, { url: "https://p.test", key: "ctx-key" });
    const answer = tools.find((t) => t.name === "answer_interview");
    await answer.handler({ moment_id: 1, answer: "y" }, { url: "https://p.test", key: "ctx-key" });
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => s.auth === "Bearer ctx-key" && s.url.endsWith("/functions/v1/cc-submit")));
  } finally {
    globalThis.fetch = realFetch;
    if (saved !== undefined) process.env.CONTENT_MCP_KEY = saved;
  }
});
