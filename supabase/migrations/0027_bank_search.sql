-- 0027 — SEARCHING THE IDEA BANK (clause 6.1)
--
--   "readable and editable by Josh directly, without a developer"
--
-- The bank page filtered by status and nothing else. That is fine at seventeen moments and useless
-- at the several hundred this is designed to hold — and 6.2 is explicit that a moment "ready in
-- August is often the right post in November", so the bank is meant to grow and be revisited. A
-- store you cannot search is a store you only ever read from the top.
--
-- WHY tsvector RATHER THAN ilike
--
-- `ilike '%term%'` cannot use an index and scans every row. More importantly it matches substrings
-- rather than words, so searching "cost" returns every moment containing "costume" and misses
-- "costs" — which is the wrong behaviour for finding a half-remembered thought.
--
-- WHY TWO COLUMNS RATHER THAN ONE
--
-- A generated column can only read its own row, and the text worth searching is split across two
-- tables: the moment carries its ref, pillar and Josh's notes; `material` carries the actual
-- substance — the scene, the detail, the realisation, the lesson and his own words. Both are
-- indexed, and the function below searches them together.

alter table public.moments
  add column search_text tsvector
  generated always as (
    to_tsvector('english',
      coalesce(ref, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(pillar, '') || ' ' ||
      coalesce(audience, '') || ' ' ||
      coalesce(parked_reason, ''))
  ) stored;

alter table public.material
  add column search_text tsvector
  generated always as (
    to_tsvector('english',
      coalesce(the_moment, '') || ' ' ||
      coalesce(the_detail, '') || ' ' ||
      coalesce(the_realisation, '') || ' ' ||
      coalesce(the_lesson, '') || ' ' ||
      coalesce(their_actual_words, ''))
  ) stored;

create index moments_search_idx  on public.moments  using gin (search_text);
create index material_search_idx on public.material using gin (search_text);

comment on column public.moments.search_text is
  'Clause 6.1. Generated, so it can never drift from the row it describes — there is no trigger to '
  'forget and no backfill to run.';

-- ---------------------------------------------------------------------------
-- The search itself.
--
-- SECURITY INVOKER (the default) is deliberate: the function must see exactly what the caller may
-- see, so row-level security applies to a search the same way it applies to a read. A security
-- definer function here would quietly become a way around RLS.
--
-- `websearch_to_tsquery` rather than `to_tsquery` because the input is whatever Josh types.
-- `to_tsquery` THROWS on ordinary phrases — "finance director" is a syntax error to it — so a plain
-- two-word search would return a 500 rather than results. websearch_to_tsquery accepts what a person
-- would type into any search box, including quoted phrases and -exclusions, and never raises.
-- ---------------------------------------------------------------------------
create or replace function public.search_moments(q text, limit_to int default 50)
returns table (moment_id bigint, rank real)
language sql
stable
set search_path = ''
as $$
  with query as (select websearch_to_tsquery('english', coalesce(q, '')) as tsq)
  select m.id,
         -- The moment's own fields and its material score together, so a hit in Josh's actual words
         -- ranks alongside a hit in the pillar rather than being treated as a separate result.
         (ts_rank(m.search_text, query.tsq)
            + coalesce(ts_rank(mat.search_text, query.tsq), 0))::real as rank
    from public.moments m
    left join public.material mat on mat.moment_id = m.id
   cross join query
   where query.tsq is not null
     and (m.search_text @@ query.tsq or mat.search_text @@ query.tsq)
   order by rank desc, m.captured_at desc
   limit least(coalesce(limit_to, 50), 200);
$$;

comment on function public.search_moments is
  'Clause 6.1. Ranked search across a moment and its material. Security invoker, so RLS applies.';

grant execute on function public.search_moments(text, int) to authenticated;
