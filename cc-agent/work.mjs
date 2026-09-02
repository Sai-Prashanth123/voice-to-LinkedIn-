#!/usr/bin/env node
/**
 * work.mjs — the pull loop that lets Claude Code do the writing (task 2.3).
 *
 * WHY THE LAPTOP PULLS
 *
 * Edge Functions run in Supabase's cloud. Claude Code runs here. The cloud cannot call this
 * machine, so the obvious design — a `claude-code` provider inside llm.ts — would leave a cloud
 * function blocking on a host it has no route to. Instead this asks what is waiting, runs Claude
 * Code against it, and the work posts itself back through the MCP server.
 *
 * WHAT THIS FILE DOES NOT CONTAIN
 *
 * Any writing instructions. It decides WHAT to work on and nothing about HOW: the standard comes
 * from get_drafting_brief and get_gate_brief, which assemble it from prompts.ts. If a prompt in
 * this file started shaping the output, there would be two standards again and no way to tell which
 * one a given post had followed.
 *
 * WHY IT IS CAPPED, AND WHY IT STOPS ON FAILURE
 *
 * Each run does at most a few items. An unbounded loop against a rate-limited subscription turns
 * one bad night into a queue of half-finished drafts, and 9.8 already limits a moment to three
 * attempts — this must not become a fourth route around that. A run that fails twice in a row stops
 * rather than working through the whole queue producing the same failure.
 *
 * Usage:
 *   node cc-agent/work.mjs              # draft and gate what is waiting
 *   node cc-agent/work.mjs --dry-run    # show what it would do, run nothing
 *   node cc-agent/work.mjs --gate-only  # only finish gate runs already started
 *   node cc-agent/work.mjs --once       # a single item, then stop
 *
 * Needs SUPABASE_URL and CONTENT_MCP_KEY, the same pair mcp-server/.env holds.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { c, mark, title } from "./ui.mjs";
import { claudeCommand } from "./claude-bin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const MAX_DRAFTS = Number(process.env.CC_WORK_MAX_DRAFTS ?? 2);
const MAX_GATES = Number(process.env.CC_WORK_MAX_GATES ?? 3);
/** A model that cannot finish one item will not finish the next one either. */
const MAX_CONSECUTIVE_FAILURES = 2;
const TURN_LIMIT = Number(process.env.CC_WORK_MAX_TURNS ?? 40);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const GATE_ONLY = args.has("--gate-only");
const ONCE = args.has("--once");

function env() {
  // mcp-server/.env is the same pair this needs, so it is read rather than duplicated. A real
  // environment variable still wins, which is how the scheduled run supplies them.
  let file = "";
  try {
    file = readFileSync(join(ROOT, "mcp-server", ".env"), "utf8");
  } catch { /* environment only */ }

  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1]?.trim();

  const url = field("SUPABASE_URL");
  const key = field("CONTENT_MCP_KEY");
  if (!url || !key) {
    console.error(
      `${mark.no} Missing SUPABASE_URL or CONTENT_MCP_KEY.\n` +
      `  Fill in mcp-server/.env, or mint the scoped key:\n` +
      `  SUPABASE_ACCESS_TOKEN=sbp_... node mcp-server/mint-key.mjs --write`,
    );
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), key };
}

async function query({ url, key }, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * What is waiting.
 *
 * Drafting: moments that are mined and have no draft yet. Not half_mined — the interview has not
 * finished with those, and drafting one early is how a thin post gets written from a moment that
 * would have been good.
 *
 * Gating: drafts with fewer than eight verdicts. A draft stuck at six checks is the cheapest work
 * available, which is why gating is done first.
 */
async function findWork(creds) {
  const [moments, drafts, runs] = await Promise.all([
    query(creds, "moments?select=id,ref,status,killed&status=eq.mined&killed=is.false"),
    query(creds, "drafts?select=id,moment_id,gate_passed,created_at&order=created_at.desc&limit=50"),
    query(creds, "gate_runs?select=draft_id,check_key"),
  ]);

  const verdicts = new Map();
  for (const r of runs) verdicts.set(r.draft_id, (verdicts.get(r.draft_id) ?? 0) + 1);

  const drafted = new Set(drafts.map((d) => d.moment_id));

  return {
    toGate: drafts
      .filter((d) => (verdicts.get(d.id) ?? 0) < 8)
      .map((d) => ({ ...d, judged: verdicts.get(d.id) ?? 0 }))
      .slice(0, MAX_GATES),
    toDraft: moments.filter((m) => !drafted.has(m.id)).slice(0, MAX_DRAFTS),
  };
}

/**
 * One Claude Code run.
 *
 * --strict-mcp-config with the repo's own .mcp.json: the scheduled run must reach the content
 * system and nothing else, and inheriting whatever servers happen to be configured on this machine
 * would make what it can touch depend on unrelated local settings.
 */
function runClaude(prompt) {
  return new Promise((resolvePromise) => {
    const { file, args: cmdArgs } = claudeCommand([
      "--print",
      "--output-format", "json",
      "--max-turns", String(TURN_LIMIT),
      "--permission-mode", "acceptEdits",
      "--allowedTools", "mcp__content-system__*",
      "--strict-mcp-config",
      "--mcp-config", join(ROOT, ".mcp.json"),
    ]);

    // THE PROMPT GOES ON STDIN, NOT ON THE COMMAND LINE.
    //
    // --mcp-config is variadic: it takes a space-separated list of configs, so it swallows every
    // argument after it. A prompt passed as the final argument was read as a second config file
    // and the run died with "MCP config file not found: <the entire prompt>". This file could
    // never have completed a single job, and it looked like a working scheduler.
    const child = spawn(file, cmdArgs, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(prompt);

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    child.on("error", (e) => resolvePromise({ ok: false, why: e.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        return resolvePromise({ ok: false, why: err.trim().slice(0, 400) || `exit ${code}` });
      }
      try {
        const parsed = JSON.parse(out);
        resolvePromise({
          // is_error is Claude Code saying the turn itself failed, which is not the same as a
          // non-zero exit and is easy to miss.
          ok: !parsed.is_error,
          why: parsed.is_error ? String(parsed.result ?? "").slice(0, 400) : null,
          text: String(parsed.result ?? ""),
        });
      } catch {
        resolvePromise({ ok: true, text: out.slice(0, 400) });
      }
    });
  });
}

/**
 * The prompts name the skill and the item, and say nothing about how to do the work.
 *
 * Naming the id matters: "draft the next one" leaves the model to choose, and two scheduled runs
 * overlapping would then both choose the same moment.
 */
const DRAFT_PROMPT = (m) =>
  `Use the draft-post skill to write a post for moment ${m.id} (${m.ref}). ` +
  `Call get_drafting_brief first and follow it exactly. Finish by calling create_draft with the ` +
  `full claim ledger. Do not run the gate in this session.`;

const GATE_PROMPT = (d) =>
  `Use the gate-check skill on draft ${d.id}. Call get_gate_brief, judge each remaining check on ` +
  `its own, and call record_gate_verdict once per check. Run every check even after one fails.`;

async function main() {
  title("Content system", DRY_RUN ? "dry run" : "drafting and gating");
  const creds = env();

  let work;
  try {
    work = await findWork(creds);
  } catch (e) {
    console.error(`${mark.no} Could not read the queue: ${e.message}`);
    return 1;
  }

  const items = [
    ...work.toGate.map((d) => ({ kind: "gate", id: d.id, label: `draft ${d.id} (${d.judged}/8 judged)`, prompt: GATE_PROMPT(d) })),
    ...(GATE_ONLY ? [] : work.toDraft.map((m) => ({ kind: "draft", id: m.id, label: `${m.ref}`, prompt: DRAFT_PROMPT(m) }))),
  ];

  if (items.length === 0) {
    console.log(`${mark.ok} Nothing waiting. ${c.dim("A quiet run is a correct outcome.")}`);
    return 0;
  }

  const queued = ONCE ? items.slice(0, 1) : items;
  console.log(`${c.bold(String(queued.length))} item(s) to work on\n`);

  if (DRY_RUN) {
    for (const item of queued) {
      console.log(`  ${c.dim(item.kind.padEnd(5))} ${item.label}`);
      console.log(`  ${c.dim(item.prompt)}\n`);
    }
    console.log(c.dim("Dry run — nothing was run."));
    return 0;
  }

  let failures = 0;
  let done = 0;

  for (const item of queued) {
    process.stdout.write(`  ${item.kind.padEnd(5)} ${item.label} … `);
    const started = Date.now();
    const result = await runClaude(item.prompt);
    const secs = ((Date.now() - started) / 1000).toFixed(0);

    if (result.ok) {
      failures = 0;
      done += 1;
      console.log(`${mark.ok} ${c.dim(`${secs}s`)}`);
    } else {
      failures += 1;
      console.log(`${mark.no} ${c.dim(`${secs}s`)}`);
      console.log(`        ${c.dim(result.why ?? "no reason given")}`);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(
          `\n${mark.no} Stopped after ${failures} failures in a row. ` +
          c.dim("Working through the rest would produce the same failure more times."),
        );
        return 1;
      }
    }
  }

  console.log(`\n${mark.ok} ${done} of ${queued.length} completed.`);
  return done === queued.length ? 0 : 1;
}

process.exitCode = await main();
