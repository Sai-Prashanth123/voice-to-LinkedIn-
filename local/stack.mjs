/**
 * The local stack: real Postgres, real PostgREST, and a gateway that speaks Supabase's URL shape.
 *
 *   cd local && npm install && node stack.mjs
 *
 * WHY THE REAL COMPONENTS
 *
 * `mcp-server/db.mjs` is raw PostgREST over HTTP — the filter grammar (`eq.`, `is.`, `in.(...)`,
 * `not.like.`), `Prefer: return=representation`, `payload->>moment_id` parsed out of a PARAMETER
 * NAME, the `{message, details, hint, code}` error envelope, and the 42501-versus-gateway
 * distinction that tells "no grants" apart from "key rejected". Reimplementing that in JavaScript
 * is roughly 250 lines whose failure mode is silent wrong answers: a filter that compiles slightly
 * differently returns the wrong rows instead of an error. This repository has spent three weeks on
 * that exact class of bug. Running the real binary keeps the semantics by construction.
 *
 * It also keeps the SAFETY model. Every `revoke delete` and every RLS policy in this repo is
 * written against the four Supabase role names, and PostgREST is what switches to `content_mcp`
 * per request. Connect directly as the table owner instead and "nothing in the idea bank is ever
 * deleted" evaporates with no error message.
 *
 * WHY A GATEWAY IN FRONT
 *
 * db.mjs builds `${url}/rest/v1` and PostgREST serves at root, and every write in the system goes
 * to `${url}/functions/v1/cc-submit`. Rather than edit nine call sites and a base path — and have
 * the local build diverge from the deployed one — this serves both prefixes on one port, so
 * `SUPABASE_URL=http://localhost:54321` and NOTHING ELSE CHANGES.
 *
 * WHAT IS NOT HERE YET
 *
 * `/functions/v1/cc-submit` answers 501. The write door is 32 routes of Deno that still have to be
 * served locally; this file brings up the read path and the role boundary, which is the half the
 * architecture was uncertain about.
 */

import EmbeddedPostgres from "embedded-postgres";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { applySchema, INITDB_FLAGS } from "./schema.mjs";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..");
const PG_BIN = join(HERE, "node_modules/@embedded-postgres/windows-x64/native/bin");
const POSTGREST = join(HERE, "bin/postgrest.exe");

const PG_PORT = 54329;
const PGRST_PORT = 54330;
const GATEWAY_PORT = 54321;

/** Local only, never a credential that reaches anything real. */
const JWT_SECRET = "local-development-only-secret-not-for-anything-real-0123456789";
const PG_PASSWORD = "local";

/** A Supabase-shaped JWT: HS256, and the `role` claim is what makes PostgREST `set role`. */
function mintKey(role) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    role,
    iss: "local",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 5,
  });
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const shutdown = [];
async function stopAll() {
  for (const fn of shutdown.reverse()) {
    try {
      await fn();
    } catch { /* a failed stop must not stop the others */ }
  }
}
process.on("SIGINT", async () => {
  console.log("\nstopping ...");
  await stopAll();
  process.exit(0);
});

/* ── Postgres ─────────────────────────────────────────────────────────────── */

const pg = new EmbeddedPostgres({
  databaseDir: join(HERE, "pgdata"),
  user: "postgres",
  password: PG_PASSWORD,
  port: PG_PORT,
  persistent: true,
  initdbFlags: INITDB_FLAGS,
});

let fresh = false;
try {
  await pg.initialise();
  fresh = true;
} catch {
  // Already initialised. The data stays, which is the point of persistent.
}
await pg.start();
shutdown.push(() => pg.stop());
console.log(`postgres   up on ${PG_PORT}${fresh ? " (new cluster)" : " (existing data)"}`);

const client = pg.getPgClient();
await client.connect();

if (fresh) {
  const { applied, total, failures } = await applySchema(client, REPO);
  console.log(`schema     ${applied} of ${total} migrations applied`);
  for (const f of failures) console.log(`           FAILED  ${f}`);
  if (failures.length > 0) {
    await client.end();
    await stopAll();
    process.exit(1);
  }
}

/*
 * PostgREST connects AS `authenticator` and switches role per request. The migrations create it
 * NOLOGIN, deliberately, because on Supabase it is managed and never logged into directly. Here
 * it has to be able to connect, and nothing else about it changes: it still holds no table
 * privileges of its own, so a request with no role claim gets `anon` and gets nothing.
 */
await client.query(`alter role authenticator with login password '${PG_PASSWORD}'`);
await client.end();

/* ── PostgREST ────────────────────────────────────────────────────────────── */

const pgrst = spawn(POSTGREST, [], {
  env: {
    ...process.env,
    // Without the embedded Postgres bin directory here, postgrest.exe dies on a missing LIBPQ.dll.
    PATH: `${PG_BIN};${process.env.PATH ?? ""}`,
    PGRST_DB_URI:
      `postgres://authenticator:${PG_PASSWORD}@localhost:${PG_PORT}/postgres`,
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_LOG_LEVEL: "error",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
shutdown.push(() => pgrst.kill());
pgrst.stderr.on("data", (d) => {
  const line = String(d).trim();
  if (line) console.log(`postgrest  ${line}`);
});

/** PostgREST needs a moment to build its schema cache; poll rather than guess. */
async function waitFor(url, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not come up`);
}
await waitFor(`http://localhost:${PGRST_PORT}/`, "postgrest");
console.log(`postgrest  up on ${PGRST_PORT}`);

/* ── The gateway ──────────────────────────────────────────────────────────── */

const gateway = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${GATEWAY_PORT}`);

  if (url.pathname.startsWith("/rest/v1")) {
    const target = `http://localhost:${PGRST_PORT}${url.pathname.slice("/rest/v1".length)}${url.search}`;
    const headers = { ...req.headers };
    delete headers.host;
    // Supabase's gateway header. PostgREST neither needs nor understands it.
    delete headers.apikey;
    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
      });
    try {
      const upstream = await fetch(target, { method: req.method, headers, body });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `gateway could not reach postgrest: ${err.message}` }));
    }
    return;
  }

  if (url.pathname.startsWith("/functions/v1/")) {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({
      message: `${url.pathname} is not served locally yet`,
      hint: "The write door is 32 Deno routes and is the next piece of the local stack. Until it "
        + "is here, writes still go to the hosted project.",
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not a Supabase-shaped path" }));
});

await new Promise((r) => gateway.listen(GATEWAY_PORT, r));
shutdown.push(() => new Promise((r) => gateway.close(r)));
console.log(`gateway    up on ${GATEWAY_PORT}  (/rest/v1 -> postgrest, /functions/v1 -> 501)`);

/* ── What a client needs ──────────────────────────────────────────────────── */

const envPath = join(HERE, ".env.local");
writeFileSync(
  envPath,
  `# Written by local/stack.mjs. Local only — this key is signed with a secret in that file and\n` +
    `# grants the content_mcp role, which holds no DELETE and no UPDATE anywhere.\n` +
    `SUPABASE_URL=http://localhost:${GATEWAY_PORT}\n` +
    `CONTENT_MCP_KEY=${mintKey("content_mcp")}\n`,
);
console.log(`\nwrote ${envPath}`);
console.log(`\nPoint the MCP server at it:  SUPABASE_URL=http://localhost:${GATEWAY_PORT}`);
console.log("Ctrl-C to stop everything.\n");
