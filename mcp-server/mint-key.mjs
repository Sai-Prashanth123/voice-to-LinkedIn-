#!/usr/bin/env node
/**
 * Mints the scoped API key the MCP server authenticates with (task 1.4).
 *
 * WHY THIS IS A SCRIPT RATHER THAN SOMETHING ALREADY DONE
 *
 * This project uses Supabase's newer API key system, where a secret key carries a JWT template
 * naming the Postgres role it authenticates as. That is exactly what is wanted here: the key IS the
 * scope, and the scope is `content_mcp`, whose grants are in migration 0028 — read the material a
 * draft is written from, insert a draft, a gate verdict and a library proposal, and nothing else.
 *
 * Creating one needs a personal access token, which is a credential rather than a project setting.
 * It is deliberately not read out of the CLI's credential store by this script: a tool that helps
 * itself to the operator's stored credentials is a tool nobody should run.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node mint-key.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_... node mint-key.mjs --write   # also updates .env
 *
 * The token comes from https://supabase.com/dashboard/account/tokens and is not stored anywhere by
 * this script. The key it prints goes in mcp-server/.env as CONTENT_MCP_KEY.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROLE = "content_mcp";
const API = "https://api.supabase.com/v1";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  return null;
}

function projectRef() {
  // Read from .env rather than asking for it twice — the URL already names the project.
  try {
    const env = readFileSync(join(HERE, ".env"), "utf8");
    const url = (env.match(/^SUPABASE_URL=(.*)$/m) ?? [])[1]?.trim();
    const ref = (url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
    if (ref) return ref;
  } catch { /* fall through */ }
  return process.env.SUPABASE_PROJECT_REF ?? null;
}

async function api(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 300) };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${body?.message ?? body?.msg ?? res.statusText}`);
  }
  return body;
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  fail(
    "Set SUPABASE_ACCESS_TOKEN first.\n\n" +
    "  Get one at https://supabase.com/dashboard/account/tokens\n" +
    "  Then:  SUPABASE_ACCESS_TOKEN=sbp_... node mint-key.mjs --write\n\n" +
    "It is used for this one call and stored nowhere.",
  );
} else {
  const ref = projectRef();
  if (!ref) {
    fail("Could not work out the project ref. Set SUPABASE_URL in .env, or SUPABASE_PROJECT_REF.");
  } else {
    const existing = await api(token, `/projects/${ref}/api-keys`);
    const already = existing.find((k) => k.secret_jwt_template?.role === ROLE);

    let key;
    if (already) {
      console.error(`A key for ${ROLE} already exists (${already.prefix}…). Revealing it.`);
      const revealed = await api(token, `/projects/${ref}/api-keys?reveal=true`);
      key = revealed.find((k) => k.id === already.id)?.api_key;
      if (!key) fail("The key exists but could not be revealed. Check it on the dashboard.");
    } else {
      const created = await api(token, `/projects/${ref}/api-keys?reveal=true`, {
        method: "POST",
        body: JSON.stringify({
          type: "secret",
          name: "content-mcp",
          description:
            "The MCP server (mcp-server/). Scoped to the content_mcp Postgres role — reads the " +
            "idea bank and library, inserts drafts, gate verdicts and library proposals. " +
            "Cannot publish, approve, update or delete.",
          secret_jwt_template: { role: ROLE },
        }),
      });
      key = created.api_key;
      console.error(`Created a new ${ROLE} key.`);
    }

    if (key) {
      if (process.argv.includes("--write")) {
        const path = join(HERE, ".env");
        let env = "";
        try {
          env = readFileSync(path, "utf8");
        } catch { /* new file */ }
        env = /^CONTENT_MCP_KEY=.*$/m.test(env)
          ? env.replace(/^CONTENT_MCP_KEY=.*$/m, `CONTENT_MCP_KEY=${key}`)
          : `${env.trimEnd()}\nCONTENT_MCP_KEY=${key}\n`;
        writeFileSync(path, env);
        console.error(`Written to ${path}. Run: node index.mjs --check`);
      } else {
        console.error("\nAdd this to mcp-server/.env, or re-run with --write:\n");
        console.log(`CONTENT_MCP_KEY=${key}`);
      }
    }
  }
}
