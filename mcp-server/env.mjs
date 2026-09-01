/**
 * Credentials for the MCP server.
 *
 * Deliberately NOT the service-role key. That key bypasses row-level security entirely, and the
 * whole point of exposing this system to Claude Code is that the model gets a door, not the keys to
 * the building. Task 1.4 creates a scoped Postgres role — select on the bank and library, insert on
 * drafts and verdicts, no delete anywhere — and CONTENT_MCP_KEY is that role's key.
 *
 * Until 1.4 lands, whatever key is supplied is the key that is used. This file does not police
 * which one; the database does, which is the only place that can.
 *
 * Same loader shape as eval/env.mjs on purpose: a real environment variable always wins, so CI and
 * the Claude Code process can set these without a file existing at all.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Anything logged goes to stderr. stdout is the MCP transport and must carry only protocol. */
export function note(...args) {
  console.error(...args);
}

export function loadEnv({ exitOnMissing = true } = {}) {
  let lines = [];
  try {
    lines = readFileSync(join(HERE, ".env"), "utf8").split("\n");
  } catch {
    // No file is fine — the variables may already be in the environment.
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.CONTENT_MCP_KEY;

  if (!url || !key) {
    const missing = [!url && "SUPABASE_URL", !key && "CONTENT_MCP_KEY"].filter(Boolean).join(" and ");
    const message =
      `Missing ${missing}.\n` +
      `Copy mcp-server/.env.example to mcp-server/.env and fill it in, or set them in the\n` +
      `environment. Claude Code can pass them through the "env" block in .mcp.json.`;
    if (!exitOnMissing) return { ok: false, error: message };
    note(message);
    process.exit(2);
  }

  return { ok: true, url: url.replace(/\/+$/, ""), key };
}
