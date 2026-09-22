-- 0040 — A BUSY PROVIDER COSTS SECONDS, NOT TWENTY MINUTES
--
-- Josh, 22 September: "it's taking like 20 minutes for messages to come through". Measured against
-- his session: seven jobs hit `TRANSIENT gemini 503`, averaging 5.6 attempts, the worst delivering
-- its question 1,419 seconds — 23 minutes and 39 seconds — after he answered.
--
-- Three things compounded, and this migration fixes the two that live in the database.
--
-- 1. THE TRANSIENT LADDER WAS IN MINUTES. `least(10 minutes, 1 minute * 2^attempts)` was written for
--    a provider that had run out of credit, where waiting is the only option. A 503 from a free tier
--    is usually over within a second, so the wait was two orders of magnitude longer than the fault.
--
-- 2. `attempts` WAS COUNTED TWICE PER CYCLE. `claim_jobs` increments it when it takes the job, and
--    `fail_job` incremented it again on the way out — so the exponent climbed at double speed and
--    the ladder read 2 minutes, 8 minutes, then the ceiling, in three failures rather than six.
--    Counting the attempt once, where the attempt is actually made, also makes `max_attempts` mean
--    what it says.
--
-- The third fix is in code: the provider is now retried in-process within seconds, and a genuinely
-- struggling provider hands over to another with a key (`_shared/llm.ts`).

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

  -- A transient failure is not the job's fault, so it is allowed far more attempts than a job that
  -- is genuinely broken. Unchanged from 0021.
  v_ceiling := case when v_transient then greatest(v_max, 40) else v_max end;

  v_backoff := case
    -- 20s, 40s, 80s, 160s, 320s, capped at 5 minutes. A provider that is briefly busy is retried
    -- while the person is still looking at their phone.
    when v_transient then least(interval '5 minutes', interval '20 seconds' * power(2, least(v_attempts - 1, 5)))
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
    -- `attempts` is NOT incremented here: claim_jobs already counted this attempt when it took the
    -- job. Incrementing in both places doubled the exponent and halved the number of real tries.
    update public.jobs
       set status     = 'pending',
           last_error = p_error,
           run_after  = now() + v_backoff,
           locked_at  = null,
           locked_by  = null,
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

comment on function public.fail_job is
  'Retry with backoff. Transient (provider) failures wait seconds and are allowed many attempts; a '
  'broken job backs off in minutes and dies at max_attempts. The attempt itself is counted by '
  'claim_jobs, never here.';
