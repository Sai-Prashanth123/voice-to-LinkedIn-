#!/usr/bin/env node
/**
 * Mint the two tokens the HTTP door accepts.
 *
 *   node mcp-server/mint-http-tokens.mjs           # generate, write locally, print the commands
 *   node mcp-server/mint-http-tokens.mjs --set      # generate and set them on the project too
 *
 * WHY THEY ARE WRITTEN TO A FILE RATHER THAN PRINTED
 *
 * A secret printed to a terminal is in the scrollback, in the shell history of whatever piped it,
 * and — when an agent is doing the running — in a transcript that outlives the session. This build
 * has already had one credential end up somewhere it should not have. So the tokens land in
 * mcp-server/.http-tokens, which .gitignore covers by name, readable only by the person who ran this.
 *
 * TWO TOKENS
 *
 * read  — the 17 read tools and briefs
 * write — those, plus everything that changes something
 *
 * 32 bytes from crypto.randomBytes, base64url. Long enough that guessing is not the attack, which
 * leaves losing one as the attack — hence the file, and hence rotation being one command.
 */

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, ".http-tokens");
const PROJECT = "uzqvebxcxgmseqjhfpku";

const token = () => randomBytes(32).toString("base64url");

const read = token();
const write = token();

fs.writeFileSync(
  OUT,
  `# HTTP MCP tokens. NOT in version control. Rotate by re-running this script.\n` +
    `# Generated ${new Date().toISOString()}\n` +
    `#\n` +
    `# read  reaches the read tools and briefs\n` +
    `# write reaches those plus create_draft, submit_extraction, submit_candidates,\n` +
    `#       record_gate_verdict, propose_library_change, create_visual, scan_sessions\n` +
    `#\n` +
    `# Neither is tenancy: both reach the one database this project holds.\n\n` +
    `MCP_READ_TOKEN=${read}\n` +
    `MCP_WRITE_TOKEN=${write}\n`,
  { mode: 0o600 },
);

console.error(`Written to ${OUT} (readable only by you).`);

if (process.argv.includes("--set")) {
  // Passed as arguments to the CLI, which is unavoidable — but this process's own argv is not the
  // agent transcript, and the values never reach stdout.
  execFileSync(
    "npx",
    [
      "--yes",
      "supabase@latest",
      "secrets",
      "set",
      `MCP_READ_TOKEN=${read}`,
      `MCP_WRITE_TOKEN=${write}`,
      "--project-ref",
      PROJECT,
    ],
    { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" },
  );
  console.error("Set on the project. Redeploy the mcp function for it to pick them up.");
} else {
  console.error("");
  console.error("To set them on the project:");
  console.error("  node mcp-server/mint-http-tokens.mjs --set");
}
