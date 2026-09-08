#!/usr/bin/env node
/**
 * cc-agent — reads Claude Code session logs on Josh's machine and sends digests (4.4).
 *
 * WHY THIS RUNS LOCALLY AND SENDS A DIGEST RATHER THAN THE LOGS
 *
 * Measured on a comparable machine: 558 .jsonl files totalling 625 MB — but only 40 of those are
 * actual sessions. The other 518 are `subagents/` transcripts containing none of the user's own
 * words. Real sessions have a median of ~600 KB and run to 239 MB at the extreme.
 *
 * Josh has roughly 1,400 sessions across two months. Shipping raw logs to a model would be
 * unaffordable, and it would also put client code into a third-party context, which clause 15.4
 * forbids. So this filters locally and sends a small digest of what Josh SAID and DECIDED — never
 * code, never tool output.
 *
 * BEFORE TRUSTING THE THRESHOLD, run `node eval/calibrate-cc.mjs` on Josh's machine. The default
 * was set against a 40-session corpus that is not his, and 4.4.3 makes the cost of getting this
 * wrong asymmetric: too many candidates and he stops reading them, which kills the input entirely.
 *
 * THE HIGH BAR (4.4.2)
 *
 * Only genuinely unusual sessions are worth surfacing: something broke and got fixed in an odd way,
 * something got built that had not been built before, an assumption turned out to be wrong, a
 * decision changed. Routine work produces nothing and the system stays silent about it.
 *
 * "A version of this that surfaces ten candidates a day is worse than no version at all, because
 *  Josh will stop reading them." (4.4.3)
 *
 * So this pass is deliberately harsh. It discards most sessions before a model ever sees them; the
 * server applies a second filter and a hard daily cap on top.
 *
 * Usage:
 *   node cc-agent/index.mjs            # send digests for anything new
 *   node cc-agent/index.mjs --dry-run  # show what it would send, send nothing
 *
 * Needs CONTENT_SYSTEM_URL and CONTENT_SYSTEM_KEY in the environment.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const STATE_FILE = path.join(os.homedir(), ".claude", ".content-system-state.json");
const MAX_DIGEST_CHARS = 6000;
const LOOKBACK_DAYS = Number(process.env.CC_LOOKBACK_DAYS ?? 3);
/** 4.4.3 — only the strongest few per run ever reach Josh, whatever the heuristics decide. */
const MAX_PER_RUN = Number(process.env.CC_MAX_PER_RUN ?? 3);
/** Calibrated against a real 558-session corpus — see the calibration note on assess(). */
const MIN_SCORE = Number(process.env.CC_MIN_SCORE ?? 12);

/** Signals that a session might be interesting. Cheap string work, no parsing of code. */
const DECISION_MARKERS = [
  "actually", "turns out", "i was wrong", "that's not right", "thats not right",
  "let's not", "lets not", "instead of", "changed my mind", "scrap that",
  "the real problem", "root cause", "i assumed", "my assumption", "surprised",
  "never seen", "weird", "strange", "does not make sense", "doesn't make sense",
  "finally", "that fixed it", "got it working", "oh interesting",
];

const BORING_MARKERS = [
  "npm install", "yarn add", "pip install", "prettier", "eslint --fix",
  "typo", "formatting", "bump version", "update readme",
];

/**
 * The scan itself, separated from the command that prints it.
 *
 * Extracted so the MCP server's `scan_sessions` tool runs THIS code rather than a copy of it. The
 * local filter is the part that must not be duplicated: it is what keeps 625 MB of session logs and
 * anything resembling client code off the wire (15.4), and a second implementation of it would
 * diverge silently — the reader would look fine and be sending more than it should.
 *
 * Deliberately does no I/O of its own beyond reading the logs. It never saves state and never
 * sends; the caller decides both. That is not tidiness — saving state here was a real bug, where an
 * empty dry run marked all 558 sessions as seen and the next real run had nothing left to look at.
 */
export async function scan() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return {
      available: false,
      dir: PROJECTS_DIR,
      changed: 0,
      digests: [],
      skipped: 0,
      overflow: 0,
      allScores: [],
      state: null,
    };
  }

  const state = loadState();
  const cutoff = Date.now() - LOOKBACK_DAYS * 86_400_000;
  const files = findSessions(PROJECTS_DIR).filter((f) => {
    const stat = fs.statSync(f);
    if (stat.mtimeMs < cutoff) return false;
    const seen = state.seen[f];
    return !seen || seen.mtime !== stat.mtimeMs;
  });

  const digests = [];
  const allScores = [];
  let skipped = 0;

  for (const file of files) {
    const stat = fs.statSync(file);
    state.seen[file] = { mtime: stat.mtimeMs };

    try {
      const session = await readSession(file);
      const verdict = assess(session);
      allScores.push(verdict.score ?? 0);
      if (!verdict.interesting) {
        skipped++;
        continue;
      }
      digests.push({
        session_id: path.basename(file, ".jsonl"),
        digest: buildDigest(session, verdict),
        started_at: session.startedAt,
        score: verdict.score,
      });
    } catch (err) {
      console.warn(`  skipped ${path.basename(file)}: ${err.message}`);
      skipped++;
    }
  }

  // 4.4.3 — the cap is the backstop. Even if the heuristics drift, Josh never gets a wall of
  // candidates, because only the strongest few per run are ever sent.
  digests.sort((a, b) => b.score - a.score);
  const overflow = Math.max(0, digests.length - MAX_PER_RUN);
  if (overflow > 0) digests.length = MAX_PER_RUN;

  return {
    available: true,
    dir: PROJECTS_DIR,
    changed: files.length,
    digests,
    skipped,
    overflow,
    allScores,
    state,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await scan();

  if (!result.available) {
    console.log(`No Claude Code sessions at ${result.dir} — nothing to do.`);
    return;
  }

  const { digests, skipped, overflow, allScores, state } = result;

  console.log(`${result.changed} session(s) changed in the last ${LOOKBACK_DAYS} days.`);
  console.log(
    `${digests.length} worth a look, ${skipped + overflow} set aside ` +
      `(most sessions producing nothing is the expected result).`,
  );

  // CC_HISTOGRAM=1 prints the score distribution across the corpus. This is how the threshold was
  // chosen, and how it should be re-chosen against Josh's own sessions rather than assumed.
  if (process.env.CC_HISTOGRAM) {
    const buckets = new Map();
    for (const sc of allScores) {
      const b = Math.max(0, Math.floor(sc / 3) * 3);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    console.log(`\nscore distribution across ${allScores.length} sessions:`);
    let cumulative = allScores.length;
    for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
      const pct = ((cumulative / allScores.length) * 100).toFixed(1);
      console.log(`  threshold >=${String(k).padStart(3)} would pass ${String(cumulative).padStart(4)} (${pct}%)`);
      cumulative -= buckets.get(k);
    }
  }

  // A dry run must never mutate state — including when nothing passed the filter. Saving here was
  // a real bug: an empty dry run marked all 558 sessions as seen, so the next real run had nothing
  // left to look at.
  if (dryRun) {
    for (const d of digests) {
      console.log(`\n─── ${d.session_id} (score ${d.score}) ───\n${d.digest.slice(0, 800)}…`);
    }
    return;
  }

  if (digests.length === 0) {
    saveState(state);
    return;
  }

  await send(digests);
  saveState(state);
  console.log(`Sent ${digests.length} digest(s).`);
}

/**
 * Josh's own sessions only.
 *
 * `subagents/` holds agent-to-agent transcripts, and on a real machine they are the overwhelming
 * majority of the files: 518 of 558 in the corpus this was calibrated against. They contain none of
 * Josh's words, so they can never evidence what he thought — reading them would burn cost and
 * dilute the signal for nothing.
 */
function findSessions(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "subagents") continue;
      out.push(...findSessions(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".jsonl")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Streams the file line by line. Some sessions run to hundreds of megabytes, so this never loads a
 * whole log into memory, and it keeps only the fields it needs.
 */
async function readSession(file) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const userMessages = [];
  const assistantSummaries = [];
  const filesWritten = new Set();
  const commands = [];
  let errors = 0;
  let startedAt = null;
  let turns = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    startedAt ??= event.timestamp ?? null;

    const role = event.message?.role ?? event.type;
    const content = event.message?.content;

    if (role === "user" && typeof content === "string") {
      turns++;
      if (content.length < 2000 && !content.startsWith("<")) userMessages.push(content.trim());
    } else if (role === "user" && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text && block.text.length < 2000) {
          turns++;
          userMessages.push(block.text.trim());
        }
        // tool_result blocks are deliberately ignored: that is where code and output live.
        if (block.type === "tool_result" && typeof block.content === "string") {
          if (/error|exception|failed|traceback/i.test(block.content.slice(0, 500))) errors++;
        }
      }
    } else if (role === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          const t = block.text.trim();
          if (t.length > 40 && t.length < 1200) assistantSummaries.push(t);
        }
        if (block.type === "tool_use") {
          const name = block.name ?? "";
          if (name === "Write" && block.input?.file_path) filesWritten.add(block.input.file_path);
          if ((name === "Bash" || name === "PowerShell") && block.input?.command) {
            const cmd = String(block.input.command);
            if (/^git (commit|revert|reset)/.test(cmd.trim())) commands.push(cmd.slice(0, 200));
          }
        }
      }
    }
  }

  return { file, startedAt, turns, userMessages, assistantSummaries, filesWritten, commands, errors };
}

/**
 * The local high bar.
 *
 * CALIBRATION NOTE — this was rewritten after testing against a real corpus, and the first version
 * was badly wrong in an instructive way. It used absolute thresholds ("2 or more errors", "3 or more
 * files written") and passed 4 sessions out of 4. Real sessions run to 173, 251, even 1428 turns
 * with hundreds of failures along the way: errors and file writes are what ordinary work looks like,
 * not evidence of anything unusual. Absolute thresholds select for "long", which every real session
 * is.
 *
 * So two changes:
 *
 *   1. REFLECTION IS NECESSARY, NOT MERELY CONTRIBUTING. All four of 4.4.2's categories are about
 *      Josh realising something — an odd fix, a first, a wrong assumption, a changed decision. The
 *      only trace of that in a log is his own words. A session with no reflective language in it
 *      records work happening, not a story, and is discarded however dramatic its error count.
 *
 *   2. RATES, NOT TOTALS. 1305 errors across 1428 turns is a normal day. 12 errors in 20 turns is a
 *      session that fought something. Density is the signal; volume is noise.
 *
 * Returns a score so the caller can rank and take only the strongest few, which holds the line even
 * if this calibration drifts again (4.4.3).
 */
function assess(s) {
  const text = s.userMessages.join(" ").toLowerCase();

  // Too short to be anything, or too little of Josh in it to know what he thought.
  if (s.turns < 4 || s.userMessages.length < 3) return { interesting: false };

  const decisionHits = [...new Set(DECISION_MARKERS.filter((m) => text.includes(m)))];

  // NECESSARY CONDITION. Without it there is no realisation to write about, only activity.
  if (decisionHits.length === 0) return { interesting: false };

  const boring = BORING_MARKERS.filter((m) => text.includes(m)).length;
  const reasons = [];
  let score = 0;

  // Reflection density: how much of what he said was working something out, not directing work.
  const density = decisionHits.length / Math.max(1, s.userMessages.length / 10);
  score += Math.min(decisionHits.length * 3, 15) + Math.min(density * 4, 10);
  reasons.push(`worked something out in his own words (${decisionHits.slice(0, 3).join(", ")})`);

  // Error RATE, not count. A session that fought something unusual, versus a long ordinary one.
  const errorRate = s.errors / Math.max(1, s.turns);
  if (errorRate > 0.8 && s.turns < 60) {
    score += 8;
    reasons.push(`hit trouble repeatedly in a short session (${s.errors} failures in ${s.turns} turns)`);
  }

  // A revert is the clearest machine-visible trace of a decision changing.
  if (s.commands.some((c) => /revert|reset --hard/.test(c))) {
    score += 10;
    reasons.push("work was reverted, which usually means a decision changed");
  }

  // Long sessions are the norm here, so length counts against novelty rather than for it.
  if (s.turns > 200) {
    score -= 5;
    reasons.push("(long session — routine grind is likelier than a story)");
  }

  score -= boring * 4;
  score = Math.round(score * 10) / 10;

  return { interesting: score >= MIN_SCORE, reasons, score };
}

/**
 * What gets sent: Josh's own words and the shape of what happened. Never code, never tool output,
 * never file contents (15.4).
 */
function buildDigest(s, verdict) {
  const parts = [];
  parts.push(`SESSION: ${path.basename(s.file, ".jsonl")}`);
  parts.push(`Started: ${s.startedAt ?? "unknown"} | Turns: ${s.turns} | Failures seen: ${s.errors}`);
  parts.push(`Local filter flagged: ${verdict.reasons.join("; ")}`);
  parts.push("");
  parts.push("WHAT JOSH SAID (his words only):");
  for (const m of s.userMessages.slice(0, 25)) parts.push(`  - ${collapse(m, 300)}`);

  if (s.assistantSummaries.length > 0) {
    parts.push("");
    parts.push("WHAT WAS WORKED OUT (assistant explanation, for context only):");
    for (const a of s.assistantSummaries.slice(-5)) parts.push(`  - ${collapse(a, 300)}`);
  }
  if (s.filesWritten.size > 0) {
    parts.push("");
    parts.push(`FILES CREATED: ${[...s.filesWritten].slice(0, 15).map((f) => path.basename(f)).join(", ")}`);
  }
  if (s.commands.length > 0) {
    parts.push(`NOTABLE COMMANDS: ${s.commands.slice(0, 5).join(" | ")}`);
  }

  return parts.join("\n").slice(0, MAX_DIGEST_CHARS);
}

function collapse(text, max) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * Hand the digests to worker-triage, which applies the SECOND filter and the daily cap (4.4.3).
 *
 * Never a direct database write, from here or from anywhere else that calls this. The local pass is
 * a heuristic and heuristics drift; the server pass is the backstop that stops a drifted heuristic
 * becoming a wall of candidates Josh stops reading. A caller that inserted straight into `moments`
 * would skip it, so no caller is given that option.
 *
 * `opts` exists so the MCP tool can pass its own credentials rather than inheriting this process's.
 */
export async function send(digests, opts = {}) {
  const url = opts.url ?? process.env.CONTENT_SYSTEM_URL;
  const key = opts.key ?? process.env.CONTENT_SYSTEM_KEY;
  if (!url || !key) throw new Error("CONTENT_SYSTEM_URL and CONTENT_SYSTEM_KEY must be set");

  const res = await fetch(`${url.replace(/\/$/, "")}/worker-triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ source: "claude_code", digests }),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { seen: {} };
  }
}

function saveState(state) {
  // Keep the file from growing without bound as sessions accumulate.
  const entries = Object.entries(state.seen);
  if (entries.length > 5000) {
    state.seen = Object.fromEntries(entries.slice(-3000));
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}



// Exported so the calibration harness (eval/calibrate-cc.mjs) and unit tests can exercise the
// filter directly. Threshold choices should be made against Josh's own corpus, not assumed.
export { assess, buildDigest, DECISION_MARKERS, findSessions, readSession, saveState };

// Only run when invoked directly, so importing the filter does not start a send.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`cc-agent failed: ${err.message}`);
    process.exit(1);
  });
}
