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
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { applySchema, INITDB_FLAGS } from "./schema.mjs";

const exe = process.platform === "win32" ? ".exe" : "";
const HERE = import.meta.dirname;
const REPO = join(HERE, "..");
const PG_BIN = join(HERE, "node_modules/@embedded-postgres/windows-x64/native/bin");
const POSTGREST = join(HERE, "bin/postgrest.exe");

/*
 * Overridable, because a stack that cannot be moved cannot be recovered.
 *
 * On Windows a killed `node stack.mjs` does not deliver SIGINT, so the shutdown handler below
 * never runs and Postgres is orphaned — holding its port and its data directory, un-killable even
 * with `taskkill /F /T` once the directory has been partly removed underneath it. Being able to
 * say LOCAL_PG_DATA=pgdata-2 LOCAL_PG_PORT=54339 and carry on is the difference between a bad
 * afternoon and a reboot.
 *
 * Stop it with Ctrl-C in its own terminal, which does deliver the signal.
 */
const PG_PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const PGRST_PORT = Number(process.env.LOCAL_PGRST_PORT ?? 54330);
const GATEWAY_PORT = Number(process.env.LOCAL_GATEWAY_PORT ?? 54321);
const PG_DATA = process.env.LOCAL_PG_DATA ?? "pgdata";

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
  databaseDir: join(HERE, PG_DATA),
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

  /*
   * AND THE RULES, NOT JUST THE SHELVES.
   *
   * The migrations create 15 library_sections — exactly the number the live project has — and TEN
   * OF THEM ARE ZERO CHARACTERS LONG. Measured 28 October 2026. Josh wrote the rules into them
   * himself over two months, which is the whole reason the standard lives in the database instead
   * of in the prompts.
   *
   * So a cluster that applied 54 of 54 migrations and stopped here is a system that cannot judge a
   * draft: every rubric it judges against is the empty string, and nothing says so. It was the
   * state this stack was in for a week while reporting itself healthy.
   *
   * Restored here rather than left as a documented second step, because a second step is a step
   * somebody skips — and the failure mode of skipping it is silent.
   */
  const { restore } = await import("./load.mjs");
  const { loaded, sections, empty } = await restore(client, { quiet: false });
  console.log(`data       ${loaded.toLocaleString()} rows restored, ${sections} library sections`);
  if (empty > 0) {
    console.log(`           ${empty} section(s) are STILL EMPTY — the shelves are here, the rules are not`);
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

/* ── cc-submit, the write door ────────────────────────────────────────────── */

/*
 * Served by Deno, from the same source file that is deployed. Not ported, not reimplemented: it is
 * 32 routes carrying the claim ledger, the three-strike retry, the extraction verifier that
 * rebuilds the source FROM THE DATABASE rather than trusting the request, and `mark_ready`, which
 * is the only thing in the system that authorises publishing. A local rewrite of that is a second
 * standard, and two standards is how the voice_guide check passed eighteen drafts against an empty
 * section.
 *
 * It needs nothing but two environment variables, because `_shared/db.ts:12-17` builds its client
 * from SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — and supabase-js speaks PostgREST, which is
 * what the gateway is serving. So the deployed code and the local code are the same code.
 */
const CC_PORT = Number(process.env.LOCAL_CC_PORT ?? 54331);
/*
 * The real deno executable, not a shim.
 *
 * Two Windows traps, hit in order. `shell: true` concatenates argv without quoting, and this
 * repository's path contains a space, so Deno was handed "D:/Voice" and reported a module it
 * could not find. Dropping the shell then fails differently: Node refuses to spawn a `.cmd` or
 * `.ps1` without one, which is `spawn EINVAL`. And what npm puts on PATH for deno IS a `.ps1`.
 *
 * So: find the binary.
 */
function findDeno() {
  const candidates = [
    process.env.DENO_BIN,
    process.platform === "win32"
      ? join(process.env.APPDATA ?? "", "npm/node_modules/deno/deno.exe")
      : null,
    join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".deno/bin/deno" + exe),
    process.platform === "win32" ? null : "/usr/local/bin/deno",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    "Could not find the deno executable, which serves cc-submit. Looked in: " +
      candidates.join(", ") + ". Set DENO_BIN, or install Deno.",
  );
}

const ccSubmit = spawn(
  findDeno(),
  [
    "run",
    "--allow-net",
    "--allow-env",
    "--allow-read",
    join(REPO, "supabase/functions/cc-submit/index.ts"),
  ],
  {
    cwd: REPO,
    env: {
      ...process.env,
      SUPABASE_URL: `http://localhost:${GATEWAY_PORT}`,
      SUPABASE_SERVICE_ROLE_KEY: mintKey("service_role"),
      // Deno.serve defaults to 8000; this is the one thing the function does not take as an arg.
      DENO_SERVE_ADDRESS: `tcp:0.0.0.0:${CC_PORT}`,
      PORT: String(CC_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
shutdown.push(() => ccSubmit.kill());
for (const stream of [ccSubmit.stdout, ccSubmit.stderr]) {
  stream.on("data", (d) => {
    const line = String(d).trim();
    if (line) console.log(`cc-submit  ${line.split("\n")[0].slice(0, 160)}`);
  });
}

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

  if (url.pathname.startsWith("/functions/v1/cc-submit")) {
    const headers = { ...req.headers };
    delete headers.host;
    const body = await new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
    try {
      const upstream = await fetch(`http://localhost:${CC_PORT}/`, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `gateway could not reach cc-submit: ${err.message}` }));
    }
    return;
  }

  if (url.pathname.startsWith("/functions/v1/")) {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({
      message: `${url.pathname} is not served locally`,
      hint: "Only cc-submit is served here. The workers are driven by pg_cron and pg_net on "
        + "Supabase, neither of which exists locally — they need a supervisor, which is the next "
        + "piece.",
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not a Supabase-shaped path" }));
});

await new Promise((r) => gateway.listen(GATEWAY_PORT, r));
shutdown.push(() => new Promise((r) => gateway.close(r)));
console.log(`gateway    up on ${GATEWAY_PORT}  (/rest/v1 -> postgrest, /functions/v1/cc-submit -> deno)`);

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
