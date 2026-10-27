#!/usr/bin/env node
/**
 * Stop the local stack properly, which on Windows is not optional.
 *
 *   node stop.mjs              # stops the default cluster (pgdata)
 *   node stop.mjs pgdata2      # or a named one
 *
 * WHY THIS EXISTS
 *
 * `stack.mjs` stops everything on SIGINT, and Ctrl-C in its own terminal delivers that. Nothing
 * else does. Kill the node process any other way on Windows — taskkill, a closed shell, a crash —
 * and the handler never runs: Postgres is orphaned, holding its port and its data directory, and
 * it is then un-killable even with `taskkill /F /T` once anything has started removing that
 * directory underneath it. The only remaining remedy at that point is a reboot.
 *
 * `pg_ctl stop` asks the postmaster to shut down through the mechanism it actually listens to, so
 * it works where force does not.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const data = join(HERE, process.argv[2] ?? process.env.LOCAL_PG_DATA ?? "pgdata");
const pgCtl = join(HERE, "node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe");

if (!existsSync(data)) {
  console.log(`No cluster at ${data}. Nothing to stop.`);
  process.exit(0);
}
if (!existsSync(pgCtl)) {
  console.error(`pg_ctl not found at ${pgCtl}. Run npm install in local/ first.`);
  process.exit(2);
}

try {
  const out = execFileSync(pgCtl, ["-D", data, "-m", "fast", "stop"], { encoding: "utf8" });
  console.log(out.trim() || "stopped.");
} catch (err) {
  const text = String(err.stdout ?? "") + String(err.stderr ?? "") + String(err.message ?? "");
  // "No such process" is a stale postmaster.pid: the server is already gone and only its note
  // saying where it was is left behind. That is stopped, not an error.
  if (/not.*running|no server running|no such process/i.test(text)) {
    console.log("Already stopped.");
  } else {
    console.error(text.trim());
    console.error(
      "\nIf this says the directory is not a cluster, Postgres was orphaned and its data " +
        "directory was partly removed underneath it. Those processes cannot be terminated; a " +
        "reboot clears them. Start again with a different one:\n" +
        "  LOCAL_PG_DATA=pgdata2 LOCAL_PG_PORT=54339 LOCAL_PGRST_PORT=54340 " +
        "LOCAL_GATEWAY_PORT=54341 LOCAL_CC_PORT=54342 node stack.mjs",
    );
    process.exit(1);
  }
}

console.log(
  "\nPostgREST and the gateway are children of stack.mjs and go with it. If stack.mjs was killed " +
    "rather than Ctrl-C'd, check for a stray postgrest.exe.",
);
