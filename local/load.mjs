#!/usr/bin/env node
/**
 * Restore the exported project into a local cluster, after the migrations have run.
 *
 *   node load.mjs                     # into the default cluster (pgdata, port 54329)
 *   LOCAL_PG_PORT=54369 node load.mjs # into a named one
 *   node load.mjs --force             # overwrite tables that already hold rows
 *
 * WHY A LOADER AND NOT pg_restore
 *
 * The export is JSONL, written by scripts/export-local.mjs through PostgREST, because that is the
 * only door the scoped key opens — there is no direct Postgres connection to the hosted project
 * and so no `pg_dump`. That turns out to be the better shape anyway: a line-per-row text file
 * diffs, and a binary dump does not.
 *
 * THREE THINGS THAT WILL BITE, AND DO
 *
 * 1. DERIVED COLUMNS MUST NOT BE RESTORED. `moments.search_text` and `material.search_text` are
 *    tsvector, maintained by triggers. Feeding the exported value back in either fails on the cast
 *    or, worse, succeeds and pins a stale index that the trigger will not revisit until the row is
 *    next written. So every tsvector and every generated column is dropped here and left to the
 *    database to recompute.
 *
 * 2. SEQUENCES MUST BE RESET. Restoring moments 1..111 with explicit ids leaves the identity
 *    sequence at 1, so the next insert collides on the primary key — and the error names the
 *    constraint, not the cause. The first write after a restore is the one that fails, which is
 *    the worst possible time to find out. setval runs for every table whose key has a sequence.
 *
 * 3. JSONB ARRIVES AS AN OBJECT. PostgREST parses it; node-postgres would send `[object Object]`.
 *    Anything destined for json/jsonb is stringified on the way in.
 *
 * WHY IT REFUSES A NON-EMPTY TABLE
 *
 * A restore that silently appends produces duplicate library sections and a second copy of every
 * moment, and the symptom appears later as "the library has two different `closes` rules". The
 * default is to refuse and say which table; --force truncates first, and says that it did.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const HERE = import.meta.dirname;
const DATA = join(HERE, "..", "data", "local");
const FORCE = process.argv.includes("--force");

if (!existsSync(join(DATA, "manifest.json"))) {
  console.error(
    `No export found at ${DATA}.\n\n` +
      `Create one against the live project first:\n` +
      `  node scripts/export-local.mjs\n`,
  );
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8"));

const client = new pg.Client({
  host: process.env.LOCAL_PG_HOST ?? "127.0.0.1",
  port: Number(process.env.LOCAL_PG_PORT ?? 54329),
  user: process.env.LOCAL_PG_USER ?? "postgres",
  password: process.env.LOCAL_PG_PASSWORD ?? "local",
  database: process.env.LOCAL_PG_DATABASE ?? "postgres",
});

try {
  await client.connect();
} catch (err) {
  console.error(
    `Could not reach the local cluster on port ${client.port}: ${err.message}\n\n` +
      `Start it first:  node stack.mjs\n`,
  );
  process.exit(2);
}

/**
 * What the LOCAL database says this table looks like — not what the export says.
 *
 * Read from the local catalogue on purpose. The export was taken from a project that may be one
 * migration ahead or behind this clone, and a column the export carries that this schema does not
 * have must be dropped rather than crash the load. The reverse is also true and quieter: a column
 * this schema has and the export lacks simply takes its default.
 */
async function shapeOf(table) {
  const { rows } = await client.query(
    `select a.attname as name,
            format_type(a.atttypid, a.atttypmod) as type,
            a.attgenerated <> '' as generated
       from pg_attribute a
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped`,
    [`public.${table}`],
  );
  const usable = rows.filter((c) => !c.generated && c.type !== "tsvector");
  return {
    columns: new Map(usable.map((c) => [c.name, c.type])),
    skipped: rows.filter((c) => c.generated || c.type === "tsvector").map((c) => c.name),
  };
}

const results = [];
const failures = [];

for (const entry of manifest.tables) {
  const { table, order } = entry;
  const file = join(DATA, `${table}.jsonl`);
  if (!existsSync(file)) {
    failures.push(`${table}: ${table}.jsonl is missing from the export`);
    continue;
  }

  const text = readFileSync(file, "utf8").trim();
  const rows = text ? text.split("\n").map((l) => JSON.parse(l)) : [];
  if (!rows.length) {
    results.push({ table, loaded: 0, note: "empty in the export" });
    continue;
  }

  let shape;
  try {
    shape = await shapeOf(table);
  } catch {
    failures.push(`${table}: no such table in this cluster — are the migrations applied?`);
    continue;
  }

  const existing = Number((await client.query(`select count(*) from public."${table}"`)).rows[0].count);
  if (existing > 0) {
    if (!FORCE) {
      failures.push(
        `${table}: already holds ${existing} row(s). Refusing to append — that is how a library ` +
          `ends up with two different rules for the same key. Re-run with --force to replace.`,
      );
      continue;
    }
    await client.query(`truncate public."${table}" cascade`);
  }

  // Intersect the export's keys with what this schema will accept, and keep a stable order so the
  // placeholders line up with the values on every row.
  const cols = Object.keys(rows[0]).filter((k) => shape.columns.has(k));
  const dropped = Object.keys(rows[0]).filter((k) => !shape.columns.has(k));

  const quoted = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `insert into public."${table}" (${quoted}) values (${placeholders})`;

  let loaded = 0;
  await client.query("begin");
  try {
    for (const row of rows) {
      const values = cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return null;
        // jsonb/json want text; everything else node-postgres handles. An array column is left
        // alone because pg maps JS arrays to Postgres arrays correctly.
        const type = shape.columns.get(c);
        if ((type === "jsonb" || type === "json") && typeof v === "object") return JSON.stringify(v);
        return v;
      });
      await client.query(sql, values);
      loaded++;
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    failures.push(`${table}: row ${loaded + 1} of ${rows.length} — ${err.message.split("\n")[0]}`);
    continue;
  }

  /*
   * The sequence, which is the whole reason the first write after a restore fails.
   *
   * pg_get_serial_sequence returns null for a key that is not sequence-backed — settings.key,
   * library_sections.key, material.moment_id — and those need nothing, so a null is the answer and
   * not an error.
   */
  let sequenceSetTo = null;
  const { rows: seq } = await client.query(
    `select pg_get_serial_sequence($1, $2) as seq`,
    [`public.${table}`, order],
  );
  if (seq[0]?.seq) {
    const { rows: m } = await client.query(
      `select coalesce(max("${order}"), 0) as hi from public."${table}"`,
    );
    await client.query(`select setval($1, $2)`, [seq[0].seq, Math.max(1, Number(m[0].hi))]);
    sequenceSetTo = Number(m[0].hi);
  }

  results.push({ table, loaded, dropped, skipped: shape.skipped, sequenceSetTo });
}

/* ── What happened ────────────────────────────────────────────────────────── */

console.log(`restored from data/local, exported ${manifest.exported_at}\n`);
let total = 0;
for (const r of results) {
  total += r.loaded;
  const bits = [];
  if (r.sequenceSetTo !== null && r.sequenceSetTo !== undefined) bits.push(`seq->${r.sequenceSetTo}`);
  if (r.skipped?.length) bits.push(`recomputed: ${r.skipped.join(",")}`);
  if (r.dropped?.length) bits.push(`NOT IN THIS SCHEMA: ${r.dropped.join(",")}`);
  if (r.note) bits.push(r.note);
  console.log(`  ${r.table.padEnd(26)} ${String(r.loaded).padStart(7)}  ${bits.join("  ")}`);
}
console.log(`\n${total} rows restored.`);

/*
 * The check the plan got wrong, stated correctly.
 *
 * "select count(*) from library_sections returns 15" PASSES ON AN EMPTY LIBRARY: a fresh cluster
 * has all 15 rows from the migrations and ten of them are zero characters long. A count of rows
 * that exist is not a check that anything is in them, and that one line is why a stack that could
 * not write a post reported itself healthy for a week.
 */
const { rows: lib } = await client.query(
  `select count(*)::int as sections,
          count(*) filter (where coalesce(body,'') = '')::int as empty,
          coalesce(max(version), 0) as top_version
     from public.library_sections`,
);
const { rows: mode } = await client.query(
  `select value::text as v from public.settings where key = 'one_step_mode'`,
);
const { rows: refs } = await client.query(`select count(*)::int as n from public.reference_writer_posts`);

console.log(`\nthe standard:`);
console.log(`  library sections        ${lib[0].sections}, ${lib[0].empty} empty  (empty must be 0)`);
console.log(`  highest section version ${lib[0].top_version}`);
console.log(`  reference writer posts  ${refs[0].n}`);
console.log(`  one_step_mode           ${mode[0]?.v ?? "(not set)"}`);

await client.end();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
if (lib[0].empty > 0) {
  console.error(
    `\n${lib[0].empty} library section(s) are empty after the restore. The shelves are here and ` +
      `the rules are not, which is the state this whole exercise exists to end.`,
  );
  process.exit(1);
}
