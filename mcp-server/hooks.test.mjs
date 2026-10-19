/**
 * The writing-order hook, exercised as the harness runs it: a process, JSON on stdin, JSON out.
 *
 * Tested here rather than near the hook because this is the suite that has to be green before a
 * commit, and a guard nobody runs is the thing this whole repository keeps learning about. Every
 * bug found in the three days before it was written was code that had never been exercised.
 *
 * It is spawned, not imported, because the thing that can break is the process contract — a hook
 * that throws, or prints prose where JSON is expected, silently stops guarding and looks identical
 * to a hook that allowed the call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", ".claude", "hooks", "writing-order.mjs");

let n = 0;
/** A fresh session id per test, so one test's recorded steps cannot satisfy another's guard. */
function session() {
  const id = `nodetest-${process.pid}-${++n}`;
  try {
    rmSync(join(tmpdir(), "josh-content-sessions", `${id}.json`), { force: true });
  } catch { /* nothing to clean */ }
  return id;
}

function run(event, payload) {
  const out = execFileSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

const pre = (id, tool, input = {}) =>
  run("pre", { session_id: id, tool_name: tool, tool_input: input });
const post = (id, tool, input = {}, response = {}) =>
  run("post", { session_id: id, tool_name: tool, tool_input: input, tool_response: response });

const denial = (result) => result?.hookSpecificOutput?.permissionDecisionReason;

test("nothing is written before the mode has been read", () => {
  const id = session();
  // The mode is a fact about the project, and running the interviewed path in one_step mode is a
  // whole wrong session rather than a wrong sentence.
  assert.match(denial(pre(id, "mcp__content-system__start_post", { moment_id: 1 })), /system_status/);
  assert.match(denial(pre(id, "mcp__content-system__capture_thought", {})), /system_status/);
});

test("write_post is refused until start_post has run for that idea", () => {
  const id = session();
  post(id, "mcp__content-system__system_status");
  assert.match(denial(pre(id, "mcp__content-system__write_post", { moment_id: 42 })), /start_post/);

  post(id, "mcp__content-system__start_post", { moment_id: 42 });
  assert.equal(pre(id, "mcp__content-system__write_post", { moment_id: 42 }), null, "now it passes");

  // Another idea is another post. Steps taken on 42 say nothing about 43.
  assert.match(denial(pre(id, "mcp__content-system__write_post", { moment_id: 43 })), /start_post/);
});

test("create_draft is refused until the post was written and a brief was read", () => {
  const id = session();
  post(id, "mcp__content-system__system_status");
  post(id, "mcp__content-system__start_post", { moment_id: 7 });
  assert.match(denial(pre(id, "mcp__content-system__create_draft", { moment_id: 7 })), /write_post/);

  post(id, "mcp__content-system__write_post", { moment_id: 7 });
  assert.match(denial(pre(id, "mcp__content-system__create_draft", { moment_id: 7 })), /brief/);

  post(id, "mcp__content-system__get_voice_brief");
  assert.equal(pre(id, "mcp__content-system__create_draft", { moment_id: 7 }), null);
});

test("the connector's tools are guarded the same as the local server's", () => {
  // Two server names reach the same tools. A guard that knew only one would be no guard at all for
  // Josh, who is on the hosted connector.
  const id = session();
  assert.match(
    denial(pre(id, "mcp__content-system-remote__create_draft", { moment_id: 9 })),
    /system_status/,
  );
});

test("the law set on disk is refused only while a post is in progress", () => {
  const id = session();
  const read = { file_path: "D:/Voice to content/data/josh/voice.md" };

  // Reading it while developing is ordinary work, and refusing that would be a nuisance with no
  // safety behind it.
  assert.equal(pre(id, "Read", read), null);

  post(id, "mcp__content-system__system_status");
  post(id, "mcp__content-system__start_post", { moment_id: 3 });
  assert.match(denial(pre(id, "Read", read)), /get_voice_brief/);

  // And only the law set: everything else on disk stays readable mid-draft.
  assert.equal(pre(id, "Read", { file_path: "D:/Voice to content/CLAUDE.md" }), null);
});

test("a filed draft is told what comes next, and the gate nudge fires once", () => {
  const id = session();
  post(id, "mcp__content-system__system_status");
  const filed = post(
    id,
    "mcp__content-system__create_draft",
    { moment_id: 11 },
    { draft_id: 999 },
  );
  assert.match(filed.hookSpecificOutput.additionalContext, /gate-check/);

  const first = run("stop", { session_id: id });
  assert.equal(first.decision, "block");
  assert.match(first.reason, /no gate verdict was recorded/);

  // Once per draft. A Stop hook that blocks every time is a loop, which is worse than the skip.
  assert.equal(run("stop", { session_id: id }), null);
});

test("a recorded gate verdict means the session may end quietly", () => {
  const id = session();
  post(id, "mcp__content-system__system_status");
  post(id, "mcp__content-system__create_draft", { moment_id: 12 }, { draft_id: 1000 });
  post(id, "mcp__content-system__record_gate_verdict", { draft_id: 1000 });
  assert.equal(run("stop", { session_id: id }), null);
});

test("the guard fails open rather than taking the session down with it", () => {
  // Deliberate: nothing that must never fail open belongs in a hook. Publishing, deleting and
  // direct writes are refused by Postgres, four ways, and are not moved here.
  assert.equal(run("pre", "not even an object"), null);
  const out = execFileSync(process.execPath, [HOOK, "pre"], { input: "{ broken", encoding: "utf8" });
  assert.equal(out.trim(), "");
});

test("tools outside the content system are not guarded", () => {
  const id = session();
  assert.equal(pre(id, "Bash", { command: "ls" }), null);
  assert.equal(pre(id, "mcp__supabase-voice-to-content__execute_sql", { query: "select 1" }), null);
});
