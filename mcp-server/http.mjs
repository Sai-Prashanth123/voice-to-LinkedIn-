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
import { SCANNER_FILES } from "./generated/scanner-files.mjs";

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

  /*
   * The token may arrive in the header OR in the query string, and the second is a concession
   * rather than a preference.
   *
   * claude.ai's custom-connector dialog takes a name and a URL. It expects a server that speaks
   * OAuth 2.1 and gives no field for a static header, so a header-only server simply cannot be
   * added there — it answers 401 and the connector fails with nothing the person can do about it.
   *
   * WHAT THIS COSTS, PLAINLY
   *
   * A token in a URL is a token in browser history, in the connector's stored configuration, and
   * in whatever proxy logs the request line. A header is none of those. So the header is checked
   * FIRST and is the documented way in; the query string exists so one specific client can connect
   * at all, and the right long-term answer is OAuth rather than this.
   */
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token") ?? url.searchParams.get("key");

  const auth = authorise(request.headers.get("authorization") ?? fromQuery, env);
  if (!auth.ok) return rpcError(auth.status, auth.error);

  const project = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.CONTENT_MCP_KEY ?? "";
  if (!project || !key) {
    return rpcError(503, "The server is not configured: SUPABASE_URL and CONTENT_MCP_KEY are required.");
  }

  const db = createDb({ url: project, key });

  // setup_session_tracking hands back an install command, and that command needs the connector's
  // address and a token to report with. The caller already holds this token — it just used it — so
  // echoing it back discloses nothing new. A read token is never echoed: it could not report anyway.
  const presented = String(request.headers.get("authorization") ?? fromQuery ?? "")
    .replace(/^Bearer\s+/i, "").trim();
  const context = {
    db,
    url: project,
    endpoint: `${project}/functions/v1/mcp`,
    token: auth.scope === "write" ? presented : null,
  };

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

  /*
   * Local-only tools are dropped from the remote surface.
   *
   * scan_sessions reads ~/.claude/projects. Over stdio that is the caller's own machine, which is
   * the entire point of it. Here it would read this container's filesystem and answer "no Claude
   * Code sessions, nothing to do" every single time — a tool that looks like it worked and did
   * nothing, which is the failure this build keeps removing rather than adding.
   *
   * Hidden rather than left to fail politely, because a model shown a tool will use it, and the
   * empty answer it gets back is indistinguishable from a genuine quiet result.
   */
  const reachable = toolsForScope(tools, auth.scope).filter((t) => !t.localOnly);

  const server = build(context, reachable, audit);

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

/* ── Session tracking (4.4) ───────────────────────────────────────────────── */

const MAX_DIGESTS = 10;
const MAX_DIGEST_CHARS = 8000;

/**
 * The two plain HTTP routes the session scanner uses. Returns null for anything else, so the MCP
 * handler still owns every other request.
 *
 *   GET  …/mcp/scanner/<file>   the scanner, for the install command. Public: it holds no secret.
 *   POST …/mcp/sessions         a scanner reporting in. Write token only.
 *
 * WHY A ROUTE AND NOT A TOOL
 *
 * The scanner runs from a scheduler at 3am, with no model and no MCP client in sight. It needs one
 * POST, not a protocol handshake.
 *
 * WHY EVERY RUN IS RECORDED, INCLUDING EMPTY ONES
 *
 * This input was silent for a month and nobody could tell a broken reader from a quiet week, because
 * a quiet week also sends nothing. A `session_scan` event per run is what tells them apart.
 */
export async function handleSessionRoutes(request, options = {}) {
  const env = options.env ?? process.env;
  const url = new URL(request.url);

  const file = url.pathname.match(/\/scanner\/([a-z]+\.mjs)$/)?.[1];
  if (request.method === "GET" && file) {
    const body = SCANNER_FILES[file];
    if (!body) return new Response("not found", { status: 404 });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (!/\/sessions\/?$/.test(url.pathname)) return null;
  if (request.method !== "POST") return rpcError(405, "POST only.");

  const auth = authorise(request.headers.get("authorization"), env);
  if (!auth.ok) return rpcError(auth.status, auth.error);
  if (auth.scope !== "write") {
    return rpcError(403, "Reporting sessions writes to the idea bank, so it needs the write token.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, "The body is not JSON.");
  }

  const digests = (Array.isArray(body?.digests) ? body.digests : [])
    .filter((d) => d && typeof d.session_id === "string" && typeof d.digest === "string")
    .slice(0, MAX_DIGESTS)
    .map((d) => ({
      session_id: d.session_id.slice(0, 200),
      digest: d.digest.slice(0, MAX_DIGEST_CHARS),
      started_at: typeof d.started_at === "string" ? d.started_at : undefined,
    }));

  const project = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.CONTENT_MCP_KEY ?? "";
  if (!project || !serviceKey) return rpcError(503, "The server is not configured.");

  // worker-triage's ingest, not a direct insert: it skips sessions already in the bank, and its
  // sweep applies the second filter and the daily cap (4.4.3) that a direct write would skip.
  let queued = 0;
  let triageError = null;
  if (digests.length > 0) {
    try {
      const res = await fetch(`${project}/functions/v1/worker-triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ source: "claude_code", digests }),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) triageError = `worker-triage answered ${res.status}`;
      queued = Number(answer.queued ?? 0);
    } catch (err) {
      triageError = err?.message ?? String(err);
    }
  }

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const detail = {
    machine: String(body?.machine ?? "unknown").slice(0, 120),
    platform: String(body?.platform ?? "").slice(0, 20),
    available: body?.available !== false,
    sessions_changed: num(body?.sessions_changed),
    passed: digests.length,
    set_aside: num(body?.set_aside),
    held_back_by_cap: num(body?.held_back_by_cap),
    bar: num(body?.bar),
    calibrated: body?.calibrated === true,
    highest_score: num(body?.highest_score),
    session_ids: digests.map((d) => d.session_id),
    queued,
    error: triageError,
  };

  const db = createDb({ url: project, key: serviceKey });
  await db.insert("system_events", {
    kind: "session_scan",
    severity: triageError ? "warn" : "info",
    detail,
  }, { returning: false }).catch((err) => console.error(`session_scan event failed: ${err?.message ?? err}`));

  if (triageError) return rpcError(502, `The digests could not be queued: ${triageError}`);
  return jsonResponse({ ok: true, received: digests.length, queued }, 200);
}
