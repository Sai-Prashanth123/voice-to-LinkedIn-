-- 0005 — JOB QUEUE, DEDUP ARCHIVE, INSTRUMENTATION, SETTINGS
--
-- Orchestration is a Postgres queue driven by pg_cron, with Edge Functions as workers. Every step is
-- its own invocation, which keeps each one well inside the Edge Function wall-clock limit and makes
-- the whole pipeline resumable and observable. No always-on server to hand over (14.3).

create table public.jobs (
  id           bigint generated always as identity primary key,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  status       public.job_status not null default 'pending',
  attempts     int not null default 0,
  max_attempts int not null default 5,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  dedupe_key   text unique,                          -- optional idempotency for cron-created jobs
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Partial index: the claim query only ever looks at pending work.
create index jobs_claim_idx on public.jobs (run_after, id)
  where status = 'pending';
create index jobs_status_idx on public.jobs (status, updated_at desc);

-- Atomic claim-and-update. SKIP LOCKED lets workers run concurrently without blocking each other.
create or replace function public.claim_jobs(
  p_worker text,
  p_types  text[] default null,
  p_limit  int default 1
)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
     set status     = 'running',
         attempts   = j.attempts + 1,
         locked_at  = now(),
         locked_by  = p_worker,
         updated_at = now()
   where j.id in (
     select id
       from public.jobs
      where status = 'pending'
        and run_after <= now()
        and (p_types is null or type = any(p_types))
      order by run_after, id
      limit p_limit
      for update skip locked
   )
  returning j.*;
$$;

-- Release a job back to pending with backoff, or mark it dead once attempts are exhausted.
-- 13.2: failures must surface rather than being swallowed.
create or replace function public.fail_job(p_id bigint, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
  v_max      int;
begin
  select attempts, max_attempts into v_attempts, v_max
    from public.jobs where id = p_id;

  if v_attempts >= v_max then
    update public.jobs
       set status = 'dead', last_error = p_error, updated_at = now()
     where id = p_id;
    insert into public.system_events (kind, severity, detail)
    values ('job_dead', 'error',
            jsonb_build_object('job_id', p_id, 'error', p_error));
  else
    update public.jobs
       set status     = 'pending',
           last_error = p_error,
           run_after  = now() + (interval '1 minute' * power(3, v_attempts)),
           locked_at  = null,
           locked_by  = null,
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- THE PUBLISHED ARCHIVE — dedup only (7.2), NEVER a source of voice (clause 8a)
--
-- "Those posts were written with heavy AI assistance, and they have drifted from how Josh actually
--  sounds. Training the system on them would reproduce exactly the problem it exists to solve."
--
-- This lives in its own table with its own loader. It is read by the selector to avoid retelling a
-- story, and by nothing else. It must never be joined into a drafting context.
-- ---------------------------------------------------------------------------
create table public.published_archive (
  id         bigint generated always as identity primary key,
  origin     text not null check (origin in ('historic', 'system')),
  moment_id  bigint references public.moments(id) on delete restrict,
  body       text not null,
  posted_on  date,
  embedding  vector(1536),
  created_at timestamptz not null default now()
);

create index published_archive_embedding_idx
  on public.published_archive using hnsw (embedding vector_cosine_ops);

comment on table public.published_archive is
  'DEDUP ONLY (7.2). Never read by the drafter or the voice guide. See clause 8a: the archive is not '
  'the calibration set and must not be used as one.';

-- ---------------------------------------------------------------------------
-- QUESTION PERFORMANCE (4.2.6)
-- "A question that lands stays as it is. A question that does not gets rephrased, not retired."
-- There is deliberately no `retired` column: retiring a question must be impossible.
-- ---------------------------------------------------------------------------
create table public.question_stats (
  key               text primary key,
  original_text     text not null,
  current_text      text not null,
  depth             public.interview_depth,
  asked             int not null default 0,
  produced_material int not null default 0,
  rephrase_count    int not null default 0,
  last_rephrased_at timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table public.question_stats is
  'Per-question yield, driving 4.2.6. No retire column by design — a question that does not land is '
  'rephrased, never dropped.';

-- ---------------------------------------------------------------------------
-- INSTRUMENTATION — 13.3 counters cannot be backfilled, so they go in from day one.
-- ---------------------------------------------------------------------------
create table public.llm_calls (
  id             bigint generated always as identity primary key,
  purpose        text not null,                      -- interview | draft | gate:<check> | triage | ...
  model          text not null,
  moment_id      bigint references public.moments(id) on delete restrict,
  draft_id       bigint references public.drafts(id) on delete restrict,
  prompt_version text,
  input_tokens   int,
  output_tokens  int,
  cache_read_tokens int,
  cost_usd       numeric(10,6),
  latency_ms     int,
  stop_reason    text,
  error          text,
  created_at     timestamptz not null default now()
);

create index llm_calls_created_idx on public.llm_calls (created_at desc);
create index llm_calls_purpose_idx on public.llm_calls (purpose, created_at desc);

create table public.system_events (
  id         bigint generated always as identity primary key,
  kind       text not null,                          -- input_ok | input_failed | job_dead | queue_low
  severity   text not null default 'info'
               check (severity in ('info', 'warn', 'error')),
  source     public.moment_source,
  detail     jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index system_events_recent_idx on public.system_events (created_at desc);
create index system_events_unnotified_idx on public.system_events (created_at)
  where notified_at is null and severity in ('warn', 'error');

comment on table public.system_events is
  'Clause 13. The operational risk is not that it breaks, it is that it breaks quietly. Nothing is '
  'swallowed (13.2) and silence is not the same as nothing happening (13.1).';

-- ---------------------------------------------------------------------------
-- SETTINGS — the knobs Josh controls without a developer
-- ---------------------------------------------------------------------------
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value, note) values
  ('slack_enabled',            'false'::jsonb,
   '4.5.2 — off by default until Josh says otherwise'),
  ('silence_alert_days',       '4'::jsonb,
   '13.1 — the agreed number of days. CONFIRM WITH JOSH.'),
  ('queue_target_posts',       '10'::jsonb,
   '7.3 — roughly two weeks of approved posts at 4-5/week'),
  ('cc_candidates_per_day',    '3'::jsonb,
   '4.4.3 — ten a day is worse than no version at all'),
  ('candidates_per_session',   '3'::jsonb,
   '7.5 — only the strongest few raised in any one session'),
  ('interview_max_questions',  '8'::jsonb,
   '5.8 — a session that runs to fifteen questions gets abandoned'),
  ('candidate_age_out_days',   '45'::jsonb,
   '7.6 — unmined candidates age quietly to parked'),
  ('dedupe_block_similarity',  '0.88'::jsonb,
   '7.2 — hard block: repeating the anecdote'),
  ('dedupe_warn_similarity',   '0.78'::jsonb,
   '7.2 — warn: rewriting an angle is fine'),
  ('posts_per_week_target',    '4.5'::jsonb,
   'clause 1 — quality wins over quantity, every time');
