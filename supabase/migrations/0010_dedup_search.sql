-- 0010 — DEDUP SEARCH (7.2)
--
-- "Must check against what has already been published and not retell a story Josh has already told.
--  Rewriting an angle is fine. Repeating the anecdote is not."
--
-- Read by the selector and by nothing else. This is the ONLY sanctioned use of the published
-- archive: clause 8a is explicit that those posts must never inform how a new post is written.

create or replace function public.match_published(
  query_embedding extensions.vector(1536),
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
   order by a.embedding operator(extensions.<=>) query_embedding
   limit greatest(1, match_count);
$$;

revoke execute on function public.match_published(extensions.vector, int)
  from public, anon, authenticated;
grant execute on function public.match_published(extensions.vector, int) to service_role;

comment on function public.match_published is
  'Dedup only (7.2). Never a retrieval source for the drafter - see clause 8a.';
