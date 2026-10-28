#!/usr/bin/env node
/**
 * Does this clone actually work?
 *
 *   node scripts/doctor.mjs
 *
 * WHY THIS EXISTS
 *
 * On 26 October `start_post` — the first tool in one-step mode, the mode Josh is in — was found
 * returning HTTP 401 from a cloned repository. `index.mjs` builds the local context without a key,
 * `onestep.mjs` was the one tool that did not fall back to the environment for it, and so it sent
 * `Bearer undefined`. The clone could not begin.
 *
 * It had been like that for weeks and nothing had noticed, because nothing had ever run it:
 * `system_events` held 396 `mcp_http_call` rows and no local equivalent. Every session in the
 * project's life had gone through the hosted connector. There was no command that exercised the
 * clone, so the clone was never exercised.
 *
 * `index.mjs --check` was the closest thing, and it only reads. Reading works with no key at all —
 * the database accepts the scoped key for SELECT and the write door is a different door. So the
 * one check that existed could not have caught the one fault that mattered.
 *
 * THEREFORE: this touches the write door. Not with a write — with a request the door authenticates
 * and then rejects on its own terms. A 400 means the credentials are good. A 401 means they are not,
 * and that is the exact failure above.
 *
 * It prints what passed, what failed, and what to do about each. It prints no secret: not a key, not
 * a prefix of one, not a token. `index.mjs --check` used to print the first eight characters of
 * CONTENT_MCP_KEY, during the step the README tells you to paste the output of.
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { meetsFloor, NODE_FLOOR } from "../mcp-server/node-floor.mjs";
import { announce } from "../mcp-server/announce.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/*
 * THE MACHINE, FIRST — because "it works on mine" is the whole reason this file exists.
 *
 * Printed at the top so a pasted run answers the question with no round trip. Node version and
 * platform are the two things that most often differ between a machine where this works and one
 * where it does not.
 */
console.log(`\n  Node ${process.versions.node} on ${process.platform}/${process.arch}`);

const results = [];
const ok = (what, detail) => results.push({ pass: true, what, detail });
const bad = (what, detail, fix) => results.push({ pass: false, what, detail, fix });

/* ── 1. Node ──────────────────────────────────────────────────────────────── */

if (meetsFloor(process.versions.node)) {
  ok("Node", `v${process.versions.node}`);
} else {
  bad(
    "Node",
    `v${process.versions.node} cannot strip TypeScript, and the server reads its rules from .ts files`,
    `Install Node ${NODE_FLOOR[0]}.${NODE_FLOOR[1]} or newer from https://nodejs.org and run this again.`,
  );
}

/* ── 2. Dependencies ──────────────────────────────────────────────────────── */

if (existsSync(join(ROOT, "mcp-server", "node_modules", "@modelcontextprotocol"))) {
  ok("Dependencies", "the MCP SDK is installed");
} else {
  bad(
    "Dependencies",
    "mcp-server/node_modules is missing or incomplete",
    "cd mcp-server && npm install",
  );
}

/* ── 3. Credentials, by name only ─────────────────────────────────────────── */

const envPath = join(ROOT, "mcp-server", ".env");
let url = process.env.SUPABASE_URL;
let key = process.env.CONTENT_MCP_KEY;

if (existsSync(envPath)) {
  const file = readFileSync(envPath, "utf8");
  const field = (k) => (file.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1]?.trim();
  url ??= field("SUPABASE_URL");
  key ??= field("CONTENT_MCP_KEY");
}

const missing = [!url && "SUPABASE_URL", !key && "CONTENT_MCP_KEY"].filter(Boolean);
if (missing.length === 0) {
  // The host, never the key. A project URL is not a secret; the key is.
  ok("Credentials", `SUPABASE_URL and CONTENT_MCP_KEY present (${new URL(url).host})`);
} else {
  bad(
    "Credentials",
    `${missing.join(" and ")} not found in the environment or mcp-server/.env`,
    "cp mcp-server/.env.example mcp-server/.env, then put in the two values Thought Pilot sent you.",
  );
}

/* ── 4. The database, and whether the role can read ───────────────────────── */

if (url && key) {
  try {
    const res = await fetch(`${url}/rest/v1/library_sections?select=key&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      ok("Database", "reachable, and the role can read the library");
    } else if (res.status === 401 || res.status === 403) {
      bad("Database", `the key was not accepted (${res.status})`, "Ask us to reissue CONTENT_MCP_KEY.");
    } else {
      bad("Database", `unexpected ${res.status}`, "Send us this line and we will look.");
    }
  } catch (err) {
    bad(
      "Database",
      err?.name === "TimeoutError" ? "no response in 15s" : String(err?.message ?? err),
      "Check the project URL and your connection. If the project was paused, we will restart it.",
    );
  }
}

/* ── 4b. THE LIBRARY HAS RULES IN IT, not just rows ───────────────────────── */

/*
 * The check above proves the role can READ the library. It does not prove there is a library.
 *
 * This matters because of a measurement on 28 October 2026. A fresh local cluster takes all 54
 * migrations and comes up with 15 `library_sections` — exactly the number the live project has.
 * TEN OF THOSE FIFTEEN WERE ZERO CHARACTERS LONG. The migrations build the shelves; Josh wrote the
 * rules into them himself over two months.
 *
 * So the verification written for the local stack — "select count(*) from library_sections returns
 * 15" — PASSES ON AN EMPTY LIBRARY. It counts rows that exist, not content in them. A clone would
 * have reported itself healthy while being unable to judge a single draft, because every rubric it
 * judges against would have been the empty string.
 *
 * `voice_transcript` and `receipts` are expected to be empty: they are FOR Josh to fill, and
 * `system_status` already lists them under what is waiting on him. `reference_writer_reads` is
 * empty by design until proposal 22 is approved. Anything else being empty is a broken clone.
 */
if (url && key) {
  const EXPECTED_EMPTY = new Set(["voice_transcript", "receipts", "reference_writer_reads"]);
  try {
    const res = await fetch(`${url}/rest/v1/library_sections?select=key,body`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      bad("The standard", `could not read the sections (${res.status})`, "Send us this line.");
    } else {
      const rows = await res.json();
      const empty = rows
        .filter((r) => !String(r.body ?? "").trim())
        .map((r) => r.key)
        .filter((k) => !EXPECTED_EMPTY.has(k));
      const chars = rows.reduce((n, r) => n + String(r.body ?? "").length, 0);
      if (rows.length === 0) {
        bad("The standard", "no library sections at all", "The migrations have not been applied.");
      } else if (empty.length > 0) {
        bad(
          "The standard",
          `${empty.length} section(s) have no rules in them: ${empty.join(", ")}`,
          "The shelves are here and the standard is not. Restore the data: node local/load.mjs, " +
            "or point SUPABASE_URL at the hosted project.",
        );
      } else {
        ok(
          "The standard",
          `${rows.length} sections, ${chars.toLocaleString()} characters of his rules` +
            (rows.some((r) => EXPECTED_EMPTY.has(r.key) && !String(r.body ?? "").trim())
              ? " (the sections waiting on him are empty, which is expected)"
              : ""),
        );
      }
    }
  } catch (err) {
    bad("The standard", String(err?.message ?? err), "Check the connection and re-run.");
  }
}

/* ── 5. THE WRITE DOOR. The one that would have caught the 401. ───────────── */

if (url && key) {
  try {
    const res = await fetch(`${url}/functions/v1/cc-submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // A kind the door does not route. It authenticates first, then rejects this on its own terms,
      // so nothing is written and a 400 is the good answer.
      body: JSON.stringify({ kind: "doctor_probe" }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) {
      bad(
        "The write door",
        `cc-submit refused the credentials (${res.status})`,
        "This is the fault that stopped a clone starting on 26 October. If you are on the latest " +
          "main, send us this output — it should not happen again.",
      );
    } else if (res.status === 400) {
      ok("The write door", "cc-submit authenticates and rejects an unknown request, as it should");
    } else {
      bad("The write door", `unexpected ${res.status}`, "Send us this line.");
    }
  } catch (err) {
    bad("The write door", String(err?.message ?? err), "Check your connection and try again.");
  }
}

/* ── 6. The files Claude Code reads ───────────────────────────────────────── */

const needed = [
  ".mcp.json",
  "CLAUDE.md",
  ".claude/settings.json",
  ".claude/hooks/writing-order.mjs",
  ".claude/skills/josh-voice/SKILL.md",
  ".claude/skills/draft-post/SKILL.md",
  ".claude/skills/gate-check/SKILL.md",
  ".claude/skills/barker-audit/SKILL.md",
  ".claude/commands/write.md",
  ".claude/commands/review.md",
  ".claude/commands/waiting.md",
];
const absent = needed.filter((f) => !existsSync(join(ROOT, f)));
if (absent.length === 0) {
  ok("Claude Code files", `${needed.length} present, including all four skills`);
} else {
  bad(
    "Claude Code files",
    `missing: ${absent.join(", ")}`,
    "git pull. If they are still missing, the clone is incomplete — clone it again.",
  );
}

/* ── 7. The hook runs ─────────────────────────────────────────────────────── */

try {
  execFileSync(process.execPath, [join(ROOT, ".claude", "hooks", "writing-order.mjs"), "post"], {
    input: JSON.stringify({ session_id: "doctor", tool_name: "health", tool_input: {} }),
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  ok("The writing-order hook", "runs");
} catch (err) {
  // It fails open by design, so this is a warning about the hook rather than about the system.
  bad(
    "The writing-order hook",
    String(err?.message ?? err).split("\n")[0],
    "The system still works without it — it enforces the order of the writing steps and fails " +
      "open. Worth telling us, not worth stopping for.",
  );
}

/* ── Say it ───────────────────────────────────────────────────────────────── */

/*
 * Filed as well as printed.
 *
 * He may run this and not send the output — and the facts that matter most (which Node, which
 * platform, which commit) are then still on the record, which is exactly what was missing when a
 * clone could not start and nobody could tell. Never awaited, never throws, and sends nothing
 * personal: see announce().
 */
// AWAITED. This script exits, and process.exit() tears down a pending request — the first version
// did not await and filed nothing while reporting success.
if (url && key) await announce({ url, key, transport: "doctor", tools: null });

const failed = results.filter((r) => !r.pass);

console.log("");
for (const r of results) {
  console.log(`  ${r.pass ? "ok  " : "FAIL"}  ${r.what.padEnd(22)} ${r.detail}`);
}
console.log("");

if (failed.length === 0) {
  console.log("  Everything a clone needs is working, including the write door.");
  console.log("  Open this folder in Claude Code and say hello.\n");
  process.exit(0);
}

console.log(`  ${failed.length} thing(s) to fix:\n`);
for (const r of failed) console.log(`  ${r.what}: ${r.fix}\n`);
process.exit(1);
