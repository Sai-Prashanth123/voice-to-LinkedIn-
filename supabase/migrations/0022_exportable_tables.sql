-- 0022 — WHAT "EXPORTS IN FULL" ACTUALLY MEANS (6.2)
--
-- `/export` walked a hard-coded list of nineteen tables. Three added later were silently absent:
--
--   library_recordings  the recorded voice interview. 8.1 calls it the source of truth for the
--                       voice guide, and it is the ONE artefact here that cannot be regenerated
--                       from anything else — a recording of Josh talking.
--   selection_runs      why each moment was or was not written (7.7's audit trail).
--   moment_embeddings   derived, but still state.
--
-- The clause says "exports in full to a plain, portable format on demand", and the whole reason it
-- exists is that the bank has to outlive the tools around it. An export missing a table is not an
-- export, and the failure is invisible: a missing table in a JSON file looks exactly like a table
-- with no rows.
--
-- SO THE LIST IS INVERTED. Tables are enumerated from the catalogue and a short deny-list is
-- excluded. A table added by a future migration is exported because it exists, and only a deliberate
-- decision keeps it out. That is the only version of this that survives the next migration — and
-- three arrived in a single day.
--
-- PostgREST cannot read `information_schema`, so this is the function it calls instead.

create or replace function public.exportable_tables()
returns table (table_name text, excluded_reason text)
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
         end
    from pg_tables t
   where t.schemaname = 'public'
   order by t.tablename;
$$;

revoke execute on function public.exportable_tables() from public, anon;
grant  execute on function public.exportable_tables() to authenticated, service_role;

comment on function public.exportable_tables is
  '6.2 - every table in public, with a reason where it is deliberately left out of the export. A '
  'deny-list rather than an allow-list, so a table added by a later migration is exported by '
  'default: the previous hard-coded list silently dropped three.';

-- ---------------------------------------------------------------------------
-- 6.1 — WARNING BEFORE A MOMENT IS PARKED ON A GUESS
--
-- `time_sensitive` and `decays_at` are set by the extraction model on every moment, and
-- `expireDecayedMoments` parks any mined moment once that date passes. The fields were shown
-- nowhere and editable nowhere, so a wrong guess removed Josh's material from the queue on a
-- schedule, with a reason that may simply have been false — and he had no way to see it coming.
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, note) values
  ('decay_warning_days', '3'::jsonb,
   '6.1 - how many days ahead the daily message names a moment that is about to decay, so a wrong '
   'guess can be corrected before it parks rather than discovered afterwards.')
on conflict (key) do nothing;
