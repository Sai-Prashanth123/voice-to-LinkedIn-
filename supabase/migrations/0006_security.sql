-- 0006 — ROW LEVEL SECURITY AND PRIVILEGES
--
-- Two principals only:
--   * `authenticated`  — Josh, via the Next.js app. He is the only human account.
--   * `service_role`   — the Edge Function workers. Bypasses RLS by design in Supabase.
--
-- 6.3 "Nothing may be deleted by the system." That is enforced here by revoking DELETE from every
-- role the system runs as, so a deletion is not merely unimplemented but impossible. Josh retains the
-- ability to delete via the dashboard (the `postgres` role) — the constraint is on the system, not on
-- the owner of the data.

alter table public.moments                  enable row level security;
alter table public.moment_names             enable row level security;
alter table public.raw_inputs               enable row level security;
alter table public.interview_turns          enable row level security;
alter table public.material                 enable row level security;
alter table public.drafts                   enable row level security;
alter table public.gate_runs                enable row level security;
alter table public.visuals                  enable row level security;
alter table public.posts                    enable row level security;
alter table public.outcomes                 enable row level security;
alter table public.library_sections         enable row level security;
alter table public.library_section_versions enable row level security;
alter table public.library_versions         enable row level security;
alter table public.library_proposals        enable row level security;
alter table public.jobs                     enable row level security;
alter table public.published_archive        enable row level security;
alter table public.question_stats           enable row level security;
alter table public.llm_calls                enable row level security;
alter table public.system_events            enable row level security;
alter table public.settings                 enable row level security;

-- Single-tenant: any authenticated session is Josh. auth.uid() is wrapped in a scalar subquery so it
-- is evaluated once per statement rather than once per row.
do $$
declare
  t text;
begin
  foreach t in array array[
    'moments','moment_names','raw_inputs','interview_turns','material','drafts','gate_runs',
    'visuals','posts','outcomes','library_sections','library_section_versions','library_versions',
    'library_proposals','jobs','published_archive','question_stats','llm_calls','system_events',
    'settings'
  ]
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
    -- Deliberately no DELETE policy on any table. See 6.3.
  end loop;
end;
$$;

-- Belt and braces: revoke the privilege itself, so even a future policy mistake cannot delete.
revoke delete on all tables in schema public from anon, authenticated, service_role;
alter default privileges in schema public
  revoke delete on tables from anon, authenticated, service_role;

-- The anon role has no business here at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- The queue helpers are service_role only.
revoke execute on function public.claim_jobs(text, text[], int) from public, anon, authenticated;
revoke execute on function public.fail_job(bigint, text)         from public, anon, authenticated;
grant  execute on function public.claim_jobs(text, text[], int) to service_role;
grant  execute on function public.fail_job(bigint, text)        to service_role;

-- Storage buckets. Private; reached through signed URLs only. Audio and images are confidential
-- client-adjacent material (15.4).
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false),
       ('images',      'images',      false),
       ('renders',     'renders',     false)
on conflict (id) do nothing;

create policy "josh reads own media" on storage.objects
  for select to authenticated
  using (bucket_id in ('voice-notes', 'images', 'renders')
         and (select auth.uid()) is not null);
