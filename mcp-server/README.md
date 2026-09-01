# content-system-mcp

The doorway between Claude Code and the content system.

## Why it exists

Edge Functions run in Supabase's cloud. Claude Code runs on Josh's laptop. **The cloud cannot call
the laptop**, so the obvious design — a `claude-code` provider inside `llm.ts` — would leave a cloud
function blocking on a machine it has no route to.

So the laptop pulls. It asks this server what needs writing, writes it with Claude Code, and posts
the result back. The drafting and gate handlers in `supabase/functions/` do not move.

## What it is not

Not an admin channel. It holds one scoped key with **no delete rights anywhere**, so the worst a
confused model can do is add a draft nobody asked for — which Josh declines like any other draft.
Nothing here can publish. That still needs his approval, and the database refuses to store a
published post without it.

## Running it

```bash
npm install
cp .env.example .env      # then fill it in
node index.mjs --check    # credentials, connectivity, registered tools
node index.mjs --tools    # list tools without touching the network
node --test               # protocol tests against the live project
```

`--check` is the first thing to run when anything looks wrong. It separates the three failures that
otherwise look identical: an unreachable project, a rejected key, and a role with no grants.

## Files

| File | What it holds |
|---|---|
| `index.mjs` | Server entry, stdio transport, tool registration, the error envelope |
| `env.mjs` | Credential loading. A real environment variable always wins over `.env` |
| `db.mjs` | A thin PostgREST client — no `@supabase/supabase-js`, none of it applies here |
| `tools/index.mjs` | The registry. One flat list, so registering is a loop |
| `tools/health.mjs` | Connectivity, and whether the role can actually read |
| `tools/read.mjs` | Task 1.2 |
| `tools/write.mjs` | Task 1.3 |
| `index.test.mjs` | Real protocol over a real pipe to a real child process |

## Two things worth knowing

**stdout belongs to the transport.** One stray `console.log` corrupts every message after it. That
is why `env.mjs` exports `note()`, which writes to stderr, and why nothing in this package prints to
stdout directly.

**A failing tool is not a failing server.** MCP carries a tool failure as a normal result with
`isError` set. A protocol error means "the server is broken" and ends the exchange; `isError` means
"that did not work, here is why" and the model can read it and try something else. Almost everything
that goes wrong here is the second kind, so `index.mjs` wraps every handler to make sure it stays
that way.

## State

Task 1.1 is done: the package runs, speaks MCP, and reaches the live project.

The key in `.env` is currently the publishable (anon) key, which has **no grants** — so `health`
reports `can_read: false` and that is correct, not a fault. Task 1.4 creates the scoped role
(`0028_mcp_role.sql`) and that key replaces it. Task 1.5 registers the server in `.mcp.json`.
