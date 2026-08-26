-- 0014 — READING VAULT FROM AN EDGE FUNCTION
--
-- The workers could not read their own credentials, and the failure was silent.
--
-- `vault.decrypted_secrets` is not reachable over PostgREST: Supabase exposes only `public` (and
-- `graphql_public`) to the API, and exposing `vault` would be exactly wrong — it would publish every
-- credential to anyone who could reach the REST endpoint.
--
-- So the read goes through a SECURITY DEFINER function in `public`, executable by `service_role`
-- alone. That is not a new exposure: anyone holding the service_role key can already decrypt Vault
-- directly in SQL. It simply gives the workers a supported path to the same thing.

create or replace function public.read_secrets()
returns table (name text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.decrypted_secret
  from vault.decrypted_secrets s;
$$;

-- Only the workers. Never anon, never a signed-in browser session.
revoke execute on function public.read_secrets() from public, anon, authenticated;
grant  execute on function public.read_secrets() to service_role;

comment on function public.read_secrets is
  'Credential read for Edge Functions. service_role only — vault is not exposed to PostgREST, and '
  'must not be.';
