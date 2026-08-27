-- 0026 — WHICH SERVICES THIS SYSTEM ACTUALLY REACHES (clauses 15.1 and 15.3)
--
--   15.1 "Thought Pilot must tell Josh which tools and services the system uses and what each one
--         does, before they go in."
--   15.3 "Where a new tool is added later, Josh should be told AT THE TIME rather than finding it on
--         a statement."
--
-- The tool list Josh was given names Anthropic and OpenAI. Neither is keyed. Groq and Hugging Face,
-- which appear nowhere in it, have been running the drafter, the gate and the dedup embeddings for
-- days. Nothing in the build noticed, because nothing in the build was looking: a document that
-- stops describing the system produces no error.
--
-- So the system records what it actually calls, and says so. Recorded AT THE POINT OF USE rather
-- than inferred from a model string — "openai/gpt-oss-120b" is served by Groq, and any rule clever
-- enough to work that out is a rule that will be wrong about the next one.

create table public.providers_seen (
  provider     text primary key,           -- 'groq', 'huggingface', 'deepgram', 'telegram', ...
  purposes     text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Set when Josh has been told. Null means he has not, which is what 15.3 is about.
  announced_at timestamptz
);

comment on table public.providers_seen is
  'Clause 15.1/15.3. One row per external service the system has actually called, written when it '
  'is called. worker-ops compares this against the declared list in _shared/providers.ts and tells '
  'Josh once about anything he was never told about.';

comment on column public.providers_seen.announced_at is
  '15.3 — told at the time. Null means Josh has not been told this service is in use. Set once, so '
  'the daily run does not repeat itself; the same rule as system_events.notified_at.';

alter table public.providers_seen enable row level security;

create policy providers_seen_select on public.providers_seen
  for select to authenticated using ((select auth.uid()) is not null);

revoke delete on public.providers_seen from anon, authenticated, service_role;
revoke all    on public.providers_seen from anon;

-- ---------------------------------------------------------------------------
-- 15.9 — "if the running cost moves materially, Thought Pilot raises it."
--
-- Cost was recorded per MODEL, which cannot answer "what is this service costing us" once one
-- provider serves several models under names belonging to another (Groq serving gpt-oss-120b).
-- ---------------------------------------------------------------------------
alter table public.llm_calls
  add column if not exists provider text;

comment on column public.llm_calls.provider is
  '15.9. Which service was billed, as opposed to which model was asked for. The two stopped matching '
  'the moment a provider began serving models named after somebody else.';

-- One upsert, so callers do not race each other on first use.
create or replace function public.note_provider(p_provider text, p_purpose text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.providers_seen (provider, purposes)
  values (p_provider, array[p_purpose])
  on conflict (provider) do update
    set last_seen_at = now(),
        purposes = (
          select array_agg(distinct x)
          from unnest(public.providers_seen.purposes || array[p_purpose]) as x
        );
$$;

comment on function public.note_provider is
  'Clause 15.3. Called at the point a service is used. Idempotent and cheap: after the first call of '
  'a given purpose it only moves last_seen_at.';
