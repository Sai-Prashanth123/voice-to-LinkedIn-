-- 0037 — IDEAS ARE NAMED BY THE PERSON WHO HAD THEM
--
-- Every idea used to be known by a number the system minted: "Got it. (M-000035)". Nobody thinks
-- of their own story as M-000035, so "rewrite M-000024" was a sentence only the system could say.
-- The person now names each idea, right after capturing it, and that name is what every surface
-- shows and what "rewrite <name>" finds.
--
-- `ref` STAYS. Clause 6 specifies a stable public id that survives a tool migration, and a name the
-- person can change is not that. It simply stops being shown.
--
-- NO DEFAULT, deliberately. A generated name ("CFO email idea") would be the system deciding what
-- the story is about before the interview has found out, and the ask was that the name comes from
-- the person. An idea with no title is an idea still waiting to be named, and the interview does
-- not begin until it is.

alter table public.moments
  add column title text,
  add constraint moments_title_shape
    check (title is null or (length(btrim(title)) between 1 and 80 and title = btrim(title)));

-- Two live ideas cannot share a name, or "rewrite <name>" would have to guess. Killed ideas are
-- exempt: a name should be reusable once the idea that held it is gone.
create unique index moments_title_unique_live
  on public.moments (lower(title))
  where title is not null and not killed;

-- Telegram waits for the name the same way it waits for an answer.
alter table public.conversation_state
  drop constraint conversation_state_awaiting_check;

alter table public.conversation_state
  add constraint conversation_state_awaiting_check
  check (awaiting in (
    'nothing',
    'answer',
    'idea_name',           -- the name for a just-captured (or never-named) idea
    'visual_details',
    'visual_feedback',
    'name_clearance',
    'candidate_choice',
    'disambiguate',
    'seeding',
    'voice_guide_capture',
    'draft_verdict'
  ));

-- Search finds an idea by its name. The column is generated, so it is rebuilt rather than altered.
drop index if exists public.moments_search_idx;
alter table public.moments drop column search_text;

alter table public.moments
  add column search_text tsvector
  generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(ref, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(pillar, '') || ' ' ||
      coalesce(audience, '') || ' ' ||
      coalesce(parked_reason, ''))
  ) stored;

create index moments_search_idx on public.moments using gin (search_text);

comment on column public.moments.title is
  'The name the person gave this idea. Shown everywhere instead of ref. Null means it has not been '
  'named yet, and the interview waits until it is.';

-- The duplicate check says "this looks like <ref>" to a person, so `ref` now carries the idea's name.
-- The column keeps its name so the function's signature does not change.
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
         coalesce('"' || m.title || '"', 'another idea you have not named yet'),
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
