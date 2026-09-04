-- 0029 — one read-only snapshot of the things only the catalogue knows.
--
-- WHY A FIXED FUNCTION RATHER THAN "RUN THIS SQL"
--
-- The end-to-end harness needs facts PostgREST cannot reach: which cron jobs are scheduled, how
-- many policies and grants exist, which secrets are present. The obvious shortcut is a function
-- that takes a query string and runs it. That is a remote SQL console with the service role behind
-- it, and no amount of "it is only for tests" makes that safe to leave in a client's project.
--
-- So this takes no arguments and returns a fixed shape. There is nothing to inject into.
--
-- SECRETS ARE COUNTED AND NAMED, NEVER RETURNED
--
-- `secrets` lists the NAMES present in the vault so a missing credential is visible. It never
-- returns a value. A health check that hands back an API key is a worse problem than the one it
-- was written to find.
--
-- Useful beyond the harness: worker-ops can report the same snapshot in the monthly message, and
-- the handover runbook can ask one question instead of nine.

create or replace function public.system_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tables', (
      select count(*) from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    ),
    'cron_jobs', (
      select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule)
             order by jobname), '[]'::jsonb)
      from cron.job
    ),
    'policies', (
      select count(*) from pg_policies where schemaname = 'public'
    ),
    'check_constraints', (
      select count(*) from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and c.contype = 'c'
    ),
    -- The 6.3 guarantee, as a number rather than a claim: no application role may delete or
    -- truncate anything in public. `postgres` owns the tables and keeps both inherently.
    'destructive_grants', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'grantee', grantee, 'table', table_name, 'privilege', privilege_type)), '[]'::jsonb)
      from information_schema.role_table_grants
      where table_schema = 'public'
        and privilege_type in ('DELETE', 'TRUNCATE')
        and grantee in ('anon', 'authenticated', 'service_role', 'content_mcp')
    ),
    'secrets', (
      select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from vault.secrets
    ),
    -- Per-table column counts, so eval/e2e can compare the schema the migrations build against
    -- the one that is deployed. That comparison is what found posts.announced_at missing.
    'columns_by_table', (
      select coalesce(jsonb_object_agg(table_name, n), '{}'::jsonb)
      from (select table_name, count(*)::int as n from information_schema.columns
            where table_schema = 'public' group by table_name) c
    ),
    'roles', (
      select coalesce(jsonb_agg(rolname order by rolname), '[]'::jsonb)
      from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'content_mcp')
    ),
    'measured_at', now()
  );
$$;

comment on function public.system_health() is
  'Read-only deployment snapshot for eval/e2e and worker-ops. Takes no arguments by design; names '
  'vault secrets but never returns their values.';

revoke all on function public.system_health() from public;
grant execute on function public.system_health() to service_role;
