-- 0018 — SELECTION AND THE QUEUE (clause 7)
--
-- Four things this fixes, all of them found by reading the selector against the clause rather than
-- against itself:
--
--   7.1  the clause names FIVE factors; the scorer weighed four, and one of those four was doing
--        double duty. Audience was never scored at all.
--   7.2  the retelling check needs an embedding provider. There was none configured, the throw was
--        caught, and every candidate read as new ground. A check that fails open and says nothing is
--        the worst available failure mode on a system whose one job is not repeating himself.
--   7.3  "roughly two weeks of APPROVED posts" was counting unapproved drafts, so a pile of drafts
--        Josh had not looked at stopped selection entirely.
--   7.7  "runs short and says so" said so to a log nobody read — fourteen identical warnings.
--
-- And one data-loss bug: the dedup skip wrote its reason into `moments.notes`, which step 02 made
-- editable by Josh. It clobbered whatever he had written there.

-- ---------------------------------------------------------------------------
-- EMBEDDINGS: 1024 DIMENSIONS, AND ALWAYS WITH THE MODEL THAT MADE THEM
--
-- BAAI/bge-m3 through Hugging Face returns 1024. `published_archive` holds zero rows, so widening
-- the column costs nothing today and would cost a re-embed of the whole back catalogue later.
--
-- The model is recorded on every vector because cosine similarity between two DIFFERENT embedding
-- spaces is a meaningless number that still returns confidently — exactly the sort of quiet
-- wrongness 7.2 cannot afford. Comparison only ever happens within one model.
-- ---------------------------------------------------------------------------

drop index if exists public.published_archive_embedding_idx;

alter table public.published_archive
  drop column embedding,
  add column embedding       extensions.vector(1024),
  add column embedding_model text;

create index published_archive_embedding_idx
  on public.published_archive using hnsw (embedding extensions.vector_cosine_ops);

comment on column public.published_archive.embedding_model is
  'Which model produced this vector. Comparison is only ever within one model: cosine similarity '
  'across two embedding spaces is meaningless and still returns a confident-looking number.';

-- Mined moments are compared against each other too, not just against the archive. Two moments
-- telling the same story would otherwise both queue and both get drafted. Cached by a hash of the
-- source text so the four-hourly run does not re-embed unchanged material.
create table public.moment_embeddings (
  moment_id       bigint primary key references public.moments(id) on delete restrict,
  embedding       extensions.vector(1024) not null,
  embedding_model text not null,
  source_hash     text not null,
  updated_at      timestamptz not null default now()
);

create index moment_embeddings_embedding_idx
  on public.moment_embeddings using hnsw (embedding extensions.vector_cosine_ops);

comment on table public.moment_embeddings is
  '7.2 — the half of the retelling check that compares mined moments against EACH OTHER. Cached on '
  'a hash of the material so the selector does not re-embed unchanged text every four hours.';

-- ---------------------------------------------------------------------------
-- WHY A MOMENT WAS CHOSEN
--
-- The selector claimed in its own comment that "Josh can be told exactly why a moment was chosen".
-- Nothing was stored anywhere. 7.4 gives him override power — pin, kill, not this month — over a
-- ranking he could not see.
-- ---------------------------------------------------------------------------

alter table public.moments
  add column last_score         numeric,
  add column last_score_reasons jsonb,
  add column last_scored_at     timestamptz;

comment on column public.moments.last_score_reasons is
  'Plain-language reasons the score moved, written every selection run (7.1). Shown on the bank '
  'page so 7.4 overrides are informed rather than blind. Deliberately NOT moments.notes, which '
  'belongs to Josh (6.1) and was being clobbered by the dedup skip.';

-- 7.7's audit trail. "If the queue cannot be filled to target without dropping the bar, it must run
-- short and say so" — so what each run decided is recorded, and Josh is told once rather than every
-- four hours forever.
create table public.selection_runs (
  id           bigint generated always as identity primary key,
  ran_at       timestamptz not null default now(),
  target       int not null,
  in_hand      int not null,
  unreviewed   int not null default 0,
  considered   int not null default 0,
  wrote        int not null default 0,
  ran_short    boolean not null default false,
  short_reason text,
  skipped      jsonb not null default '[]'::jsonb,
  notified_at  timestamptz
);

create index selection_runs_ran_at_idx on public.selection_runs (ran_at desc);

comment on table public.selection_runs is
  '7.7 — one row per selection run. `ran_short` with a `short_reason` is a PASS, not a failure: '
  'clause 1 says fewer posts is the correct outcome when the material is not there.';

-- ---------------------------------------------------------------------------
-- SEARCH FUNCTIONS
-- ---------------------------------------------------------------------------

drop function if exists public.match_published(extensions.vector, int);

create or replace function public.match_published(
  query_embedding extensions.vector(1024),
  model text,
  match_count int default 5
)
returns table (
  id         bigint,
  body       text,
  posted_on  date,
  similarity float
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.body,
         a.posted_on,
         1 - (a.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.published_archive a
   where a.embedding is not null
     and a.embedding_model = model
   order by a.embedding operator(extensions.<=>) query_embedding
   limit greatest(1, match_count);
$$;

-- The other half of 7.2: moments already in flight, or picked earlier in this same run. A story
-- queued an hour ago has not been published yet, so the archive knows nothing about it.
create or replace function public.match_moments(
  query_embedding extensions.vector(1024),
  model text,
  exclude_moment bigint,
  match_count int default 5
)
returns table (
  moment_id  bigint,
  ref        text,
  status     text,
  similarity float
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.moment_id,
         m.ref,
         m.status,
         1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.moment_embeddings e
    join public.moments m on m.id = e.moment_id
   where e.embedding_model = model
     and e.moment_id is distinct from exclude_moment
     and m.killed = false
     and m.status in ('queued', 'drafted', 'gated', 'scheduled', 'published')
   order by e.embedding operator(extensions.<=>) query_embedding
   limit greatest(1, match_count);
$$;

revoke execute on function public.match_published(extensions.vector, text, int)
  from public, anon, authenticated;
grant  execute on function public.match_published(extensions.vector, text, int) to service_role;

revoke execute on function public.match_moments(extensions.vector, text, bigint, int)
  from public, anon, authenticated;
grant  execute on function public.match_moments(extensions.vector, text, bigint, int) to service_role;

comment on function public.match_published is
  'Dedup only (7.2). Never a retrieval source for the drafter - see clause 8a.';
comment on function public.match_moments is
  'Dedup only (7.2) - mined moments against each other, so two versions of one story do not both '
  'get written before either is published.';

-- ---------------------------------------------------------------------------
-- RLS: readable by Josh, same single-tenant rule as everything else. No DELETE policy (6.3).
-- ---------------------------------------------------------------------------

alter table public.moment_embeddings enable row level security;
alter table public.selection_runs    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['moment_embeddings', 'selection_runs']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) is not null)',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null)',
      t || '_update', t);
  end loop;
end;
$$;

revoke delete on public.moment_embeddings, public.selection_runs
  from anon, authenticated, service_role;
revoke all on public.moment_embeddings, public.selection_runs from anon;

-- ---------------------------------------------------------------------------
-- SETTINGS
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, note) values
  ('max_unreviewed_drafts', '6'::jsonb,
   '7.3 — drafts Josh has not passed on yet do NOT count as queue depth, but they must not pile up '
   'either. At this many, selection stops and he is told there is a weekly pass waiting.'),
  ('embedding_model', '"BAAI/bge-m3"'::jsonb,
   '7.2 — the model vectors are produced with. Changing it invalidates every stored vector.'),
  ('embedding_dimensions', '1024'::jsonb,
   '7.2 — must match the vector() column width in this migration.'),
  ('recency_spacing_weight', '12'::jsonb,
   '7.1 — how hard a candidate is pushed down for resembling what went out recently. Below the '
   'dedupe_warn threshold this is spacing, not a block.'),
  ('dedupe_thresholds_model', '"BAAI/bge-m3"'::jsonb,
   '7.2 — which embedding model the thresholds below were measured against. If embedding_model '
   'differs from this, the thresholds are guesses and the selector says so.')
on conflict (key) do nothing;

-- RE-CALIBRATING 7.2 FOR THE MODEL ACTUALLY IN USE
--
-- 0.88 / 0.78 came from text-embedding-3-small and were kept when the provider changed, which is a
-- quieter bug than it looks. Measured against BAAI/bge-m3 on real material:
--
--   same incident, reworded            0.79      must block
--   same incident, opposite angle      0.71      must block
--   same incident, both texts clean    0.96      must block   (verified live, M-000008 vs M-000009)
--   same theme, different incident     0.64      must not
--   same theme, generic advice         0.63      must not
--   adjacent territory                 0.50      must not
--   unrelated                          0.45      must not
--
-- The old numbers would have blocked NOTHING — the check would have run every four hours, logged
-- healthily, and let every duplicate through. On the one system whose job is saying something only
-- Josh could say, that is the most expensive kind of quiet.
--
-- The gap between 0.64 and 0.71 is where the judgement sits, and 0.70 sits inside it. It errs
-- towards letting a near-miss through, which is deliberate: a false block silences a story he has
-- never told, and the warn band below still tells the drafter to take a different angle.
update public.settings set
  value = '0.70'::jsonb,
  note = '7.2 hard block: repeating the anecdote. Calibrated on BAAI/bge-m3. RE-MEASURE if the '
         'embedding model changes — similarity scales are not comparable between models.'
where key = 'dedupe_block_similarity';

update public.settings set
  value = '0.62'::jsonb,
  note = '7.2 warn: same territory, different story. Not blocked — the drafter is told what it is '
         'near so it takes a different angle. Calibrated on BAAI/bge-m3.'
where key = 'dedupe_warn_similarity';
