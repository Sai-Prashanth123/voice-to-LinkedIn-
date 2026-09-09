/**
 * The content system over HTTP, so it can be reached from anywhere.
 *
 * WHY HERE AND NOT IN THE DESK
 *
 * The obvious host was a route in the Next app: it is already deployed, already has a public URL,
 * already has a custom domain. Two things argued against it and both are about blast radius.
 *
 * The desk talks to Postgres AS THE SIGNED-IN USER and has deliberately never held an
 * administrative key. The tools cannot reach Postgres without one, so hosting them there would have
 * put a privileged key into the desk's environment and quietly ended that property.
 *
 * And every request to the desk passes through middleware.ts, which redirects anything without a
 * session cookie to /login. An MCP client has no cookie, so the route would have needed an
 * exemption carved into the one file whose comments describe a past bug where that gate failed
 * open. Carving a hole in a fail-closed door to let a token through is how the next such bug gets
 * written.
 *
 * Here, the service key is already ambient, there is no cookie gate to weaken, and the endpoint
 * deploys and rolls back on its own.
 *
 * WHY THE TOOLS ARE UNCHANGED
 *
 * They are Node modules; this is Deno. The import map in deno.json maps `zod` and the MCP SDK to
 * their npm equivalents, so mcp-server/ is read verbatim rather than ported. A port would have been
 * a second copy of 24 tools, and every pair of near-identical things in this build has eventually
 * disagreed.
 *
 * verify_jwt is OFF for this function, because it carries its own auth: an MCP client sends
 * `Authorization: Bearer <mcp token>`, and a Supabase JWT check would reject exactly the header the
 * protocol uses. auth.mjs fails closed when no token is configured.
 */

import { describe, handleMcpRequest } from "../../../mcp-server/http.mjs";

/**
 * The tools reach Postgres with CONTENT_MCP_KEY, which is what mcp-server/.env holds on a laptop
 * and is not a name Supabase sets here. Rather than store the same key twice under two names, the
 * service role is used when it is absent.
 *
 * That is the same key mcp-server/.env holds today anyway — its header explains at length why, and
 * that the scoped role from migration 0028 exists in the database and cannot be reached until the
 * organisation is on Pro. Written as a fallback rather than a hardcode, so minting the scoped key
 * and setting it here is all that is needed to narrow this later.
 */
function environment(): Record<string, string> {
  const env = Deno.env.toObject();
  if (!env.CONTENT_MCP_KEY) {
    env.CONTENT_MCP_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  }
  return env;
}

Deno.serve(async (req: Request) => {
  // A person who opens the URL in a browser gets a sentence, not a protocol error.
  if (req.method === "GET" && !req.headers.get("authorization")) return describe();

  return await handleMcpRequest(req, { env: environment() });
});
