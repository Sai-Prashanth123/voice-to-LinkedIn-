-- 0028 — a scoped role for the MCP server, and the removal of TRUNCATE.
--
-- WHY A ROLE RATHER THAN A KEY CHECK IN CODE
--
-- The MCP server hands Claude Code a door into the idea bank. What that door opens onto must be
-- decided by the database, not by the server's own code: a scope enforced in JavaScript is a scope
-- that survives exactly as long as nobody makes a mistake in JavaScript. This role can read the
-- material a draft is written from, add a draft, record a check, and propose a library change.
-- It cannot publish, approve, schedule, edit the library, or remove anything at all.
--
-- The worst outcome available to a confused model is therefore a draft nobody asked for, which Josh
-- declines exactly as he would any other draft.
--
-- WHY TRUNCATE IS BEING REVOKED HERE
--
-- Found while building this migration, and it is a real gap rather than tidying. Supabase grants
-- ALL on new tables to `authenticated` and `service_role`, and ALL includes TRUNCATE. DELETE was
-- deliberately revoked across the schema — 6.3 says a moment is killed and labelled, never removed
-- — so the system has been described, in writing and to Josh, as one where nothing he has said can
-- be destroyed by any code path.
--
-- TRUNCATE made that not quite true. It removes every row in a table, it is not a DELETE so nothing
-- that guards DELETE saw it, and no RLS policy applies to it. One line in one worker could have
-- emptied the idea bank, and every safeguard would have been looking the other way.
--
-- Nothing in this system truncates anything, so revoking it costs nothing and closes the hole.
--
-- After this runs, `postgres` still holds TRUNCATE on every table. That is inherent to owning them
-- and cannot be given away. It does not reopen the hole: the system never connects as `postgres`.
-- Edge Functions authenticate as `service_role`, the app as `anon` and `authenticated`, and this
-- server as `content_mcp` — and none of those four can truncate anything any more.

begin;

-- ── The role ──────────────────────────────────────────────────────────────────────────────────
--
-- NOLOGIN: it is never connected to directly. PostgREST authenticates as `authenticator` and
-- switches into this role for the request, which is why the grant below is required.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'content_mcp') then
    create role content_mcp nologin;
  end if;
end
$$;

grant content_mcp to authenticator;
grant usage on schema public to content_mcp;

-- ── What it may read ──────────────────────────────────────────────────────────────────────────
--
-- Everything a draft is written from, everything the gate is judged against, and the tables the
-- clause 17 scorecard is computed from. Not settings, not linkedin_auth, not sent_messages,
-- not conversation_state: none of them informs a draft, and each is a way to learn something about
-- Josh that writing a post does not require.

grant select on
  public.moments,
  public.material,
  public.moment_names,
  public.interview_turns,
  public.raw_inputs,
  public.drafts,
  public.gate_runs,
  public.library_sections,
  public.library_versions,
  public.library_section_versions,
  public.library_proposals,
  public.posts,
  public.outcomes,
  public.selection_runs,
  public.visuals,
  public.published_archive
to content_mcp;

-- ── What it may write ─────────────────────────────────────────────────────────────────────────
--
-- Three inserts and nothing else. No UPDATE anywhere: a draft is superseded by a new version
-- rather than edited, and a gate verdict that could be rewritten is not a record of anything.

grant insert on public.drafts to content_mcp;
grant insert on public.gate_runs to content_mcp;
grant insert on public.library_proposals to content_mcp;

grant usage, select on sequence public.drafts_id_seq to content_mcp;
grant usage, select on sequence public.gate_runs_id_seq to content_mcp;
grant usage, select on sequence public.library_proposals_id_seq to content_mcp;

-- Search is a function rather than a filter because it ranks. SECURITY INVOKER, so it is subject
-- to the same row-level rules a plain read is.
grant execute on function public.search_moments(text, int) to content_mcp;

-- ── Row-level security ────────────────────────────────────────────────────────────────────────
--
-- Every table above has RLS enabled, so a grant alone returns nothing. These policies say what the
-- grants already say; both are required, and stating them together is what makes the scope
-- reviewable in one place.

do $$
declare
  t text;
begin
  foreach t in array array[
    'moments', 'material', 'moment_names', 'interview_turns', 'raw_inputs',
    'drafts', 'gate_runs', 'library_sections', 'library_versions',
    'library_section_versions', 'library_proposals', 'posts', 'outcomes',
    'selection_runs', 'visuals', 'published_archive'
  ]
  loop
    execute format(
      'drop policy if exists mcp_read on public.%I', t
    );
    execute format(
      'create policy mcp_read on public.%I for select to content_mcp using (true)', t
    );
  end loop;

  foreach t in array array['drafts', 'gate_runs', 'library_proposals']
  loop
    execute format('drop policy if exists mcp_insert on public.%I', t);
    execute format(
      'create policy mcp_insert on public.%I for insert to content_mcp with check (true)', t
    );
  end loop;
end
$$;

-- ── Closing the TRUNCATE hole ─────────────────────────────────────────────────────────────────
--
-- Applies to every table in the schema, not only the ones this role touches. The guarantee 6.3
-- makes is about the whole system.

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'revoke truncate on public.%I from anon, authenticated, service_role, content_mcp', t
    );
  end loop;
end
$$;

alter default privileges in schema public
  revoke truncate on tables from anon, authenticated, service_role;

comment on role content_mcp is
  'The MCP server (mcp-server/). Reads what a draft is written from; may add a draft, a gate '
  'verdict and a library proposal. Cannot publish, approve, update or delete anything.';

commit;
