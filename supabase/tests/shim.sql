-- Local test shim.
--
-- Stands in for the Supabase-managed objects the migrations depend on, so the schema can be applied
-- to a plain Postgres for verification (and in CI) without a Supabase project. Never applied to a
-- real project — Supabase provides all of this itself.

create role anon;
create role authenticated;
create role service_role;

-- PostgREST connects as this one and switches into whichever role a request's key names. It was
-- missing until 0028 needed it, because nothing before then granted a role to it.
create role authenticator noinherit login password 'shim';
grant anon, authenticated, service_role to authenticator;

-- Supabase keeps extensions here; 0008 relocates `vector` into it.
create schema if not exists extensions;

-- auth.uid()
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- storage
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid);
alter table storage.objects enable row level security;

-- vault
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique, decrypted_secret text);

-- pg_net
create schema if not exists net;
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 1::bigint $$;

-- pg_cron
create schema if not exists cron;
create table if not exists cron.job (
  jobid bigserial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as
$$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
   on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
   returning jobid $$;
