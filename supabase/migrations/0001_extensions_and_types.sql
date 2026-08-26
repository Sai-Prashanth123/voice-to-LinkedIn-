-- 0001 — extensions and enumerated types
-- Spec refs: clause 6 (status list), clause 5 (depth ladder), clause 4 (sources).

create extension if not exists vector;      -- 7.2 dedup against the published archive
create extension if not exists pg_cron;     -- 4.4.1, 12.1, 13.x scheduled work
create extension if not exists pg_net;      -- cron -> edge function invocation

-- The five ways in (clause 4). Exactly five, no more.
create type public.moment_source as enum (
  'raw_capture',        -- 4.1  Josh dumps a thought
  'prompted_session',   -- 4.2  Josh asks to be interviewed
  'call_transcript',    -- 4.3  automatic
  'claude_code',        -- 4.4  automatic
  'slack'               -- 4.5  automatic, optional, off by default
);

-- The nine states, verbatim from clause 6. 'parked' is a destination, not a failure bin (6.3).
create type public.moment_status as enum (
  'captured', 'half_mined', 'mined', 'queued',
  'drafted', 'gated', 'scheduled', 'published', 'parked'
);

-- The interview depth ladder (clause 5). Worked in order, stops at the first that produces material.
-- 'none' means nothing worth writing -> the moment parks. That is a correct outcome.
create type public.interview_depth as enum (
  'none', 'scene', 'time_anchored', 'earned_perspective'
);

create type public.job_status as enum ('pending', 'running', 'done', 'failed', 'dead');

create type public.post_status as enum ('draft', 'ready', 'scheduled', 'published', 'failed');

create type public.proposal_status as enum ('open', 'approved', 'rejected', 'reverted');
