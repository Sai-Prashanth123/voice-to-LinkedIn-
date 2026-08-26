-- 0011 — LINKEDIN CREDENTIALS
--
-- LinkedIn access tokens expire after 60 days. An env var would therefore stop the calendar dead
-- roughly two months after handover, silently, which is precisely the failure clause 13 is about:
-- "the main operational risk is not that it breaks, it is that it breaks quietly."
--
-- So the token is stored, refreshed when a refresh token is available, and its expiry is watched by
-- worker-ops, which warns Josh well before it lapses.
--
-- The row belongs to Josh's own LinkedIn developer app, in his name (14.1).

create table public.linkedin_auth (
  id                    boolean primary key default true check (id),
  member_urn            text,
  access_token          text,
  refresh_token         text,
  access_expires_at     timestamptz,
  refresh_expires_at    timestamptz,
  scopes                text,
  -- Analytics sits behind Community Management API review; posting does not. Tracked separately so
  -- the system knows whether to attempt a metrics pull at all (12.1).
  has_post_analytics    boolean not null default false,
  last_refreshed_at     timestamptz,
  last_error            text,
  updated_at            timestamptz not null default now()
);

insert into public.linkedin_auth (id) values (true);

alter table public.linkedin_auth enable row level security;

-- Deliberately no SELECT policy for `authenticated`: the app never needs to read the token, and the
-- workers reach it as service_role, which bypasses RLS.
revoke all on public.linkedin_auth from anon, authenticated;
revoke delete on public.linkedin_auth from service_role;

comment on table public.linkedin_auth is
  'Josh LinkedIn app credentials. w_member_social is self-serve; r_member_postAnalytics requires '
  'Community Management API approval under a registered company (12.1).';
