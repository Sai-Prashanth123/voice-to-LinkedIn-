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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const MIGRATIONS = join(REPO, "supabase/migrations");
const DATA = join(import.meta.dirname, "pgdata");

/** The same substitutions eval/e2e/pglite.mjs makes, minus the `sed` dependency. */
function transform(sql) {
  // Whole statements, not lines. A line filter removed the `using hnsw` line of a two-line
  // `create index` and left the dangling half behind, which failed migration 0005 and cascaded
  // into 24 others. Everything here runs to the semicolon.
  return sql
    .replace(/create\s+extension[^;]*\b(pg_cron|pg_net)\b[^;]*;/gis, "")
    .replace(/create\s+extension[^;]*\bvector\b[^;]*;/gis, "")
    .replace(/alter\s+extension\s+vector\s+set\s+schema[^;]*;/gis, "")
    .replace(/create\s+index[^;]*\busing\s+hnsw\b[^;]*;/gis, "")
    .replace(/\bextensions\.vector\s*\(\s*\d+\s*\)/gi, "extensions.vector")
    .replace(/(?<!extensions\.)\bvector\s*\(\s*\d+\s*\)/gi, "extensions.vector");
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "probe",
  port: 54999,
  persistent: false,
  // UTF8 explicitly. Without it initdb takes the Windows locale (WIN1252) and every migration
  // whose comment banner contains a box-drawing character fails on encoding alone.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

console.log("initialising postgres ...");
await pg.initialise();
await pg.start();
console.log("started.");

const client = pg.getPgClient();
await client.connect();

const run = async (label, sql) => {
  try {
    await client.query(sql);
  } catch (err) {
    throw new Error(`${label}: ${err.message}`);
  }
};

// The Supabase-managed objects the migrations reference. Same 62-line enumeration the e2e harness
// already proved is the complete surface.
await run("shim", transform(readFileSync(join(REPO, "supabase/tests/shim.sql"), "utf8")));
await run(
  "pgvector-substitute",
  readFileSync(join(REPO, "supabase/tests/pgvector-substitute.sql"), "utf8"),
);

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
const failures = [];
for (const name of files) {
  try {
    await client.query(transform(readFileSync(join(MIGRATIONS, name), "utf8")));
    applied++;
  } catch (err) {
    failures.push(`${name}: ${err.message.split("\n")[0]}`);
    // A failed statement aborts the transaction, and every later query then returns 25P02 — so
    // without this the guarantee checks below cannot run at all.
    await client.query("rollback").catch(() => {});
  }
}

console.log(`\nmigrations: ${applied} of ${files.length} applied`);
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
