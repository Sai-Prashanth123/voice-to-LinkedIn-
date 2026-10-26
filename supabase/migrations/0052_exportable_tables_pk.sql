/*
 * Tell the export what to order by, so it can page.
 *
 * WHY
 *
 * `exportBank` read every table with `.limit(5000)` and reported `ok: true`. PostgREST caps a
 * response at 1,000 rows however many are asked for — measured and written down twice already in
 * this repository, on `SHAPE_ROWS_PAGE` in `_shared/shape.ts` and in `mcp-server/shape-rows.mjs`.
 * So an export of `reference_writer_posts` (about 2,000 rows) or `reference_shingles` (about
 * 400,000) was silently cut to 1,000.
 *
 * This is clause 6.2, the path behind "nothing is ever held hostage". 0022, which created it, named
 * this exact failure mode in its own comment — "the failure is invisible: a missing table in a JSON
 * file looks exactly like a table with no rows" — and fixed it for a missing table while leaving it
 * open for a truncated one.
 *
 * WHY THE PRIMARY KEY RATHER THAN `id`
 *
 * Paging needs a stable order or the pages overlap and skip: without an ORDER BY, PostgREST makes no
 * promise about which rows a given offset returns. And `id` is not available to order by —
 * `reference_shingles` is keyed on `hash`, `library_sections` on `key`, `outcomes` on `post_id`. So
 * the key comes from the catalogue rather than from an assumption, as an array because a composite
 * key needs every column to be a total order.
 *
 * A table with no primary key returns an empty array, and the caller is expected to say so rather
 * than page it blind.
 */

-- Dropped rather than replaced: the return type gains a column, and Postgres refuses to change the
-- row type of an existing function. In one migration, so the function is never missing between
-- statements.
drop function if exists public.exportable_tables();

create function public.exportable_tables()
returns table (table_name text, excluded_reason text, pk_columns text[])
language sql
stable
security definer
set search_path = ''
as $$
  select t.tablename::text,
         case t.tablename
           -- 15.4 — credentials never leave the system, least of all in a file Josh might email.
           when 'linkedin_auth'      then 'credentials'
           -- Plumbing. It describes how the system was running, not what Josh has said or made.
           when 'jobs'               then 'queue plumbing'
           when 'conversation_state' then 'queue plumbing'
           when 'sent_messages'      then 'queue plumbing'
           when 'llm_calls'          then 'model-call accounting'
           else null
         end,
         coalesce(
           (select array_agg(a.attname::text order by k.ord)
              from pg_constraint c
              join unnest(c.conkey) with ordinality as k(attnum, ord) on true
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
             where c.contype = 'p'
               and c.conrelid = format('%I.%I', t.schemaname, t.tablename)::regclass),
           '{}'::text[]
         )
    from pg_tables t
   where t.schemaname = 'public'
   order by t.tablename;
$$;

revoke execute on function public.exportable_tables() from public, anon;
grant  execute on function public.exportable_tables() to authenticated, service_role;

comment on function public.exportable_tables is
  '6.2 - every table in public, with a reason where it is deliberately left out of the export, and '
  'the primary-key columns to page by. A deny-list rather than an allow-list, so a table added by a '
  'later migration is exported by default: the previous hard-coded list silently dropped three. '
  'pk_columns was added on 26 October because the export read .limit(5000) against PostgREST''s '
  'silent 1,000-row ceiling and reported success.';
