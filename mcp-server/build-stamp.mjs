/**
 * Which build is answering. The question nobody could answer, which is how three rounds happened.
 *
 * WHY THIS EXISTS
 *
 * When we told Josh something was fixed, he had no way to check. There is no version anywhere in
 * the product: not in system_status, not in the connector, not in any reply. So "is this live?"
 * was a matter of trust, and on 27 October it turned out that trust had been misplaced twice —
 * writer_handle and tasteNotes were both deployed and both inert, and nothing he or we could read
 * would have said so.
 *
 * The two surfaces know different things, and neither knows the other's:
 *
 *   - A CLONE has git. `git rev-parse` tells it exactly what it is running.
 *   - THE HOSTED CONNECTOR has no git and no repository — it is a tarball in an edge runtime. The
 *     commit has to be written in before it is deployed, or it is unknowable there.
 *
 * So: a stamp file written at deploy time, with git as the fallback for a clone that has not been
 * stamped. Where neither can answer, this says so rather than guessing — a wrong version number is
 * worse than no version number, because it answers the question falsely.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

/** What the deploy wrote in. Absent in a plain clone, which is expected and not an error. */
function stamped() {
  try {
    const raw = JSON.parse(readFileSync(`${HERE}/build.json`, "utf8"));
    if (!raw?.commit) return null;
    return { commit: String(raw.commit), built_at: raw.built_at ?? null, source: "stamp" };
  } catch {
    return null;
  }
}

/** What a clone is actually on. Null without git, a tarball, or git off PATH. */
function fromGit() {
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
      encoding: "utf8",
    }).trim();
    if (!commit) return null;
    let dirty = false;
    try {
      dirty = execFileSync("git", ["status", "--porcelain"], {
        cwd: REPO,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
        encoding: "utf8",
      }).trim().length > 0;
    } catch {
      // Knowing the commit and not whether it is clean is still worth saying.
    }
    return { commit, built_at: null, source: "git", ...(dirty && { uncommitted_changes: true }) };
  } catch {
    return null;
  }
}

/**
 * @returns `{ commit, built_at, source }`, or `{ commit: null, source: "unknown" }` with a reason.
 *          Never throws and never guesses: an unanswerable question is answered as unanswerable.
 */
export function buildStamp() {
  return stamped() ?? fromGit() ?? {
    commit: null,
    built_at: null,
    source: "unknown",
    means: "This build carries no stamp and has no git to ask, so which code is answering cannot "
      + "be established. Run scripts/stamp-build.mjs before deploying.",
  };
}

/** Just the commit, for callers that only want the one field. */
export function buildCommit() {
  return buildStamp().commit;
}
