/**
 * Building this schema on a plain Postgres: the transforms, and applying them.
 *
 * Spelled once because probe.mjs and stack.mjs both need it, and a second copy of the extension
 * substitutions is exactly the drift that `supabase/tests/managed-extensions.sed` exists to stop —
 * its own header records the week the sed patterns lived in two places and CI passed while local
 * failed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Supabase-managed extensions a plain Postgres does not have.
 *
 * WHOLE STATEMENTS, NOT LINES. A line-based filter removed the second line of a two-line
 * `create index ... using hnsw (...)` and left the first dangling, which failed migration 0005 and
 * cascaded into 24 others. Everything here runs to the semicolon.
 *
 * `eval/e2e/pglite.mjs` does the same job by shelling out to the `sed` binary, which on Windows
 * only resolves because Git ships one. This needs nothing but Node.
 */
export function transform(sql) {
  return sql
    .replace(/create\s+extension[^;]*\b(pg_cron|pg_net)\b[^;]*;/gis, "")
    .replace(/create\s+extension[^;]*\bvector\b[^;]*;/gis, "")
    .replace(/alter\s+extension\s+vector\s+set\s+schema[^;]*;/gis, "")
    .replace(/create\s+index[^;]*\busing\s+hnsw\b[^;]*;/gis, "")
    .replace(/\bextensions\.vector\s*\(\s*\d+\s*\)/gi, "extensions.vector")
    .replace(/(?<!extensions\.)\bvector\s*\(\s*\d+\s*\)/gi, "extensions.vector");
}

/**
 * Apply the shim, the pgvector substitute and every migration in order.
 *
 * @returns `{ applied, total, failures }` — failures are collected rather than thrown, because one
 *          broken migration cascades and the useful output is the FIRST one, not the last.
 */
export async function applySchema(client, repoRoot) {
  const run = async (label, sql) => {
    try {
      await client.query(sql);
    } catch (err) {
      throw new Error(`${label}: ${err.message.split("\n")[0]}`);
    }
  };

  // The 62-line enumeration of every Supabase-managed object the migrations reference. The e2e
  // harness already proved this is the complete surface: no pgsodium, no realtime, no
  // supabase_functions triggers, no `alter system`.
  await run("shim", transform(readFileSync(join(repoRoot, "supabase/tests/shim.sql"), "utf8")));
  await run(
    "pgvector-substitute",
    readFileSync(join(repoRoot, "supabase/tests/pgvector-substitute.sql"), "utf8"),
  );

  const dir = join(repoRoot, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const failures = [];
  let applied = 0;

  for (const name of files) {
    try {
      await client.query(transform(readFileSync(join(dir, name), "utf8")));
      applied++;
    } catch (err) {
      failures.push(`${name}: ${err.message.split("\n")[0]}`);
      // A failed statement aborts the transaction, and every later query then returns 25P02 — so
      // without this nothing after the first failure can even be attempted.
      await client.query("rollback").catch(() => {});
    }
  }

  return { applied, total: files.length, failures };
}

/**
 * initdb flags that are not optional on Windows.
 *
 * Without `--encoding=UTF8` initdb takes the system locale — WIN1252 — and every migration whose
 * comment banner contains a box-drawing character (U+2500) fails with "has no equivalent in
 * encoding WIN1252". That kills 0028, so `content_mcp` is never created, so nine later migrations
 * fail after it: 24 failures from one locale default, and not one of the messages points at the
 * cause.
 */
export const INITDB_FLAGS = ["--encoding=UTF8", "--locale=C"];
