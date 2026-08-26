-- 0012 — SLACK STATE, AND THE CONVERSATION STATES THE REMAINING FLOWS NEED
--
-- Adds what 4.5 (Slack), 9.12 (asking before using a name), 10.6 (another version of a visual) and
-- 4.3.4 (raising waiting candidates) require.

-- ---------------------------------------------------------------------------
-- 4.5 — Slack, read per channel, resumable.
--
-- A cursor per channel so a run picks up where the last one stopped rather than re-reading history.
-- Without this, every run would re-surface the same conversations and 4.4.3's warning about volume
-- applies just as hard here.
-- ---------------------------------------------------------------------------
create table public.slack_state (
  channel_id     text primary key,
  channel_name   text,
  last_ts        text,                     -- Slack message timestamp cursor
  last_read_at   timestamptz,
  messages_seen  int not null default 0,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.slack_state enable row level security;
create policy slack_state_select on public.slack_state
  for select to authenticated using ((select auth.uid()) is not null);
revoke delete on public.slack_state from anon, authenticated, service_role;
revoke all on public.slack_state from anon;

comment on table public.slack_state is
  'Clause 4.5. Off by default via settings.slack_enabled; 4.5.2 requires it be switchable off '
  'entirely, and 4.5.3 notes this is other people''s words in a place they did not expect quoting.';

-- ---------------------------------------------------------------------------
-- The bot has more things it can be waiting on than the first pass allowed for.
-- ---------------------------------------------------------------------------
alter table public.conversation_state
  drop constraint conversation_state_awaiting_check;

alter table public.conversation_state
  add constraint conversation_state_awaiting_check
  check (awaiting in (
    'nothing',
    'answer',            -- an answer to an interview question
    'visual_details',    -- 10.2 what he is taking from the image
    'visual_feedback',   -- 10.6 another version, without starting again
    'name_clearance',    -- 9.12 the system must ask before a name is used
    'candidate_choice'   -- 4.3.4 which waiting candidate to dig into
  ));

-- ---------------------------------------------------------------------------
-- 4.2.6 — a question that keeps producing nothing gets rephrased, not retired.
-- The table already exists; this records which session a question was asked in so yield can be
-- credited once the interview produces material.
-- ---------------------------------------------------------------------------
alter table public.question_stats
  add column if not exists last_asked_at timestamptz;

-- Telegram messages the bot sends about a visual, so a reply maps back to it (10.6).
alter table public.sent_messages
  drop constraint sent_messages_kind_check;

alter table public.sent_messages
  add constraint sent_messages_kind_check
  check (kind in ('question', 'draft', 'visual_prompt', 'visual', 'names', 'candidates', 'other'));
