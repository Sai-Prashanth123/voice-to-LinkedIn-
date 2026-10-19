#!/usr/bin/env node
/**
 * The writing stage, in order — a Claude Code hook.
 *
 * WHY THIS EXISTS AND WHY INSTRUCTIONS WERE NOT ENOUGH
 *
 * On 14 October Josh watched a session skip steps it had been told to take: "your voice
 * instructions say to read all six and I skipped the identity, the receipts and voiceprint files",
 * and "the frameworks I used the three structures from the file on disk rather than the library's
 * own version". The instructions were corrected. They are still instructions, and an instruction is
 * advice. This is the same sequence expressed as a gate.
 *
 * WHAT IT GUARDS
 *
 *   system_status            before anything is written — the mode is a fact about the project and
 *                            running the interviewed path in one_step mode is a whole wrong session
 *   start_post               before write_post, for that same idea
 *   write_post + a brief     before create_draft
 *   the law set on disk      not read while a post is in progress; get_voice_brief instead
 *
 * WHAT IT IS NOT
 *
 * Not a security boundary, and nothing that must never fail open belongs here. Nothing publishes
 * without Josh's dated approval, nothing deletes, and the connector's role has no UPDATE — all
 * enforced in Postgres and cc-submit, four ways. This file fails OPEN on purpose: a missing node or
 * a bad parse prints nothing and the call proceeds, because a broken guard must not take his
 * writing session down with it.
 *
 * It is also local only. It runs in a clone of this repo and has no effect on the hosted connector.
 *
 * STATE
 *
 * Per session, in the OS temp directory, keyed by the session id Claude Code puts on stdin. Not in
 * the repo: this is session scratch, not project data, and a state file under .claude/ would show up
 * in his git status. Only SUCCESSFUL calls are recorded (PostToolUse runs after success), so a
 * start_post that failed does not count as a step taken.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = join(tmpdir(), "josh-content-sessions");

/** Both server names reach the same tools: the local stdio server and the hosted connector. */
const TOOL = /^mcp__content-system(?:-remote)?__(.+)$/;

/** The law set on disk. Reading it instead of the library is the mistake Josh watched happen. */
const LAW_SET = /(^|[\\/])data[\\/]josh[\\/][^\\/]+\.(md|json)$/i;

function statePath(sessionId) {
  const safe = String(sessionId ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "");
  return join(DIR, `${safe || "unknown"}.json`);
}

function load(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return { called: [], posts: {}, drafted: [], nudged: [] };
  }
}

function save(sessionId, state) {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {
    // Fail open: an unwritable temp directory means the guard stops guarding, not that work stops.
  }
}

const out = (payload) => process.stdout.write(JSON.stringify(payload));

function deny(reason) {
  out({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

/** Did a tool run this session? Names are the bare tool, server prefix already stripped. */
const ran = (state, name) => state.called.includes(name);

function checkPre(state, tool, input) {
  const needsMode = ["start_post", "capture_thought", "write_post", "create_draft"];
  if (needsMode.includes(tool) && !ran(state, "system_status")) {
    return (
      `Call system_status first. It returns the writing mode, and the mode is a fact about the ` +
      `project rather than a preference — the two modes have different first steps, and running ` +
      `the interviewed path in one_step mode writes a session Josh asked us to stop writing.`
    );
  }

  const moment = input?.moment_id;

  if (tool === "write_post") {
    const started = moment != null && state.posts[String(moment)]?.started;
    if (!started) {
      return (
        `write_post is the second half of start_post, and start_post has not run for idea ` +
        `${moment ?? "(none given)"} this session. Call start_post with his own words first — the ` +
        `ten fields it stores are what every claim in the draft is later checked against.`
      );
    }
  }

  if (tool === "create_draft") {
    const written = moment != null && state.posts[String(moment)]?.written;
    if (!written) {
      return (
        `write_post has not run for idea ${moment ?? "(none given)"} this session. In one_step ` +
        `mode the order is start_post, write_post, create_draft — a draft filed without it is ` +
        `written from whatever is in context rather than from what he actually said.`
      );
    }
    if (!ran(state, "get_voice_brief") && !ran(state, "get_drafting_brief")) {
      return (
        `No voice or drafting brief has been fetched this session. Call get_voice_brief, or ` +
        `get_drafting_brief, before writing in his voice. The briefs carry the live library; the ` +
        `files in data/josh/ can be older than it without saying so, which is exactly what went ` +
        `wrong on 14 October.`
      );
    }
  }

  return null;
}

function main(event) {
  const raw = readFileSync(0, "utf8");
  const hook = JSON.parse(raw);
  const sessionId = hook.session_id;
  const state = load(sessionId);
  const name = String(hook.tool_name ?? "");
  const tool = TOOL.exec(name)?.[1];

  if (event === "pre") {
    // The law set, while a post is in progress. Reading it at any other time is ordinary work.
    if (!tool) {
      const path = hook.tool_input?.file_path ?? hook.tool_input?.path ?? "";
      const drafting = Object.values(state.posts).some((p) => p?.started || p?.written);
      if (drafting && LAW_SET.test(String(path))) {
        deny(
          `A post is in progress, so read the standard from the system rather than from disk: ` +
          `get_voice_brief for the voice, get_drafting_brief for the rest. The library wins where ` +
          `the two differ, and these files carry no version to tell you when they disagree. Read ` +
          `them freely once the draft is filed.`,
        );
        return;
      }
      return;
    }

    const reason = checkPre(state, tool, hook.tool_input);
    if (reason) deny(reason);
    return;
  }

  if (event === "post") {
    if (!tool) return;
    if (!state.called.includes(tool)) state.called.push(tool);

    const moment = hook.tool_input?.moment_id ?? hook.tool_response?.moment_id;
    if (moment != null) {
      const slot = state.posts[String(moment)] ?? {};
      if (tool === "start_post") slot.started = true;
      if (tool === "write_post") slot.written = true;
      state.posts[String(moment)] = slot;
    }

    if (tool === "create_draft") {
      const id = hook.tool_response?.draft_id ?? hook.tool_response?.id ?? `moment-${moment}`;
      if (!state.drafted.includes(String(id))) state.drafted.push(String(id));
      save(sessionId, state);
      out({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext:
            "The draft is filed. The nine checks come next, in a fresh breath — use the " +
            "gate-check skill, judge each check on its own rubric, and read Josh what it caught. " +
            "In one_step mode they do not hold the post back; he decides. Record each with " +
            "record_gate_verdict, because a check nobody recorded is a check nobody ran.",
        },
      });
      return;
    }

    save(sessionId, state);
    return;
  }

  if (event === "stop") {
    // Once per draft. A Stop hook that blocks every time is a loop, and a loop is worse than a
    // skipped step.
    const pending = state.drafted.filter((id) => !state.nudged.includes(id));
    if (pending.length === 0 || ran(state, "record_gate_verdict")) return;
    state.nudged.push(...pending);
    save(sessionId, state);
    out({
      decision: "block",
      reason:
        `${pending.length} draft(s) were written this session and no gate verdict was recorded. ` +
        `Run the nine checks with the gate-check skill and read him what they caught, then stop. ` +
        `If he has already seen them, say so and finish.`,
    });
    return;
  }
}

try {
  main(process.argv[2]);
} catch {
  // Fail open, deliberately. See the header: a guard that breaks must not break the session.
}
