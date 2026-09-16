#!/usr/bin/env node
/**
 * The Claude Code session reader, installed and fed through the MCP connection (4.4).
 *
 * WHY THIS EXISTS BESIDE install.mjs
 *
 * install.mjs needed a checkout of this repository, a service_role key pasted into a prompt, and
 * somebody to run it. Nobody did, and in a month not one real session reached the idea bank.
 *
 * The connector is already on every machine that matters and already holds a token. So the connector
 * serves this file and the reader beside it (GET /mcp/scanner/<file>), `setup_session_tracking`
 * hands Claude Code the commands, and this file puts itself on a schedule. Nothing else is installed
 * and no Supabase key ever sits on a laptop.
 *
 * WHAT LEAVES THE MACHINE
 *
 * Only what index.mjs's digest carries: the person's own words, a few assistant explanations and
 * file names, for the rare session that clears the bar. Never code, never tool output, never the
 * logs (15.4). Every run ALSO reports its counts (sessions read, how many passed, the bar), even
 * when nothing passed. Without that, a machine where the reader broke looks exactly like a quiet
 * week, which is how this input went silent for a month without anyone noticing.
 *
 *   node scanner.mjs --install --url <connector url> --token <mcp write token>
 *   node scanner.mjs --run            what the schedule calls
 *   node scanner.mjs --dry-run        show what would be sent; send nothing, save nothing
 *   node scanner.mjs --recalibrate    choose this machine's bar again
 *   node scanner.mjs --status
 *   node scanner.mjs --uninstall
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickBar, saveState, scan } from "./index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(os.homedir(), ".claude", "content-system");
const CONFIG = path.join(HOME, "config.json");
const LOG = path.join(HOME, "scan.log");
const TASK = "ThoughtPilotSessionScan";
const EVERY_HOURS = 2;
const CALIBRATION_DAYS = 30;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function log(line) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(LOG, `${stamped}\n`);
  } catch { /* a log that cannot be written must not stop the scan */ }
}

/* ── Calibration ──────────────────────────────────────────────────────────── */

async function calibrate(config) {
  log(`calibrating: scoring every session from the last ${CALIBRATION_DAYS} days`);
  const result = await scan({ lookbackDays: CALIBRATION_DAYS, ignoreSeen: true, bar: Infinity });
  const choice = pickBar(result.allScores, { spanDays: CALIBRATION_DAYS });
  config.bar = choice.bar;
  config.calibration = {
    at: new Date().toISOString(),
    calibrated: choice.calibrated,
    sessions_scored: result.allScores.length,
    reflective: choice.sample,
    why: choice.why,
  };
  writeConfig(config);
  log(`bar set to ${choice.bar}: ${choice.why}`);
  return config;
}

/* ── Sending ──────────────────────────────────────────────────────────────── */

async function report(config, body) {
  const res = await fetch(`${config.url.replace(/\/+$/, "")}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`the connector answered ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function run({ dryRun = false } = {}) {
  let config = readConfig();
  if (!config?.url || !config?.token) {
    throw new Error(`Not installed: ${CONFIG} is missing. Run --install first.`);
  }
  // Recalibrated weekly, and whenever the bar was never measured. A machine that had no reflective
  // session on install day should not keep the default forever.
  const calibratedAt = Date.parse(config.calibration?.at ?? "");
  if (typeof config.bar !== "number" || !(Date.now() - calibratedAt < 7 * 86_400_000)) {
    config = await calibrate(config);
  }

  const result = await scan({ bar: config.bar });
  const scores = result.allScores ?? [];
  const summary = {
    machine: config.machine,
    platform: process.platform,
    available: result.available,
    sessions_changed: result.changed,
    passed: result.digests.length,
    set_aside: result.skipped + result.overflow,
    held_back_by_cap: result.overflow,
    bar: config.bar,
    calibrated: config.calibration?.calibrated ?? false,
    highest_score: scores.length ? Math.max(...scores) : null,
  };

  if (dryRun) {
    console.log(JSON.stringify({
      ...summary,
      dry_run: true,
      would_send: result.digests.map((d) => ({ session_id: d.session_id, score: d.score, preview: d.digest.slice(0, 600) })),
    }, null, 2));
    return;
  }

  const answer = await report(config, { ...summary, digests: result.digests });

  // State is saved only once the server has the digests. Saving first meant a failed upload marked
  // the sessions as seen, and they were never offered again.
  if (result.state) saveState(result.state);

  config.last_run = { at: new Date().toISOString(), ...summary, queued: answer.queued ?? 0 };
  writeConfig(config);
  log(`read ${summary.sessions_changed} changed session(s), ${summary.passed} passed bar ${config.bar}, ` +
    `${answer.queued ?? 0} queued on the server`);
}

/* ── Scheduling ───────────────────────────────────────────────────────────── */

function installSchedule() {
  const node = process.execPath;
  const script = path.join(HOME, "scanner.mjs");

  if (process.platform === "win32") {
    // Through wscript with window style 0, so a console does not flash up every two hours. It must
    // WAIT for node (the final True): with False, wscript returned at once, Task Scheduler recorded
    // a clean run and ended the task, and node was killed before it read a single session.
    const vbs = path.join(HOME, "run-hidden.vbs");
    fs.writeFileSync(
      vbs,
      `CreateObject("WScript.Shell").Run """${node}"" ""${script}"" --run", 0, True\r\n`,
    );
    // Defined in XML rather than flags, because the flags cannot change the defaults that matter on a
    // laptop: a task made with plain `schtasks /SC HOURLY` does not start on battery. On the first
    // machine it was installed on, every scheduled run sat "Queued" and never ran, while
    // `Last Result: 0` made it look healthy. StartWhenAvailable catches up a run missed while the
    // lid was shut.
    const start = new Date(Date.now() + 60_000).toISOString().slice(0, 19);
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Thought Pilot: read Claude Code sessions for content ideas (4.4)</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition><Interval>PT${EVERY_HOURS}H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>wscript.exe</Command><Arguments>"${esc(vbs)}"</Arguments></Exec>
  </Actions>
</Task>
`;
    const xmlFile = path.join(HOME, "task.xml");
    // schtasks reads task XML as UTF-16; the BOM is what tells it so.
    fs.writeFileSync(xmlFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
    execFileSync("schtasks", ["/Create", "/F", "/TN", TASK, "/XML", xmlFile], { stdio: "ignore" });
    return `Windows Task Scheduler "${TASK}", every ${EVERY_HOURS} hours`;
  }

  if (process.platform === "darwin") {
    const label = "com.thoughtpilot.session-scan";
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>${script}</string><string>--run</string></array>
  <key>StartInterval</key><integer>${EVERY_HOURS * 3600}</integer>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict></plist>
`);
    try { execFileSync("launchctl", ["unload", plist], { stdio: "ignore" }); } catch { /* first install */ }
    execFileSync("launchctl", ["load", plist], { stdio: "ignore" });
    return `launchd ${label}, every ${EVERY_HOURS} hours`;
  }

  const line = `0 */${EVERY_HOURS} * * * "${node}" "${script}" --run >> "${LOG}" 2>&1 # ${TASK}`;
  let existing = "";
  try { existing = execFileSync("crontab", ["-l"], { encoding: "utf8" }); } catch { /* no crontab yet */ }
  const kept = existing.split("\n").filter((l) => l.trim() && !l.includes(TASK));
  execFileSync("crontab", ["-"], { input: [...kept, line].join("\n") + "\n" });
  return `cron, every ${EVERY_HOURS} hours`;
}

function removeSchedule() {
  if (process.platform === "win32") {
    execFileSync("schtasks", ["/Delete", "/F", "/TN", TASK], { stdio: "ignore" });
  } else if (process.platform === "darwin") {
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.thoughtpilot.session-scan.plist");
    try { execFileSync("launchctl", ["unload", plist], { stdio: "ignore" }); } catch { /* not loaded */ }
    fs.rmSync(plist, { force: true });
  } else {
    const existing = execFileSync("crontab", ["-l"], { encoding: "utf8" });
    const kept = existing.split("\n").filter((l) => l.trim() && !l.includes(TASK));
    execFileSync("crontab", ["-"], { input: kept.join("\n") + "\n" });
  }
}

function isScheduled() {
  try {
    if (process.platform === "win32") {
      execFileSync("schtasks", ["/Query", "/TN", TASK], { stdio: "ignore" });
      return true;
    }
    if (process.platform === "darwin") {
      return fs.existsSync(path.join(os.homedir(), "Library", "LaunchAgents", "com.thoughtpilot.session-scan.plist"));
    }
    return execFileSync("crontab", ["-l"], { encoding: "utf8" }).includes(TASK);
  } catch {
    return false;
  }
}

/* ── Commands ─────────────────────────────────────────────────────────────── */

async function install() {
  const url = option("url");
  const token = option("token");
  if (!url || !token) throw new Error("--install needs --url <connector url> and --token <mcp token>");

  // Copied next to the config, so the schedule does not depend on a download folder or a checkout
  // staying where it is.
  fs.mkdirSync(HOME, { recursive: true });
  for (const file of ["scanner.mjs", "index.mjs"]) {
    const from = path.join(HERE, file);
    const to = path.join(HOME, file);
    if (path.resolve(from) !== path.resolve(to)) fs.copyFileSync(from, to);
  }
  // index.mjs is an ES module; without this beside it an older Node reads it as CommonJS.
  fs.writeFileSync(path.join(HOME, "package.json"), '{ "type": "module" }\n');

  const previous = readConfig() ?? {};
  let config = { ...previous, url, token, machine: previous.machine ?? os.hostname() };
  writeConfig(config);

  config = await calibrate(config);
  const schedule = installSchedule();
  log(`scheduled: ${schedule}`);

  await run();
  console.log(`\nInstalled. ${schedule}. Bar ${config.bar} (${config.calibration.why}).`);
}

async function main() {
  if (flag("install")) return await install();
  if (flag("dry-run")) return await run({ dryRun: true });
  if (flag("recalibrate")) {
    const config = readConfig();
    if (!config) throw new Error("Not installed.");
    await calibrate(config);
    return;
  }
  if (flag("uninstall")) {
    removeSchedule();
    console.log("Schedule removed. The config and anything already sent are untouched.");
    return;
  }
  if (flag("status")) {
    const config = readConfig();
    console.log(JSON.stringify({
      installed: Boolean(config),
      scheduled: isScheduled(),
      machine: config?.machine ?? null,
      bar: config?.bar ?? null,
      calibration: config?.calibration ?? null,
      last_run: config?.last_run ?? null,
    }, null, 2));
    return;
  }
  return await run();
}

main().catch((err) => {
  log(`failed: ${err?.message ?? err}`);
  process.exit(1);
});
