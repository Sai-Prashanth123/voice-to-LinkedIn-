/**
 * Does migration 0061 actually give the three new tables the properties it claims?
 *
 * `probe.mjs` answers "do all the migrations apply" and asserts the delete guarantee across the
 * schema. That passed on the first run with 0061 in place, which proves the SQL parses and proves
 * nothing about whether `creators` is readable by the connector, whether the CHECK constraints
 * refuse what they are meant to refuse, or whether the cron job was registered.
 *
 * This repo's recurring defect is a value nothing reads or a check with nothing to check, and a
 * grant without a policy is the exact shape of it: 0045 exists because `notices` and
 * `reference_writer_posts` shipped with a SELECT grant, RLS on, and no policy naming the role — a
 * read that silently returns nothing, hidden for weeks because the connector falls back to the
 * service role, which bypasses RLS.
 *
 *   cd local && node probe-0061.mjs
 */

import EmbeddedPostgres from "embedded-postgres";
import { join } from "node:path";
import { rmSync } from "node:fs";

import { applySchema, INITDB_FLAGS } from "./schema.mjs";

const REPO = join(import.meta.dirname, "..");
const DATA = join(import.meta.dirname, "pgdata-probe-0061");

rmSync(DATA, { recursive: true, force: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "probe",
  port: 54998,
  persistent: false,
  initdbFlags: INITDB_FLAGS,
});

await pg.initialise();
await pg.start();
const db = pg.getPgClient();
await db.connect();

const TABLES = ["creators", "creator_posts", "comment_options"];
let failures = 0;
const say = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

try {
  const { applied, total, failures: schemaFailures } = await applySchema(db, REPO);
  console.log(`\nmigrations: ${applied} of ${total} applied`);
  for (const f of schemaFailures) console.log(`  FAILED ${f}`);
  if (schemaFailures.length) process.exit(1);

  /* ── The tables exist ──────────────────────────────────────────────────── */
  console.log("\nthe three tables");
  for (const t of TABLES) {
    const { rows } = await db.query(
      `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
      [t],
    );
    say(rows.length === 1, `public.${t} exists`);
  }

  /* ── The connector can READ them, and cannot write ─────────────────────── */
  //
  // Both halves. A grant with no policy reads as empty; a policy with no grant is a 42501. The
  // failure modes look nothing alike and neither is visible from the tool that suffers it.
  console.log("\nwhat content_mcp may do (select yes, everything else no)");
  for (const t of TABLES) {
    const { rows } = await db.query(
      `select privilege_type from information_schema.role_table_grants
        where grantee='content_mcp' and table_schema='public' and table_name=$1`,
      [t],
    );
    const held = rows.map((r) => r.privilege_type).sort();
    say(held.includes("SELECT"), `${t}: content_mcp has SELECT`, held.join(",") || "none");
    const forbidden = held.filter((p) => ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].includes(p));
    say(forbidden.length === 0, `${t}: content_mcp has no write`, forbidden.join(",") || "none held");
  }

  console.log("\nand a policy naming that role, or the grant reads as empty (0045)");
  for (const t of TABLES) {
    const { rows } = await db.query(
      `select policyname from pg_policies
        where schemaname='public' and tablename=$1 and 'content_mcp' = any(roles)`,
      [t],
    );
    say(rows.length >= 1, `${t}: has a content_mcp policy`,
      rows.map((r) => r.policyname).join(",") || "NONE");
  }

  console.log("\nRLS is on");
  for (const t of TABLES) {
    const { rows } = await db.query(
      `select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`,
      [t],
    );
    say(rows[0]?.relrowsecurity === true, `${t}: row level security enabled`);
  }

  /* ── Nothing is deletable ──────────────────────────────────────────────── */
  console.log("\nnothing is deletable (S0-04)");
  for (const t of TABLES) {
    const { rows } = await db.query(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name=$1
          and privilege_type in ('DELETE','TRUNCATE')
          and grantee in ('anon','authenticated','service_role','content_mcp','PUBLIC')`,
      [t],
    );
    say(rows.length === 0, `${t}: no destructive grant to any app role`,
      rows.map((r) => `${r.grantee}:${r.privilege_type}`).join(",") || "clean");
  }

  /* ── The constraints refuse what they are for ──────────────────────────── */
  console.log("\nthe CHECK constraints actually refuse");
  const refuses = async (label, sql, params = []) => {
    try {
      await db.query("begin");
      await db.query(sql, params);
      await db.query("rollback");
      say(false, label, "it was ACCEPTED");
    } catch (e) {
      await db.query("rollback");
      say(true, label, e.message.split("\n")[0].slice(0, 70));
    }
  };
  const accepts = async (label, sql, params = []) => {
    try {
      await db.query("begin");
      await db.query(sql, params);
      await db.query("rollback");
      say(true, label);
    } catch (e) {
      await db.query("rollback");
      say(false, label, e.message.split("\n")[0].slice(0, 90));
    }
  };

  const addCreator = `insert into public.creators (handle, display_name, profile_url)
                      values ($1, $2, $3)`;
  await accepts("a real creator is accepted", addCreator,
    ["mattjbarker1", "Matt Barker", "https://www.linkedin.com/in/mattjbarker1/"]);
  await refuses("a non-LinkedIn profile_url is refused", addCreator,
    ["someone", "Someone", "https://example.com/someone"]);
  await refuses("a handle with a slash is refused", addCreator,
    ["in/someone", "Someone", "https://www.linkedin.com/in/someone/"]);

  // A post must have text, and must belong to a creator on the list.
  await refuses(
    "a post for an unknown creator is refused",
    `insert into public.creator_posts (activity_id, handle, text) values ('a', 'nobody', 'x')`,
  );
  await db.query(addCreator, ["demandjen1", "Jen", "https://www.linkedin.com/in/demandjen1/"]);
  await refuses(
    "a post with blank text is refused",
    `insert into public.creator_posts (activity_id, handle, text) values ('b', 'demandjen1', '   ')`,
  );

  // The one that keeps the learning signal honest.
  await db.query(
    `insert into public.creator_posts (activity_id, handle, text) values ('c', 'demandjen1', 'a post')`,
  );
  await refuses(
    "a decided option with no decided_at is refused",
    `insert into public.comment_options (activity_id, body, status)
     values ('c', 'a comment', 'used')`,
  );
  await accepts(
    "a decided option WITH decided_at is accepted",
    `insert into public.comment_options (activity_id, body, status, decided_at)
     values ('c', 'a comment', 'used', now())`,
  );
  await refuses(
    "an unknown status is refused",
    `insert into public.comment_options (activity_id, body, status, decided_at)
     values ('c', 'a comment', 'posted', now())`,
  );
  await refuses(
    "flags must be an array, not an object",
    `insert into public.comment_options (activity_id, body, flags)
     values ('c', 'a comment', '{"named":"x"}'::jsonb)`,
  );
  await accepts(
    "an offered option with default flags is accepted",
    `insert into public.comment_options (activity_id, body) values ('c', 'a comment')`,
  );

  /* ── The settings and the schedule ─────────────────────────────────────── */
  console.log("\nthe settings rows and the schedule");
  for (const k of ["comment_posts_per_run", "comment_options_per_post"]) {
    const { rows } = await db.query(`select value from public.settings where key=$1`, [k]);
    say(rows.length === 1, `settings.${k} seeded`, JSON.stringify(rows[0]?.value));
  }

  /*
   * The shim stubs cron.schedule, so this proves the call is well-formed and reached it — not that
   * pg_cron accepted the expression. The real registration is asserted against the live project by
   * eval/e2e case S0-03, which reads cron.job through system_health().
   */
  const { rows: jobs } = await db.query(
    `select jobname, schedule from cron.job where jobname = 'creator-poll'`,
  ).catch(() => ({ rows: [] }));
  if (jobs.length) {
    say(jobs[0].schedule === "0 7,15 * * 1-5", "creator-poll registered twice daily, weekdays",
      jobs[0].schedule);
  } else {
    console.log("  --    cron.job is a shim here; S0-03 asserts the real registration");
  }

  console.log(failures === 0 ? "\nALL GOOD\n" : `\n${failures} FAILURE(S)\n`);
} finally {
  await db.end();
  await pg.stop();
}

process.exit(failures === 0 ? 0 : 1);
