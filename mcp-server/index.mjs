#!/usr/bin/env node
/**
 * content-system-mcp — the doorway between Claude Code and the content system (task 1.1).
 *
 * WHY THIS EXISTS
 *
 * Edge Functions run in Supabase's cloud. Claude Code runs on Josh's laptop. The cloud cannot call
 * the laptop, so the obvious design — a `claude-code` provider inside llm.ts — would leave a cloud
 * function blocking on a machine it has no route to. The laptop pulls instead: it asks what needs
 * writing, writes it, and posts the result back. This server is what it asks.
 *
 * WHAT IT IS NOT
 *
 * Not an admin channel. It holds one scoped key (task 1.4) with no delete rights anywhere, so the
 * worst a confused model can do is add a draft nobody asked for — which Josh then declines, exactly
 * as he would any other draft. Nothing here can publish: that still needs his approval, and the
 * database refuses to store a published post without it.
 *
 * Usage:
 *   node index.mjs           # serve over stdio — how Claude Code starts it
 *   node index.mjs --check   # verify credentials and connectivity, print, exit
 *   node index.mjs --tools   # list registered tools and exit
 *   node index.mjs --capabilities  # tools, prompts and resources; proves it all registers
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadEnv, note } from "./env.mjs";
import { createDb } from "./db.mjs";
import { tools, assertUniqueNames } from "./tools/index.mjs";
import { build, NAME, VERSION } from "./server.mjs";
import { annotationsFor } from "./auth.mjs";
import { promptsFor } from "./prompts.mjs";
import { resourcesFor } from "./resources.mjs";


async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--help") || args.has("-h")) {
    note("Usage: node index.mjs [--check | --tools | --capabilities]");
    return 0;
  }

  if (args.has("--tools")) {
    assertUniqueNames(tools);
    note(`${tools.length} tool${tools.length === 1 ? "" : "s"}:`);
    for (const t of tools) {
      const scope = annotationsFor(t.name).readOnlyHint ? "read " : "WRITE";
      const where = t.localOnly ? " (this machine only)" : "";
      note(`  ${scope}  ${t.name.padEnd(24)} ${t.config.title ?? ""}${where}`);
    }
    return 0;
  }

  /*
   * What this server offers beyond tools.
   *
   * --tools answered "what can it do" for two thirds of one capability. Prompts and resources are
   * registered inside build(), which needs credentials, so neither shows up in a flag that
   * deliberately runs without them — and for a while the only way to know whether a prompt had
   * registered was to connect a client and look.
   */
  if (args.has("--capabilities")) {
    const env = loadEnv();
    const context = { db: createDb(env), url: env.url };

    const prompts = promptsFor(context);
    const resources = resourcesFor(context);

    note(`tools      ${tools.length} (${tools.filter((t) => t.localOnly).length} local-only)`);
    note(`prompts    ${prompts.length}`);
    for (const p of prompts) {
      const params = Object.keys(p.config.argsSchema ?? {}).join(", ");
      note(`  ${p.name.padEnd(20)} ${params}`);
    }
    note(`resources  ${resources.length}`);
    for (const r of resources) {
      const uri = typeof r.uri === "string" ? r.uri : r.uri.uriTemplate.toString();
      const listed = typeof r.uri === "string" || r.uri.listCallback ? "listed" : "template only";
      note(`  ${uri.padEnd(22)} ${listed}`);
    }

    // Proves the whole thing assembles, which is the question this flag is really asked.
    build(context, tools);
    note("\nbuild() succeeded — everything registers.");
    return 0;
  }

  const env = loadEnv();
  const db = createDb(env);
  const context = { db, url: env.url };

  if (args.has("--check")) {
    note(`Project   ${env.url}`);
    note(`Key       ${env.key.slice(0, 8)}… (${env.key.length} chars)`);
    let granted = false;
    try {
      const started = Date.now();
      const result = await db.ping();
      granted = result.granted;
      note(`Database  reachable, ${Date.now() - started}ms`);
      note(granted
        ? "Grants    the role can read the idea bank"
        : "Grants    NONE YET — expected until task 1.4 creates the scoped role");
    } catch (err) {
      note(`Database  ${err.message}`);
      return 1;
    }
    assertUniqueNames(tools);
    note(`Tools     ${tools.length} registered: ${tools.map((t) => t.name).join(", ")}`);
    note(granted
      ? "\nReady."
      : "\nConnected. Read tools will return a permission error until task 1.4 grants the role.");
    return 0;
  }

  // Serving: stdout belongs to the transport from here on. Anything printed to it corrupts the
  // protocol, which is why note() writes to stderr and every log in this package uses it.
  await build(context, tools).connect(new StdioServerTransport());
  return null; // stays alive on the transport
}

const code = await main();
// Not process.exit(): it tears libuv down while the fetch handle is still closing, which trips
// an assertion on Windows. Setting exitCode lets node drain and leave on its own.
if (code !== null) process.exitCode = code;
