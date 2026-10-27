#!/usr/bin/env node
/**
 * Write the build stamp the hosted connector cannot work out for itself.
 *
 *   node scripts/stamp-build.mjs        # write mcp-server/build.json from HEAD
 *
 * RUN THIS BEFORE EVERY DEPLOY. The edge runtime has no git and no repository — it receives a
 * bundle of files — so unless the commit is written in beforehand, the connector can never say
 * which code is answering. That was the state until 27 October, and it is why "we fixed that" had
 * to be taken on trust: two features shipped inert and nothing anyone could read would have said
 * so.
 *
 * The file is deliberately NOT committed (.gitignore). A stamp in git is wrong the moment the next
 * commit lands, and a confidently wrong version number is worse than an honest "unknown" — which
 * is what a clone falls back to via git, and what build-stamp.mjs reports when neither can answer.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = `${REPO}/mcp-server/build.json`;

const git = (args) =>
  execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" })
    .trim();

let commit;
try {
  commit = git(["rev-parse", "--short", "HEAD"]);
} catch {
  console.error("No git here, so there is no commit to stamp. Nothing written.");
  process.exit(2);
}

const dirty = (() => {
  try {
    return git(["status", "--porcelain"]).length > 0;
  } catch {
    return false;
  }
})();

const stamp = {
  commit,
  built_at: new Date().toISOString(),
  ...(dirty && { uncommitted_changes: true }),
};

writeFileSync(OUT, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`Stamped ${commit}${dirty ? " (with uncommitted changes)" : ""} -> mcp-server/build.json`);
if (dirty) {
  console.log(
    "Note: the working tree is dirty, so this stamp names a commit that is not what will run.\n" +
      "That is recorded in the stamp rather than hidden, but committing first is better.",
  );
}
