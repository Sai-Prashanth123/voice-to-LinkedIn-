#!/usr/bin/env node
/**
 * Ship to the connector: stamp, deploy, restore. One command, because two of the three get
 * forgotten.
 *
 *   node scripts/deploy.mjs                    # cc-submit, mcp, worker-dispatch
 *   node scripts/deploy.mjs worker-select      # or name the functions
 *
 * WHY THIS IS A SCRIPT AND NOT THREE INSTRUCTIONS
 *
 * Josh has never used a clone. Every session he has run went through the hosted connector, which
 * serves mcp-server/ through supabase/functions/mcp. So `git push` changes nothing for him and the
 * deploy is the half that reaches him — a fact that lived in one person's head until 27 October,
 * when two features were pushed, deployed, live and completely inert, and nothing anybody could
 * read would have said which code was answering.
 *
 * The stamp is what makes that readable, and it only works if it is written BEFORE the bundle is
 * built and taken out again afterwards:
 *
 *   - written before, because an edge bundle carries the import graph and nothing else, and the
 *     runtime there has no git to ask;
 *   - taken out after, because a commit hash committed to git is wrong as soon as the next commit
 *     lands, and a confidently wrong version is worse than an honest "unknown".
 *
 * Doing that by hand is two chances to forget. This is none.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const INFO = `${REPO}/mcp-server/build-info.mjs`;

const DEFAULT_FUNCTIONS = ["cc-submit", "mcp", "worker-dispatch"];
const functions = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = functions.length > 0 ? functions : DEFAULT_FUNCTIONS;

const git = (args) =>
  execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" })
    .trim();

let commit;
try {
  commit = git(["rev-parse", "--short", "HEAD"]);
} catch {
  console.error("No git here, so there is no commit to stamp. Refusing to deploy unstamped.");
  process.exit(2);
}

const dirty = (() => {
  try {
    return git(["status", "--porcelain"]).length > 0;
  } catch {
    return false;
  }
})();

if (dirty) {
  console.log(
    `The working tree is dirty, so ${commit} is not exactly what will run.\n` +
      "Recording that in the stamp rather than hiding it. Committing first is better.\n",
  );
}

const stamp = {
  commit,
  built_at: new Date().toISOString(),
  ...(dirty && { uncommitted_changes: true }),
};

const header =
  "// Written by scripts/deploy.mjs immediately before a deploy and restored immediately after.\n" +
  "// If you are reading a real commit here in git, the restore did not happen — see that script.\n";

function restore() {
  try {
    git(["checkout", "--", "mcp-server/build-info.mjs"]);
    console.log("Restored mcp-server/build-info.mjs to null.");
  } catch (err) {
    console.error(
      `COULD NOT RESTORE mcp-server/build-info.mjs (${err?.message ?? err}).\n` +
        "Run `git checkout -- mcp-server/build-info.mjs` before committing, or a stale stamp " +
        "goes into git.",
    );
  }
}

writeFileSync(INFO, `${header}export const BUILD = ${JSON.stringify(stamp, null, 2)};\n`);
console.log(`Stamped ${commit}. Deploying ${targets.join(", ")} ...\n`);

try {
  execFileSync("npx", ["supabase", "functions", "deploy", ...targets], {
    cwd: REPO,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  console.log(`\nDeployed ${targets.join(", ")} at ${commit}.`);
} catch (err) {
  console.error(`\nDeploy failed: ${err?.message ?? err}`);
  restore();
  process.exit(1);
}

restore();
console.log(
  "\nCheck it landed: system_status should report build.commit = " + commit + ".\n" +
    'If it says "unknown", the stamp did not travel and the deploy did not do what it claims.',
);
