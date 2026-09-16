/**
 * Building the MCP server, shared by both transports.
 *
 * index.mjs speaks stdio to a Claude Code process on this machine. http.mjs speaks Streamable HTTP
 * to anyone holding a token. They are two doors into ONE set of tools, and this is the only place
 * that turns a tool definition into a registered handler — so a change to how errors surface, or
 * how a value is rendered, cannot apply to one door and not the other.
 *
 * That mattered the moment there was a second door. Everything else in this build that had two
 * readers of one thing eventually disagreed.
 */

import { INSTRUCTIONS } from "./instructions.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DbError } from "./db.mjs";
import { assertUniqueNames } from "./tools/index.mjs";
import { annotationsFor } from "./auth.mjs";
import { promptsFor } from "./prompts.mjs";
import { resourcesFor } from "./resources.mjs";

export const NAME = "content-system";
export const VERSION = "0.1.0";

/**
 * MCP carries a tool's failure as a normal result with isError set, not as a protocol error.
 * That distinction matters: a protocol error is the server saying "I am broken", which ends the
 * exchange, while isError is a tool saying "that did not work, here is why", which the model can
 * read and act on. Almost everything that goes wrong here is the second kind.
 *
 * @param onCall optional audit hook, called with (name, ok, ms) after every invocation
 */
export function wrap(tool, context, onCall) {
  return async (args) => {
    const started = Date.now();
    try {
      const value = await tool.handler(args ?? {}, context);
      onCall?.(tool.name, true, Date.now() - started);
      return {
        content: [{
          type: "text",
          text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
        }],
      };
    } catch (err) {
      onCall?.(tool.name, false, Date.now() - started);
      const message = err instanceof DbError
        ? err.message
        : `${tool.name} failed: ${err?.message ?? String(err)}`;
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}

/**
 * @param context  { db, url } handed to every tool
 * @param list     which tools to register. The HTTP door passes a scoped subset; stdio passes all.
 * @param onCall   audit hook
 */
export function build(context, list, onCall) {
  // Instructions are read by every Claude client before the first message, which makes them the one
  // place conversational behaviour can live without anyone configuring anything. See instructions.mjs.
  const server = new McpServer({ name: NAME, version: VERSION }, { instructions: INSTRUCTIONS });

  for (const tool of assertUniqueNames(list)) {
    // Annotations are attached HERE rather than written into each tool's config, so they are
    // derived from one list instead of hand-maintained in 24 places. A client uses them to decide
    // what to auto-approve; getting one wrong means something that writes to the bank stops asking.
    server.registerTool(
      tool.name,
      { ...tool.config, annotations: { ...annotationsFor(tool.name), ...tool.config.annotations } },
      wrap(tool, context, onCall),
    );
  }

  /*
   * Prompts and resources are registered HERE, inside build(), and that placement is load-bearing.
   *
   * registerPrompt and registerResource call registerCapabilities, which throws outright after
   * connect(): "Cannot register capabilities after connecting to transport". Both callers already
   * connect after build() returns, so this is safe — but moving either registration out of this
   * function would break the server at runtime rather than at import.
   */
  for (const p of promptsFor(context)) {
    server.registerPrompt(p.name, p.config, p.cb);
  }

  for (const r of resourcesFor(context)) {
    server.registerResource(r.name, r.uri, r.config, r.read);
  }

  return server;
}
