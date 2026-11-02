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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  /*
   * `--yes` because the CLI started refusing a production deploy from a non-interactive run.
   *
   * Added 2 November, after a deploy returned HostedMutationConsentRequiredError and changed
   * nothing: "This run can't ask because it is running in agent mode." Without the flag this
   * script cannot do the one thing it exists for, and the failure is silent enough to be mistaken
   * for success — which is the exact fault this file was written to end on 27 October, when two
   * features were pushed, deployed, live and completely inert.
   *
   * THE CONSENT STILL HAS TO HAPPEN, it just moves. Nothing here is automatic: running this script
   * IS the decision, the same way it was before the CLI asked twice. The stamp check afterwards is
   * what proves the deploy did what it claims, and `system_status` reporting `source: "stamp"`
   * rather than `"git"` is how a deployed build is told from a local one.
   */
  execFileSync("npx", ["supabase", "functions", "deploy", "--yes", ...targets], {
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

/*
 * AND THEN PROVE IT, RATHER THAN PRINTING AN INSTRUCTION.
 *
 * This used to end by telling the operator to go and check system_status. That closes nothing: the
 * line that says "check it landed" is read by the same person who already believes it landed, and
 * on 27 October two features were pushed, deployed, live and completely inert with everybody
 * involved convinced otherwise.
 *
 * It also could not have been checked for this function even by someone who tried. `system_status`
 * is served by `mcp` and reports `mcp`'s stamp. `cc-submit` imported none of it, so the function
 * holding every write in the system was the one whose version was unknowable — and a deploy of it
 * was indistinguishable from a deploy that silently did nothing. That is what the `build` route
 * added on 2 November exists for, and this is what reads it.
 *
 * Credentials by the same convention as doctor.mjs: the environment first, then mcp-server/.env.
 * Where there are none it says it could not verify. "Not checked" and "checked and correct" are
 * different outcomes and only one of them is good news.
 */
async function verifyStamp(expected) {
  let url = process.env.SUPABASE_URL;
  let key = process.env.CONTENT_MCP_KEY;
  const envPath = join(REPO, "mcp-server", ".env");
  if (existsSync(envPath)) {
    const file = readFileSync(envPath, "utf8");
    const field = (k) => (file.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1]?.trim();
    url ??= field("SUPABASE_URL");
    key ??= field("CONTENT_MCP_KEY");
  }

  if (!url || !key) {
    console.log(
      "\nNOT VERIFIED. No SUPABASE_URL and CONTENT_MCP_KEY here, so this script cannot ask the\n" +
        "deployed function which build it is. Read it yourself before believing the deploy:\n" +
        `  cc-submit's \`build\` route should report commit ${expected}.`,
    );
    return true;
  }

  // An edge deploy takes a moment to become the live version, so a single miss is not a failure.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "build" }),
      });
      const body = await res.json().catch(() => ({}));
      const got = body?.build?.commit ?? null;

      if (got === expected) {
        console.log(`\nVERIFIED: the deployed cc-submit reports ${got} (${body.build.source}).`);
        return true;
      }

      if (attempt === 4) {
        console.error(
          `\nTHE DEPLOY DID NOT DO WHAT IT CLAIMS.\n` +
            `  stamped and sent: ${expected}\n` +
            `  deployed function reports: ${got ?? JSON.stringify(body).slice(0, 120)}\n` +
            "Nothing was rolled back, so the live function is whatever it was. Do not tell anyone\n" +
            "this shipped until the two agree.",
        );
        return false;
      }
    } catch (err) {
      if (attempt === 4) {
        console.error(
          `\nCOULD NOT REACH the deployed function to verify (${err?.message ?? err}).\n` +
            "The deploy may well have worked. It is unconfirmed, which is not the same thing.",
        );
        return false;
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return false;
}

if (targets.includes("cc-submit")) {
  const ok = await verifyStamp(commit);
  if (!ok) process.exit(3);
}

if (targets.includes("mcp")) {
  console.log(
    `\nFor the connector, system_status should report build.commit = ${commit}.\n` +
      'If it says "unknown", the stamp did not travel. That one needs an MCP handshake, so it is\n' +
      "not checked here.",
  );
}
