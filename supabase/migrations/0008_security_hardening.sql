-- 0008 — SECURITY HARDENING
--
-- Raised by the Supabase database linter after 0001-0007. Two real findings, both worth fixing
-- before anything is built on top.
--
-- 1. SECURITY DEFINER trigger functions were reachable over PostgREST as /rest/v1/rpc/<name>, by
--    `anon` as well as `authenticated`. A trigger function has no business being callable directly:
--    Postgres checks EXECUTE when the trigger is CREATED, not each time it fires, so revoking the
--    privilege leaves the triggers working and closes the RPC endpoint.
--
-- 2. `enqueue` was granted to `authenticated` deliberately, but the implicit grant to PUBLIC also
--    handed it to `anon` — an unauthenticated caller could push work onto the job queue.
--
-- Also moves `vector` out of `public` into `extensions`, per Supabase's extension-hygiene lint.
-- pg_net is deliberately left where it is: its callable surface lives in the `net` schema either
-- way (verified: net.http_post), so relocating the extension buys nothing and risks the dispatcher.

-- 1. Trigger functions are not an API.
revoke execute on function public.library_section_bump()                  from public, anon, authenticated;
revoke execute on function public.library_section_snapshot()              from public, anon, authenticated;
revoke execute on function public.reject_proposal_on_immutable_section()  from public, anon, authenticated;

-- 2. The queue is not open to unauthenticated callers.
revoke execute on function public.enqueue(text, jsonb, timestamptz, text) from public, anon;
grant  execute on function public.enqueue(text, jsonb, timestamptz, text) to authenticated, service_role;

-- 3. Extension hygiene.
create schema if not exists extensions;
alter extension vector set schema extensions;
