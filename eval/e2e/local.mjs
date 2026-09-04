/**
 * A throwaway Postgres with the whole schema on it.
 *
 * WHY NOT RUN EVERYTHING AGAINST THE LIVE PROJECT
 *
 * Clause 6.3 forbids deleting anything — a fixture is killed and labelled, never removed. So a
 * hundred cases run against the real database would leave a hundred permanent rows in Josh's idea
 * bank. Here the database is built from the 28 migrations, used, and thrown away, so a case can
 * insert whatever it needs and assert on the result without costing anyone anything.
 *
 * IT REUSES THE EXISTING RECIPE RATHER THAN INVENTING A SECOND ONE
 *
 * supabase/tests/run-migrations.sh already stands this up correctly, including the two things that
 * are easy to get wrong: the shim that stands in for Supabase-managed objects (auth, storage,
 * vault, pg_net, pg_cron), and a readiness check that waits for a query to succeed rather than
 * trusting pg_isready — which reports ready while the server is still starting, and did.
 *
 * A second container recipe would drift from that one. This drives the same script, then keeps the
 * container alive for the run instead of letting it exit.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CONTAINER = "v2c-e2e";

async function docker(args, options = {}) {
  return await run("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });
}

export async function dockerAvailable() {
  try {
    await docker(["version", "--format", "{{.Server.Os}}"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the database. Returns a driver, or null when Docker is not running — the caller decides
 * whether that is a skip or a failure, because it is a fact about the machine, not the code.
 */
export async function startLocal({ reuse = false, log = () => {} } = {}) {
  if (!await dockerAvailable()) return null;

  if (reuse) {
    try {
      const { stdout } = await docker(["exec", CONTAINER, "psql", "-U", "postgres", "-tAc", "select 1"]);
      if (stdout.trim() === "1") {
        log("reusing the existing container");
        return driver();
      }
    } catch { /* not running; build it */ }
  }

  log("building a clean database from the migrations");
  await buildFrom(log);
  return driver();
}

/**
 * Runs the project's own migration script against a differently-named container.
 *
 * CONTAINER is overridden through the environment rather than by copying the script, so a change
 * to the migration order, the shim, or the readiness check reaches this path automatically.
 */
async function buildFrom(log) {
  await docker(["rm", "-f", CONTAINER]).catch(() => {});

  const script = join(ROOT, "supabase", "tests", "run-migrations.sh");
  await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [script], {
      cwd: ROOT,
      // A different container AND a different published port, so this can run beside the
      // ordinary migration check without either fighting for 55432.
      env: { ...process.env, CONTAINER, PGPORT_HOST: "55433", MSYS_NO_PATHCONV: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const keep = (d) => {
      tail = (tail + d).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`run-migrations.sh exited ${code}\n${tail.slice(-1500)}`));
    });
  });
  log("migrations applied");
}

function driver() {
  /**
   * One statement, one JSON answer.
   *
   * `-tAc` with a json wrapper rather than parsing psql's table output: a body containing a pipe
   * or a newline — which post bodies do — would otherwise be read as extra columns.
   */
  async function sql(text) {
    // A CTE rather than a subquery, because half of these statements INSERT or UPDATE and return
    // the row. `select ... from (insert ...)` is a syntax error; `with t as (insert ... returning
    // ...) select ... from t` is how Postgres allows a data-modifying statement to be read from.
    const wrapped = `with t as (${text}) select coalesce(json_agg(t), '[]'::json)::text from t`;
    const { stdout } = await docker([
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-tAc",
      wrapped,
    ]);
    return JSON.parse(stdout.trim() || "[]");
  }

  /** For statements that return nothing, or that are expected to raise. */
  async function exec(text) {
    await docker(["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-c", text]);
  }

  /**
   * Run something and hand back the Postgres error rather than a wrapper's.
   *
   * Half the cases here exist to prove the database REFUSES something, and the useful part is the
   * constraint name — `posts_published_requires_josh`, not "exit code 3".
   */
  async function expectError(text) {
    try {
      await exec(text);
      return null;
    } catch (err) {
      const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}` || String(err?.message ?? err);
      const line = out.split("\n").find((l) => /ERROR:/.test(l)) ?? out;
      return line.replace(/^psql:[^:]*:\d+:\s*/, "").trim();
    }
  }

  /** As a given role, so an RLS or grant assertion is made the way the app would hit it. */
  async function asRole(role, text) {
    return await expectError(`set local role ${role}; ${text}`);
  }

  return { sql, exec, expectError, asRole, container: CONTAINER };
}

export async function stopLocal({ keep = false } = {}) {
  if (keep) return;
  await docker(["rm", "-f", CONTAINER]).catch(() => {});
}
