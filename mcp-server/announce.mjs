/**
 * Say which surface this is, and what it is running on. Once, at startup, and never in the way.
 *
 * WHY
 *
 * `start_post` returned HTTP 401 from a cloned repository for weeks and nobody knew, because
 * nothing could tell the two surfaces apart. `http.mjs` logs an `mcp_http_call` for every hosted
 * call. The local stdio server logged nothing. So "the clone has never been run" was not something
 * anyone could discover — it was an absence of evidence that looked exactly like an absence of a
 * problem, which is this project's whole defect class in one sentence.
 *
 * The question it answers is the one that matters when a system works on one machine and not
 * another: which transport, which Node, which commit.
 *
 * THREE RULES, because a diagnostic that breaks the thing it measures is worse than none.
 *
 *   1. It never blocks a long-lived caller. The stdio server is serving before this resolves.
 *   2. It never throws. A failure here is silent by design — the point is to add information, and a
 *      server that will not start because it could not file a log is a worse fault than the one
 *      being investigated.
 *
 *      BUT IT RETURNS THE PROMISE, and a short-lived caller must await it. Found immediately:
 *      `doctor.mjs` called this and then `process.exit()`, which tears down the pending request, so
 *      the first run filed nothing and reported success. index.mjs already carries a comment about
 *      that exact trap ("it tears libuv down while the fetch handle is still closing"). A
 *      diagnostic that silently records nothing is the fault it was written to catch, so: a server
 *      ignores the promise, a script awaits it.
 *   3. It sends nothing personal. No working directory, no username, no home path, no key. A `cwd`
 *      would carry his username; the question does not need it, so it is not collected.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The commit a clone is actually on, which is the other half of "works on my machine". */
function commit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: dirname(dirname(fileURLToPath(import.meta.url))),
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
      encoding: "utf8",
    }).trim();
  } catch {
    // No git, a tarball, or git not on PATH. Not knowing is fine; guessing is not.
    return null;
  }
}

/**
 * @param transport "stdio" for the local server, "doctor" for scripts/doctor.mjs
 * @param tools how many registered, so a truncated registry is visible
 */
export function announce({ url, key, transport, tools = null }) {
  if (!url || !key) return Promise.resolve();

  const payload = {
    kind: "client_start",
    transport,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    commit: commit(),
    tools,
  };

  // Swallowed, and RETURNED. A long-lived caller may drop it; a script that exits must await it.
  return fetch(`${url}/functions/v1/cc-submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
