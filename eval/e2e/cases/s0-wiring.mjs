/**
 * Stage 0 — is what is deployed the thing that was written?
 *
 * THE CASE THAT PROMPTED THIS WHOLE TIER
 *
 * Every Edge Function bundles its own copy of `_shared/`. Change `views.ts` and ten functions are
 * stale until ten deploys happen. On the day this harness was planned, `telegram-webhook` and
 * `worker-dispatch` carried a fix made that morning and the other eight were running shared code
 * from three days earlier. Everything reported healthy. Every test passed. `S0-02` is the case that
 * would have said so.
 */

import { defineCase, block, skip } from "../harness.mjs";

const EXPECTED_FUNCTIONS = [
  "telegram-webhook", "transcript-webhook", "worker-dispatch", "worker-select",
  "worker-triage", "worker-slack", "worker-publish", "worker-metrics",
  "worker-learn", "worker-ops",
  // The OAuth door. Listed here the moment it was written rather than the moment it was deployed,
  // so S0-01 goes red until it actually ships — which is the whole point of this case. A function
  // that exists in the repository and not in the project is exactly the drift being checked for.
  "linkedin-oauth",
];

const EXPECTED_CRON = [
  "queue-tick", "triage-sweep", "select-tick", "publish-due",
  "metrics-7d", "ops-daily", "ops-monthly", "learn-weekly", "slack-sweep",
];

export const cases = [
  defineCase({
    id: "S0-01",
    stage: 0,
    clause: "13",
    tier: "live",
    name: "all ten Edge Functions are deployed and active",
    async run({ live, assert, seen }) {
      const fns = await live.functions();
      if (!fns) block("no SUPABASE_ACCESS_TOKEN, so the deployed function list cannot be read");

      const bySlug = new Map(fns.map((f) => [f.slug, f]));
      seen("functions", fns.map((f) => ({ slug: f.slug, status: f.status, version: f.version })));

      for (const slug of EXPECTED_FUNCTIONS) {
        const fn = bySlug.get(slug);
        assert.ok(fn, slug + " is deployed");
        assert.equal(fn?.status, "ACTIVE", slug + " is active");
      }
    },
  }),

  defineCase({
    id: "S0-02",
    stage: 0,
    clause: "13.2",
    tier: "live",
    name: "no function is running shared code older than the newest change to _shared",
    async run({ live, assert, seen, note }) {
      const fns = await live.functions();
      if (!fns) block("no SUPABASE_ACCESS_TOKEN, so deployment freshness cannot be checked");

      const { execFileSync } = await import("node:child_process");
      let sharedChangedAt;
      try {
        const iso = execFileSync(
          "git",
          ["log", "-1", "--format=%cI", "--", "supabase/functions/_shared"],
          { encoding: "utf8", cwd: new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") },
        ).trim();
        sharedChangedAt = new Date(iso).getTime();
      } catch {
        skip("git is not available, so the last change to _shared cannot be dated");
      }

      note("shared_last_changed", new Date(sharedChangedAt).toISOString());

      // A one-hour grace: a deploy that raced the commit by minutes is fine, days is not.
      const grace = 60 * 60 * 1000;
      const stale = fns
        .filter((f) => EXPECTED_FUNCTIONS.includes(f.slug))
        .filter((f) => f.updated_at < sharedChangedAt - grace)
        .map((f) => ({ slug: f.slug, deployed: new Date(f.updated_at).toISOString() }));

      seen("stale functions", stale);
      assert.same(
        stale.map((s) => s.slug),
        [],
        "every function was deployed after the last shared-code change",
      );
    },
  }),

  defineCase({
    id: "S0-03",
    stage: 0,
    clause: "13.1",
    tier: "live",
    name: "all nine scheduled jobs are registered",
    async run({ live, assert, seen }) {
      const health = await live.health();
      if (!health) block("system_health() is not deployed — apply migration 0029");

      const names = (health.cron_jobs ?? []).map((j) => j.name);
      seen("cron", health.cron_jobs);
      for (const name of EXPECTED_CRON) {
        assert.includes(names, name, name + " is scheduled");
      }
    },
  }),

  defineCase({
    id: "S0-04",
    stage: 0,
    clause: "6.3",
    tier: "live",
    name: "no application role can delete or truncate anything",
    async run({ live, assert, seen }) {
      const health = await live.health();
      if (!health) block("system_health() is not deployed — apply migration 0029");

      // The guarantee Josh has been given in writing. `postgres` owns the tables and keeps both
      // inherently; what matters is that nothing the system connects as can.
      seen("destructive grants", health.destructive_grants);
      assert.same(health.destructive_grants, [], "no DELETE or TRUNCATE for any application role");
    },
  }),

  defineCase({
    id: "S0-05",
    stage: 0,
    clause: "15.2",
    tier: "live",
    name: "every credential the workers ask for is present in the vault",
    async run({ live, assert, seen }) {
      const health = await live.health();
      if (!health) block("system_health() is not deployed — apply migration 0029");

      const { SECRET_NAMES } = await import("../../../supabase/functions/_shared/secrets.ts");
      const present = new Set(health.secrets ?? []);
      seen("secrets present", health.secrets);

      // A secret that is absent BECAUSE the service has not been bought or connected yet is not a
      // defect — it is one of the outstanding items on the board, and reporting it red would train
      // everyone to ignore this case. These four are named individually rather than pattern-matched
      // so that adding a fifth is a deliberate act.
      const awaited = {
        ANTHROPIC_API_KEY: "no Anthropic key has been bought — component tests 6, 7 and 17a wait on it",
        OPENAI_API_KEY: "declared as a fallback and never keyed",
        SLACK_USER_TOKEN: "Slack ships off by default (4.5.2)",
        LINKEDIN_CLIENT_ID: "LinkedIn is not connected yet",
        LINKEDIN_CLIENT_SECRET: "LinkedIn is not connected yet",
      };

      const missing = SECRET_NAMES.filter((n) => !present.has(n));
      const unexpected = missing.filter((n) => !(n in awaited));
      const expected = missing.filter((n) => n in awaited);
      seen("absent but expected", expected.map((n) => n + " — " + awaited[n]));

      // Names only — system_health() never returns a value, and a check that printed one would be
      // a worse problem than the one it was written to find.
      assert.same(unexpected, [], "every secret the running system needs is present");

      if (expected.length > 0) {
        block(
          expected.length + " declared service(s) not yet keyed: " +
            expected.map((n) => n + " (" + awaited[n] + ")").join("; "),
        );
      }
    },
  }),

  defineCase({
    id: "S0-06",
    stage: 0,
    clause: "4.1",
    tier: "live",
    name: "the Telegram webhook is registered and has never failed to deliver",
    async run({ live, assert, seen }) {
      if (!live.hasBotToken) {
        skip("TELEGRAM_BOT_TOKEN is not in eval/.env, so Telegram's own view cannot be read");
      }
      const info = await live.telegram("getWebhookInfo");
      if (!info) block("Telegram did not answer getWebhookInfo");

      seen("webhook", {
        set: Boolean(info.url),
        pending: info.pending_update_count,
        last_error: info.last_error_message ?? null,
      });

      assert.ok(info.url, "a webhook URL is registered");
      assert.match(info.url, /\/functions\/v1\/telegram-webhook$/, "it points at the live function");
      // A pending backlog means Telegram is holding messages the system never saw.
      assert.ok((info.pending_update_count ?? 0) < 10, "no meaningful backlog of undelivered updates");
      assert.equal(info.last_error_message ?? null, null, "no delivery error recorded");
    },
  }),

  defineCase({
    id: "S0-07",
    stage: 0,
    clause: "15.1",
    tier: "deterministic",
    name: "the tool list Josh holds matches the services the system declares",
    async run({ assert, seen }) {
      const { DECLARED } = await import("../../../supabase/functions/_shared/providers.ts");
      const fs = await import("node:fs");
      const doc = fs.readFileSync(
        new URL("../../../docs/01-recommendations.md", import.meta.url),
        "utf8",
      );

      const inDoc = new Set();
      for (const line of doc.split("\n")) {
        const cell = /^\|\s*\*\*([^*]+)\*\*/.exec(line.trim());
        if (cell) {
          inDoc.add(cell[1].trim().toLowerCase().replace(/\s+/g, "").replace(/developerapp$/, ""));
        }
      }
      seen("declared", Object.keys(DECLARED));

      const missing = Object.keys(DECLARED).filter((n) => !inDoc.has(n));
      assert.same(missing, [], "every declared service appears in the document Josh holds");
    },
  }),

  defineCase({
    id: "S0-09",
    stage: 0,
    clause: "14.1 / 14.3",
    tier: "live",
    name: "the schema the migrations build is the schema that is deployed",
    async run({ db, live, assert, seen }) {
      if (!db) skip("the throwaway database is not up, so there is nothing to compare against");

      // THE CASE THAT FOUND A REAL ONE. `posts.announced_at` existed in production and in no
      // migration — added by hand during development and never written down. Both halves worked:
      // the migrations applied cleanly, and the live system had the column. Only the relationship
      // was wrong, and the consequence was reserved entirely for handover, where a rebuild into
      // Josh's account would have produced a database whose draft digest could not run.
      const built = await db.sql(
        "select table_name, count(*)::int as n from information_schema.columns " +
          "where table_schema = 'public' group by table_name order by table_name",
      );
      const health = await live.health();
      if (!health) block("system_health() is not deployed — apply migration 0029");

      // Compared per table rather than per column: a count mismatch is enough to catch drift, and
      // it needs no way to enumerate the live schema through PostgREST.
      const builtByTable = Object.fromEntries(built.map((r) => [r.table_name, r.n]));
      const deployedByTable = health.columns_by_table ?? {};
      seen("built", builtByTable);
      seen("deployed", deployedByTable);

      const drift = Object.keys(deployedByTable)
        .filter((t) => builtByTable[t] !== deployedByTable[t])
        .map((t) => t + ": deployed " + deployedByTable[t] + ", migrations " + (builtByTable[t] ?? "missing"));

      assert.ok(built.length >= 28, "the migrations build every table");
      assert.same(drift, [], "no table differs between what is deployed and what the migrations build");
    },
  }),

  defineCase({
    id: "S0-08",
    stage: 0,
    clause: "14.3",
    tier: "deterministic",
    name: "the whole schema builds from nothing, in order",
    async run({ db, assert, seen }) {
      // The database this case runs against was itself built by applying every migration to an
      // empty Postgres, so reaching here at all is most of the proof. What is asserted is that the
      // result is the shape the rest of the system expects.
      const [{ n: tables }] = await db.sql(
        "select count(*)::int as n from information_schema.tables " +
          "where table_schema = 'public' and table_type = 'BASE TABLE'",
      );
      const [{ n: policies }] = await db.sql(
        "select count(*)::int as n from pg_policies where schemaname = 'public'",
      );
      seen("schema", { tables, policies });

      assert.ok(tables >= 28, "every table exists");
      assert.ok(policies > 0, "row-level security is in place");
    },
  }),
];
