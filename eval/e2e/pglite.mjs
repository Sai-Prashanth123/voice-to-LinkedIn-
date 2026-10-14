/**
 * The same throwaway database, without Docker.
 *
 * PGlite is Postgres 18 compiled to WASM and installed from npm. No daemon, no container, no
 * Docker Desktop — which matters because `dockerAvailable()` has been returning false on the
 * machine this is developed on, and `startLocal` returns null, and the harness SKIPS. 103 of 109
 * cases have therefore never executed, silently, for weeks. Nothing was broken and nothing was
 * running, which is the same shape as the sentinel refresh going quiet for a month.
 *
 * WHY NOT SQLITE, WHICH IS THE OBVIOUS SUGGESTION
 *
 * Because it would be a different database. This schema leans on jsonb in 19 migrations, generated
 * columns in 9, PL/pgSQL functions in 13, and — the one that settles it — GRANTs in 7, where the
 * whole point is that DELETE is granted to nobody. SQLite has no permission system at all, so the
 * structural guarantee behind "nothing in the idea bank is ever deleted" becomes untestable.
 *
 * And this, from 0004:
 *
 *     check (jsonb_typeof(evidence) = 'object' and evidence <> '{}')
 *
 * is the constraint that silently refused every proposal `propose_library_change` ever made, for
 * weeks, until it was found by hand on 14 October. SQLite cannot express it. A suite that passes on
 * an engine the schema does not target reports green over the thing it is not testing, which is
 * worse than no suite. This one enforces that constraint — checked, not assumed.
 *
 * WHAT IT COSTS
 *
 * One thing: PGlite 0.5.10 ships 34 contrib extensions and pgvector is not among them, while
 * migration 0001 creates it on line 4. `supabase/tests/pgvector-substitute.sql` stands in — a real
 * cosine distance over float8[], so similarity ranks correctly — but the dimension is unenforced
 * and there is no HNSW index, because an access method cannot be created from SQL.
 *
 * So this driver reports `vector: "substitute"`, and anything asserting on an index, a query plan
 * or a rejected dimension must skip rather than pass against a stand-in. The container remains
 * correct for those; this is for the other hundred.
 */

import { PGlite } from "@electric-sql/pglite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SED = join(ROOT, "supabase", "tests", "managed-extensions.sed");

let live = null;

/**
 * The container's transform, plus the four substitutions only this engine needs.
 *
 * The shared half runs through `managed-extensions.sed` — the actual file the container path and CI
 * both use — rather than a second copy of those two patterns. That file's own header records what
 * happened the last time there were two: the same migrations passed locally and failed on every
 * push for three days.
 *
 * The pglite-only half is deliberately NOT in that file. Adding it there would strip pgvector from
 * the container run too, and the container has the real extension. These four are a property of an
 * engine missing one extension, not of the schema.
 */
async function sqlFor(file) {
  const { stdout } = await run("sed", ["-f", SED, file], { maxBuffer: 32 * 1024 * 1024 });
  return stdout
    // 0001 line 4. The substitute supplies the type instead.
    .replace(/^[ \t]*create extension if not exists[ \t]+"?vector"?[ \t]*;.*$/gim, "")
    // 0008 line 29 moves it to `extensions` for Supabase's lint. The domain is already there.
    .replace(/^[ \t]*alter extension[ \t]+"?vector"?[ \t]+set schema[^;]*;.*$/gim, "")
    // Three HNSW indexes. An access method cannot be created from SQL, and an index changes how
    // fast an answer arrives rather than what it is.
    .replace(/create\s+index[^;]*?using\s+hnsw[^;]*;/gis, "")
    // A domain cannot carry a type modifier, so vector(1536) becomes extensions.vector. Qualified
    // first, then bare, because the bare pattern must not match the tail of the qualified one.
    .replace(/\bextensions\.vector\s*\(\s*\d+\s*\)/gi, "extensions.vector")
    .replace(/(^|[^.\w])vector\s*\(\s*\d+\s*\)/gi, "$1extensions.vector");
}

/** Whether this engine can be used at all. Unlike Docker, the answer is always yes if installed. */
export async function pgliteAvailable() {
  try {
    await import("@electric-sql/pglite");
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the database. Returns a driver, or null when the package is not installed — the same
 * contract `startLocal` has, so the caller does not care which engine answered.
 */
export async function startPglite({ log = () => {} } = {}) {
  if (!await pgliteAvailable()) return null;

  log("building a clean database from the migrations (pglite, no docker)");
  const db = await PGlite.create();

  await db.exec(readFileSync(join(ROOT, "supabase", "tests", "shim.sql"), "utf8"));
  await db.exec(readFileSync(join(ROOT, "supabase", "tests", "pgvector-substitute.sql"), "utf8"));

  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const name of files) {
    try {
      await db.exec(await sqlFor(join(dir, name)));
    } catch (err) {
      // Named, because "migrations failed" sends someone through 48 files by hand.
      throw new Error(`${name} did not apply on pglite: ${err?.message ?? err}`);
    }
  }
  log(`migrations applied (${files.length})`);

  live = db;
  return driver(db);
}

function driver(db) {
  /*
   * THE SAME CTE WRAPPER THE CONTAINER USES, ON PURPOSE.
   *
   * PGlite's own `.rows` would be less work and would NOT be the same thing: it returns JS values,
   * so a timestamp arrives as a Date where psql's json_agg gives a string, and a bigint as a
   * string where json gives a number. Cases assert on those shapes. Routing both engines through
   * one json_agg means a case cannot pass on one and fail on the other over a type coercion, which
   * is the only kind of difference that would make this worse than no second engine.
   */
  async function sql(text) {
    const wrapped = `with t as (${text}) select coalesce(json_agg(t), '[]'::json)::text as j from t`;
    const result = await db.query(wrapped);
    return JSON.parse(result.rows[0]?.j ?? "[]");
  }

  /** For statements that return nothing, or that are expected to raise. */
  async function exec(text) {
    await db.exec(text);
  }

  /**
   * Run something and hand back the Postgres error.
   *
   * Half the cases exist to prove the database REFUSES something, and the useful part is the
   * constraint name. PGlite throws an Error whose message is the server's, so this normalises it to
   * the one line the container's psql path produces.
   *
   * THE `ERROR:` PREFIX IS KEPT, AND THE FIRST VERSION STRIPPED IT.
   *
   * psql prints `ERROR: new row for relation "posts" violates check constraint …` and the container
   * driver removes only its own `psql:file:line:` prefix, leaving `ERROR:` in place. PGlite throws
   * the message without it. S8-01 asserts the refusal matches /ERROR/, so stripping it turned a
   * constraint firing exactly as designed into a failure that read like a missing guard — on the
   * one case whose whole subject is that a post cannot be published without Josh.
   *
   * It is added when absent rather than removed, so one wording reaches the cases from both
   * engines. This is the class of difference the sql() comment warns about, and it bit on the
   * first full run.
   */
  async function expectError(text) {
    try {
      await exec(text);
      return null;
    } catch (err) {
      const message = String(err?.message ?? err);
      const line = (message.split("\n").find((l) => l.trim().length > 0) ?? message).trim();
      return /^ERROR:/.test(line) ? line : `ERROR:  ${line}`;
    }
  }

  /** As a given role, so a grant assertion is made the way the app would hit it. */
  async function asRole(role, text) {
    return await expectError(`set local role ${role}; ${text}`);
  }

  return {
    sql,
    exec,
    expectError,
    asRole,
    engine: "pglite",
    // Read by the harness to skip what a stand-in must not be allowed to pass.
    vector: "substitute",
  };
}

export async function stopPglite() {
  await live?.close().catch(() => {});
  live = null;
}
