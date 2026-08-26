-- 0021 — A RATE LIMIT MUST NOT KILL A JOB
--
-- `fail_job` counted every failure the same way, so five consecutive 429s exhausted `max_attempts`
-- and marked the job dead. That is exactly backwards: the whole point of marking an error TRANSIENT
-- is that it says nothing about the work. A job that would have succeeded a minute later is
-- destroyed by the provider being busy for five.
--
-- Watched it happen: an interview question for M-000010 — a real voice note Josh recorded — died
-- against Groq's per-minute ceiling while the moment sat waiting for its follow-up. The moment
-- survives (6.3), but the conversation stops, and nothing about that is the moment's fault.
--
-- So transient failures get their own, much larger allowance and a gentler backoff. They still are
-- not infinite: a provider that has been refusing for hours is a problem to fix rather than to keep
-- retrying, and `job_dead` at that point is the right signal.
--
-- The distinction is drawn on the error text because that is where `_shared/llm.ts` already marks it
-- — one word, prefixed at the only place that can tell the difference.

create or replace function public.fail_job(p_id bigint, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts    int;
  v_max         int;
  v_transient   boolean := p_error like 'TRANSIENT %' or p_error like '%TRANSIENT %';
  v_ceiling     int;
  v_backoff     interval;
begin
  select attempts, max_attempts into v_attempts, v_max
    from public.jobs where id = p_id;

  -- Transient failures are cheap to retry and say nothing about the work, so they get a far larger
  -- allowance. 40 attempts at a capped ten-minute backoff is a few hours of a provider misbehaving
  -- before anyone needs to look at it.
  v_ceiling := case when v_transient then greatest(v_max, 40) else v_max end;

  -- And a gentler curve. The standard 3^n reaches an hour by the fourth attempt, which is the wrong
  -- shape for a limit that clears in sixty seconds — it turns a one-minute problem into an hour of
  -- silence in the middle of a conversation.
  v_backoff := case
    when v_transient then least(interval '10 minutes', interval '1 minute' * power(2, least(v_attempts, 6)))
    else interval '1 minute' * power(3, v_attempts)
  end;

  if v_attempts >= v_ceiling then
    update public.jobs
       set status = 'dead', last_error = p_error, updated_at = now()
     where id = p_id;
    insert into public.system_events (kind, severity, detail)
    values ('job_dead', 'error',
            jsonb_build_object('job_id', p_id, 'error', p_error, 'transient', v_transient));
  else
    update public.jobs
       set status     = 'pending',
           last_error = p_error,
           run_after  = now() + v_backoff,
           locked_at  = null,
           locked_by  = null,
           attempts   = v_attempts + 1,
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

revoke execute on function public.fail_job(bigint, text) from public, anon, authenticated;
grant  execute on function public.fail_job(bigint, text) to service_role;

comment on function public.fail_job is
  'Retry with backoff. A TRANSIENT error - rate limit, 5xx, billing - gets a much larger allowance '
  'and a capped backoff, because it says nothing about the work: killing a job because the provider '
  'was busy for five minutes destroys work that would have succeeded on the sixth.';

-- Revive anything killed by the old rule. Nothing is deleted (6.3); the dead rows are simply wrong.
update public.jobs
   set status = 'pending', attempts = 0, run_after = now(), updated_at = now()
 where status = 'dead'
   and last_error like '%TRANSIENT%';
