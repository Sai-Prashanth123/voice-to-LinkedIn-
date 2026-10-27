/**
 * Stage 1 probe: does real Postgres take all 55 migrations, and do the guarantees survive?
 *
 * The guarantees are the point. "Nothing in the idea bank is ever deleted" is four CHECK
 * constraints and twenty `revoke delete` statements, all relative to the Supabase role names. A
 * local Postgres that connects as the table owner has DELETE inherently and loses the lot with no
 * error message — so this probe asserts the revokes landed, not just that the SQL ran.
 *
 * Transforms are done in JS rather than by shelling out to `sed`, which eval/e2e/pglite.mjs does
 * and which breaks on a Windows box without Git on PATH.
 */

import EmbeddedPostgres from "embedded-postgres";
import { join } from "node:path";

// The transforms and the initdb flags live in schema.mjs, because stack.mjs needs the same ones
// and a second copy of the extension substitutions is precisely the drift that
// supabase/tests/managed-extensions.sed exists to stop.
import { applySchema, INITDB_FLAGS } from "./schema.mjs";

const REPO = join(import.meta.dirname, "..");
const DATA = join(import.meta.dirname, "pgdata-probe");

const pg = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "probe",
  port: 54999,
  persistent: false,
  initdbFlags: INITDB_FLAGS,
});

console.log("initialising postgres ...");
await pg.initialise();
await pg.start();
console.log("started.");

const client = pg.getPgClient();
await client.connect();

const { applied, total, failures } = await applySchema(client, REPO);

console.log(`\nmigrations: ${applied} of ${total} applied`);
for (const f of failures) console.log(`  FAILED  ${f}`);

/* ── The guarantees ───────────────────────────────────────────────────────── */

const q = async (sql) => (await client.query(sql)).rows;

const destructive = await q(`
  select grantee, table_name, privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public'
     and privilege_type in ('DELETE', 'TRUNCATE')
     and grantee in ('anon', 'authenticated', 'service_role', 'content_mcp')
   order by 1, 2
`);

const checks = await q(`
  select conname from pg_constraint
   where conrelid = 'public.posts'::regclass and contype = 'c'
     and conname like 'posts_%'
   order by 1
`);

const roles = await q(`
  select rolname from pg_roles
   where rolname in ('anon','authenticated','service_role','authenticator','content_mcp')
   order by 1
`);

console.log(`\nroles present: ${roles.map((r) => r.rolname).join(", ") || "NONE"}`);
console.log(`posts CHECK constraints: ${checks.map((c) => c.conname).join(", ") || "NONE"}`);
console.log(
  `destructive grants to app roles: ${destructive.length}` +
    (destructive.length ? ` -> ${JSON.stringify(destructive)}` : "  (this is the guarantee)"),
);

/*
 * The guarantee, asserted rather than inferred.
 *
 * "No destructive grants" read off a catalogue is evidence; a refused DELETE is proof. This is the
 * thing that silently evaporates if a local build ever connects as the table owner, and the whole
 * reason the plan insists PostgREST keeps doing the role switch.
 */
for (const role of ["content_mcp", "service_role", "authenticated", "anon"]) {
  let refused = false;
  let detail = "";
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("delete from public.moments");
    await client.query("rollback");
  } catch (err) {
    refused = true;
    detail = err.message.split("\n")[0];
    await client.query("rollback").catch(() => {});
  }
  console.log(`  delete as ${role.padEnd(14)} ${refused ? "REFUSED  " + detail : "*** ALLOWED ***"}`);
}

await client.end();
await pg.stop();
console.log("\nstopped.");
