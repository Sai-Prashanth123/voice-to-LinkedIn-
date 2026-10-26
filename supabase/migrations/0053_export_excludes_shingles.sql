/*
 * Leave the shingle index out of the export, and say why.
 *
 * 0052 made `exportBank` page instead of silently stopping at 1,000 rows. That was right, and it
 * immediately failed with WORKER_RESOURCE_LIMIT: `reference_shingles` holds 398,803 rows and the
 * function tried to load and serialise every one.
 *
 * So the truncation had been hiding a second fault. The honest fix is not a bigger function — it is
 * that this table should never have been in the export.
 *
 * WHY IT IS DENIED RATHER THAN PAGED
 *
 * `reference_shingles` is a derived index: hashed seven-word runs computed from
 * `reference_writer_posts` by scripts/build-reference-shingles.mjs. It contains no fact about Josh
 * and nothing he said. It is rebuildable from a table that IS exported, in one command, and the
 * hashes are meaningless without that table anyway — they are one-way.
 *
 * 0022 chose a deny-list over an allow-list precisely so a table added by a later migration is
 * exported by default, because the previous hard-coded allow-list "silently dropped three". That
 * default is right in general and wrong here: 0050 added this table after 0022 and inherited an
 * export it has no business being in. The deny-list carries a reason for each entry and the reply
 * prints them under `left_out`, so this is visible rather than quiet — which is the whole point of
 * the design.
 *
 * `reference_writer_posts` stays in. It is about 2,000 rows, it is what his library rests on, and
 * clause 6.2 is "everything you have said and everything made from it" — the measurements made from
 * those posts are in that second half.
 */

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
           -- 400,000 one-way hashes derived from reference_writer_posts, which IS exported.
           -- Rebuildable in one command, meaningless on its own, and large enough to fail the
           -- export outright once the export stopped truncating.
           when 'reference_shingles' then 'derived index, rebuilt from the reference posts'
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
  'pk_columns was added on 26 October after the export was found reading .limit(5000) against '
  'PostgREST''s silent 1,000-row ceiling; reference_shingles was denied the same day because paging '
  'it correctly then exhausted the function.';
