/**
 * Claude Code session tracking, set up and watched through the connector (4.4).
 *
 * The connector runs on a server and cannot open ~/.claude/projects on anybody's laptop — that is
 * why scan_sessions is local-only. What it CAN do is hand out the scanner and receive what the
 * scanner sends. So:
 *
 *   setup_session_tracking    the commands that download the scanner and schedule it on this machine
 *   session_tracking_status   which machines have reported in, when, and what reached the idea bank
 *
 * The scanner itself is cc-agent/scanner.mjs, served by http.mjs. Its reports land as
 * `session_scan` events, one per run, including the runs that found nothing — the only way to tell a
 * quiet week from a broken reader.
 */

import { z } from "zod";

const PLACEHOLDER = "<YOUR_MCP_WRITE_TOKEN>";

function commandsFor(platform, endpoint, token) {
  const files = ["scanner.mjs", "index.mjs"];
  if (platform === "windows") {
    return [
      `$d = "$env:USERPROFILE\\.claude\\content-system\\download"; New-Item -ItemType Directory -Force $d | Out-Null`,
      ...files.map((f) => `Invoke-WebRequest -UseBasicParsing "${endpoint}/scanner/${f}" -OutFile "$d\\${f}"`),
      `node "$d\\scanner.mjs" --install --url "${endpoint}" --token "${token}"`,
    ];
  }
  return [
    `d="$HOME/.claude/content-system/download" && mkdir -p "$d"`,
    ...files.map((f) => `curl -fsSL "${endpoint}/scanner/${f}" -o "$d/${f}"`),
    `node "$d/scanner.mjs" --install --url "${endpoint}" --token "${token}"`,
  ];
}

export const trackingTools = [
  {
    name: "setup_session_tracking",
    config: {
      title: "Track this machine's Claude Code sessions",
      description:
        "Set up automatic reading of Claude Code sessions on the machine the person is using. " +
        "Returns shell commands that download a small scanner from this connector and schedule it " +
        "every 2 hours. The scanner reads ~/.claude/projects locally, sets its own bar from that " +
        "machine's last 30 days, and sends only a short digest of the rare unusual session (their " +
        "words and what was decided — never code, tool output or the logs). Every run reports in, " +
        "so session_tracking_status shows the machine even on a quiet day. " +
        "IN CLAUDE CODE: run the commands yourself in the shell for the given platform, then call " +
        "session_tracking_status. IN CLAUDE DESKTOP OR CLAUDE.AI there is no shell: show the " +
        "commands and ask the person to paste them into a terminal on the computer they use " +
        "Claude Code on. Needs Node 18 or newer on that machine.",
      inputSchema: {
        platform: z.enum(["windows", "mac", "linux"]).optional().describe(
          "The operating system of the machine to track. Omit to get all three.",
        ),
      },
    },

    async handler(args, context) {
      const endpoint = context.endpoint ??
        (process.env.CONTENT_SYSTEM_MCP_URL ?? `${String(context.url ?? "").replace(/\/+$/, "")}/functions/v1/mcp`);
      const token = context.token ?? process.env.MCP_WRITE_TOKEN ?? PLACEHOLDER;

      const platforms = args.platform ? [args.platform] : ["windows", "mac", "linux"];
      const commands = Object.fromEntries(
        platforms.map((p) => [p, commandsFor(p, endpoint, token)]),
      );

      return {
        shell: { windows: "PowerShell", mac: "zsh / bash", linux: "bash" },
        commands,
        token_filled_in: token !== PLACEHOLDER,
        what_it_does: [
          "Downloads scanner.mjs and index.mjs into ~/.claude/content-system/.",
          "Scores the last 30 days of sessions to choose this machine's bar (about 2 a week pass).",
          "Schedules itself every 2 hours (Task Scheduler on Windows, launchd on Mac, cron on Linux).",
          "Runs once straight away, so session_tracking_status shows the machine within a minute.",
        ],
        privacy: "Session logs never leave the machine. Only a digest of a session that clears the " +
          "bar is sent, and the server still applies its own filter and a limit of 3 new ideas a day.",
        undo: "node ~/.claude/content-system/scanner.mjs --uninstall",
        note: token === PLACEHOLDER
          ? `Replace ${PLACEHOLDER} with the connector's write token before running.`
          : "The token in these commands is the one this connection is using. Treat it as a password.",
      };
    },
  },

  {
    name: "session_tracking_status",
    config: {
      title: "Which machines are tracking Claude Code sessions",
      description:
        "Is Claude Code session tracking working? One row per machine that has reported in: when " +
        "it last ran, how many sessions it read, how many cleared its bar, and whether anything " +
        "was sent. Also lists the ideas that have reached the idea bank from Claude Code sessions. " +
        "A machine that has not reported in for more than 6 hours is marked stale — its schedule " +
        "has probably stopped.",
      inputSchema: {},
    },

    async handler(_args, context) {
      const events = await context.db.select("system_events", {
        select: "created_at,severity,detail",
        kind: "eq.session_scan",
        order: "created_at.desc",
        limit: 500,
      });

      const machines = new Map();
      for (const e of events) {
        const d = e.detail ?? {};
        const name = d.machine ?? "unknown";
        const m = machines.get(name) ?? {
          machine: name,
          platform: d.platform ?? null,
          last_run: e.created_at,
          last_result: {
            sessions_read: d.sessions_changed,
            passed_bar: d.passed,
            queued: d.queued,
            error: d.error ?? null,
          },
          bar: d.bar,
          bar_calibrated: d.calibrated ?? false,
          highest_score_last_run: d.highest_score,
          runs: 0,
          sessions_read_total: 0,
          sent_total: 0,
        };
        // The newest report may not carry a bar (an older scanner, or a hand-made report), so the
        // bar shown is the most recent one that did.
        if (m.bar == null && typeof d.bar === "number") m.bar = d.bar;
        m.runs += 1;
        m.sessions_read_total += Number(d.sessions_changed ?? 0);
        m.sent_total += Number(d.queued ?? 0);
        machines.set(name, m);
      }

      const staleAfter = Date.now() - 6 * 3600_000;
      const rows = [...machines.values()].map((m) => ({
        ...m,
        stale: new Date(m.last_run).getTime() < staleAfter,
      }));

      const ideas = (await context.db.select("moments", {
        select: "id,title,status,captured_at,source_ref,killed",
        source: "eq.claude_code",
        order: "captured_at.desc",
        limit: 50,
      })).filter((m) => !/^fx-|fixture/.test(String(m.source_ref ?? "")));

      return {
        tracking: rows.length > 0,
        machines: rows,
        ideas_from_sessions: ideas.map((m) => ({
          name: m.title ?? null,
          status: m.status,
          captured_at: m.captured_at,
          session: m.source_ref,
          killed: m.killed,
        })),
        note: rows.length === 0
          ? "No machine has reported in. Call setup_session_tracking on the machine Claude Code is used on."
          : "Most runs send nothing, which is intended: only the rare unusual session becomes an idea. " +
            "Anything sent is triaged within about 15 minutes and still needs an interview before it " +
            "can be drafted.",
      };
    },
  },
];
