/*
 * The writing queue, readable by the role that does the writing.
 *
 * WHAT IS BROKEN
 *
 * `content_mcp` has no privilege of any kind on `public.jobs`, and `jobs` has RLS on with three
 * policies, none of them for that role. Two tools in the MCP server read it:
 *
 *   mcp-server/tools/work.mjs:158   next_work — THE writing queue. Without this there is no list
 *                                   of what to write.
 *   mcp-server/tools/brief.mjs:213  get_drafting_brief — carries Josh's pushback note into the
 *                                   rewrite. His note is not a gate verdict and lives nowhere
 *                                   else; `pushback.ts` puts it in the job payload's `failures`.
 *
 * `db.select` throws on 42501 rather than returning empty (mcp-server/db.mjs:59-72), so under the
 * scoped key `next_work` and `get_drafting_brief` both fail outright. Drafting stops.
 *
 * WHY NOBODY HAS SEEN IT
 *
 * Every session so far has run with the service-role key, which bypasses RLS and holds every
 * grant. `system_events` shows 396 `mcp_http_call` rows and not one session on the scoped role.
 * The moment Josh is handed a `content_mcp` key — which is the only key he can safely be given,
 * since ours is the service key — the two most-used tools in the system stop working.
 *
 * This is the same defect class as the rest of this fortnight: a path that has never been
 * exercised reports healthy, because the thing that would have exercised it was never run.
 *
 * WHY SELECT AND NOTHING ELSE
 *
 * The role must not create or close jobs. Work is enqueued by the workers and by `cc-submit`, and
 * `create_draft` closes a job through the write door, which runs as the service role. A role that
 * could INSERT here could schedule its own work; a role that could UPDATE could mark a rewrite
 * Josh asked for as done without writing it. Read-only is the whole requirement.
 *
 * `system_events` is deliberately NOT granted, for the reason given in 0054: it is the operations
 * log, and the one question the MCP server asks of it is answered by an RPC instead.
 */

grant select on public.jobs to content_mcp;

-- RLS is on and the role bypasses nothing (`rolbypassrls = false`), so the grant alone reads zero
-- rows — which would look exactly like an empty queue. Same shape as `mcp_read` on `drafts`.
drop policy if exists mcp_read on public.jobs;
create policy mcp_read on public.jobs
  for select to content_mcp
  using (true);

comment on policy mcp_read on public.jobs is
  'next_work and get_drafting_brief read the writing queue. SELECT only: the role must not enqueue '
  'its own work, and must not be able to close a rewrite Josh asked for without writing it.';
