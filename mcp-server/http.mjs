/**
 * The same 24 tools, over HTTP.
 *
 * WHY THIS EXISTS
 *
 * A stdio server has to be a file on the machine that runs it. That is what stdio means, and it is
 * why "make it available to everyone" could not be answered by any amount of configuration: there
 * was nothing to connect to. This is the thing to connect to.
 *
 * WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
 *
 * Not the tools. server.mjs builds them for both doors, so a change to how a failure surfaces
 * cannot apply to one and not the other. What changes is everything around them: who may call,
 * what they may call, and whether anyone can tell afterwards.
 *
 * THE HONEST LIMIT
 *
 * Two tokens scope what a LEGITIMATE holder may do. Neither is tenancy. Behind both sits one
 * database, one library, one Telegram chat and 27 policies asking "are you signed in" rather than
 * "is this yours" — so a leaked write token reaches the whole system, and a leaked read token
 * reads all of it. This file makes remote access possible and audited. It does not make it
 * multi-user, and nothing here should be read as though it did.
 *
 * WHY EVERY CALL IS LOGGED
 *
 * stdio has never had an audit trail and never needed one — the caller was the person at the
 * keyboard. On a URL, "which tool ran, on whose token, and did it work" is the only way to answer
 * what happened, and the moment to add it is before the first stranger connects rather than after.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createDb } from "./db.mjs";
import { tools } from "./tools/index.mjs";
import { build } from "./server.mjs";
import { authorise, toolsForScope } from "./auth.mjs";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A JSON-RPC shaped refusal.
 *
 * MCP clients parse the body before they look at the status, so a bare 401 with an HTML body reads
 * to them as a broken server rather than a rejected token. -32001 is the reserved range for
 * application errors.
 */
function rpcError(status, message) {
  return jsonResponse(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    status,
  );
}

/**
 * Handle one MCP request.
 *
 * @param request  a Web Request — works in a Next route handler, Deno, Bun or a Worker
 * @param options  { env } so a host can pass its own environment rather than process.env
 * @returns a Web Response
 */
export async function handleMcpRequest(request, options = {}) {
  const env = options.env ?? process.env;

  const auth = authorise(request.headers.get("authorization"), env);
  if (!auth.ok) return rpcError(auth.status, auth.error);

  const url = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.CONTENT_MCP_KEY ?? "";
  if (!url || !key) {
    return rpcError(503, "The server is not configured: SUPABASE_URL and CONTENT_MCP_KEY are required.");
  }

  const db = createDb({ url, key });
  const context = { db, url };

  // The audit row is written on a best-effort basis and never blocks the answer. A logging failure
  // must not turn a working tool call into an error — but it is reported to the host's console, so
  // a silently unlogged server is visible rather than assumed.
  const audit = (name, ok, ms) => {
    db.insert("system_events", {
      kind: "mcp_http_call",
      severity: ok ? "info" : "warn",
      detail: { tool: name, scope: auth.scope, ok, ms },
    }).catch((err) => console.error(`mcp audit failed: ${err?.message ?? err}`));
  };

  const server = build(context, toolsForScope(tools, auth.scope), audit);

  // Stateless: a new transport per request, no session id, no event store. Vercel and every other
  // serverless host may route the next request to a different instance, so a session held in
  // memory would work in development and fail intermittently in production — the worst shape of
  // bug this build keeps trying to avoid.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return await transport.handleRequest(request);
}

/**
 * A plain description of the door, for a person who opens the URL in a browser.
 *
 * Deliberately says nothing about what is behind it beyond the tool count: an unauthenticated
 * reader is not owed the tool list, and naming the moments table to a stranger is free
 * reconnaissance.
 */
export function describe() {
  return jsonResponse({
    name: "content-system",
    transport: "streamable-http",
    tools: tools.length,
    auth: "Authorization: Bearer <token>",
    note: "This endpoint speaks MCP. Point an MCP client at it rather than a browser.",
  }, 200);
}
