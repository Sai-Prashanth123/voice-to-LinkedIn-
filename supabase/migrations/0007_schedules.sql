-- 0007 — SCHEDULED WORK (pg_cron) AND WORKER DISPATCH (pg_net)
--
-- The queue is ticked by cron; each tick invokes the dispatcher Edge Function, which claims jobs and
-- runs one step per invocation. Nothing long-running lives in Postgres itself.
--
-- Secrets live in Supabase Vault, never in a table Josh might export. Set them once, in his project:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
--   select vault.create_secret('<service_role_key>',                     'service_role_key');

create or replace function public.invoke_worker(p_name text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_key  text;
begin
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'functions_base_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if v_base is null or v_key is null then
    insert into public.system_events (kind, severity, detail)
    values ('worker_dispatch_unconfigured', 'error',
            jsonb_build_object('worker', p_name));
    return null;
  end if;

  return net.http_post(
    url     := v_base || '/' || p_name,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := p_payload,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.invoke_worker(text, jsonb) from public, anon, authenticated;

-- Enqueue helper used by workers and by the app.
create or replace function public.enqueue(
  p_type       text,
  p_payload    jsonb default '{}'::jsonb,
  p_run_after  timestamptz default now(),
  p_dedupe_key text default null
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.jobs (type, payload, run_after, dedupe_key)
  values (p_type, p_payload, p_run_after, p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id;
$$;

grant execute on function public.enqueue(text, jsonb, timestamptz, text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------

-- Queue tick. 4.1.5: a captured moment must not sit waiting for a nightly run.
select cron.schedule('queue-tick', '* * * * *', $$select public.invoke_worker('worker-dispatch')$$);

-- 4.4.1 Claude Code digests arrive from Josh's machine; this sweeps anything queued for triage.
select cron.schedule('triage-sweep', '*/15 * * * *', $$select public.invoke_worker('worker-triage')$$);

-- 7.3 keep roughly two weeks of approved posts ahead of the calendar.
select cron.schedule('select-tick', '0 */4 * * *', $$select public.invoke_worker('worker-select')$$);

-- 11.2 / R3: this only ever publishes posts Josh has marked ready, on the date he set.
select cron.schedule('publish-due', '*/5 * * * *', $$select public.invoke_worker('worker-publish')$$);

-- 12.1 engagement numbers at seven days, with no action from Josh at any point.
select cron.schedule('metrics-7d', '0 9 * * *', $$select public.invoke_worker('worker-metrics')$$);

-- 13.1 silence check, 13.4 queue-low warning, 7.6 candidate age-out.
select cron.schedule('ops-daily', '0 8 * * *', $$select public.invoke_worker('worker-ops',
  jsonb_build_object('mode', 'daily'))$$);

-- 12.14 + 13.3 the two monthly reports.
select cron.schedule('ops-monthly', '0 9 1 * *', $$select public.invoke_worker('worker-ops',
  jsonb_build_object('mode', 'monthly'))$$);

-- 12.9 look across the signals and propose evidenced library changes for Josh to approve.
select cron.schedule('learn-weekly', '0 7 * * 1', $$select public.invoke_worker('worker-learn')$$);
