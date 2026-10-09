-- Notices — what the system would have told Josh, when there is nobody to tell.
--
-- Every outbound message in this build went to Telegram: a draft is ready, an idea parked, the queue
-- is low, nothing has come in for nine days, a post failed to publish, the monthly report. Telegram is
-- being removed and Claude Code cannot be pushed to, so those facts need somewhere to wait.
--
-- WHY A TABLE RATHER THAN RE-DERIVING IT
--
-- Most of what the system says is derivable from state: drafts waiting, ideas ready to write, open
-- proposals. Those need no table and get none — `system_status` counts them on demand.
--
-- What is NOT derivable is a fact that was true once. An error burst last Tuesday, a provider seen for
-- the first time (15.3), a selection run that chose to go short (7.7), a token that expires in nine
-- days, a park that happened while he was away. Clause 13 exists precisely because the risk is "it
-- breaks quietly and Josh finds out three weeks later", and in a pull-only system a fact nobody stored
-- is a fact nobody can be told.
--
-- THE HONEST LIMIT, STATED HERE SO IT IS NOT DISCOVERED LATER
--
-- This is a pull. A notice in a table cannot reach him on a Saturday. `worker-publish` failing is the
-- case that hurts: 13.2 wants failures to surface, and this only surfaces them when he next opens
-- Claude Code. That trade is the price of removing every push channel, and it is written down in the
-- handover rather than left for him to find.

create table if not exists public.notices (
  id          bigserial primary key,

  -- What kind of thing this is, so a reader can group and so `acted_on` makes sense.
  -- Free text rather than an enum: a new worker should be able to say something new without a
  -- migration, and the cost of a typo here is a mis-grouped line, not a lost fact.
  kind        text        not null,
  severity    text        not null default 'info'
                check (severity in ('info', 'warn', 'error')),

  -- The message as a person would read it. The same text the Telegram send used to carry.
  body        text        not null check (length(trim(body)) > 0),

  -- What it is about, where there is something. Both nullable: "nothing has come in for nine days"
  -- is about no particular row.
  moment_id   bigint      references public.moments(id) on delete set null,
  post_id     bigint      references public.posts(id)   on delete set null,

  -- The tools worth calling about it. A parked idea carries reopen_idea; a stalled interview carries
  -- the three escapes. This is what replaces the buttons that used to sit under the message, and it
  -- is why the notice is useful rather than merely informative.
  acted_on    text[]      not null default '{}',

  created_at  timestamptz not null default now(),

  -- Set when Josh has actually seen it, through mark_notices_read. Until then it is offered again.
  -- `sendDraftDigest` existed to stop the same thing being announced twice; this is the same
  -- discipline, moved to the reader's side.
  read_at     timestamptz
);

-- The only query that matters: what has he not seen, newest first.
create index if not exists notices_unread_idx
  on public.notices (created_at desc)
  where read_at is null;

create index if not exists notices_moment_idx on public.notices (moment_id) where moment_id is not null;

alter table public.notices enable row level security;

-- Read by the connector (its tools answer "what's waiting?") and by a signed-in session. Written only
-- by the service role, i.e. the workers — the same split every other table here uses, and the reason
-- marking one read goes through cc-submit rather than being an update grant.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'content_mcp') then
    grant select on public.notices to content_mcp;
    grant usage, select on sequence public.notices_id_seq to content_mcp;
  end if;
end $$;

drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices
  for select to authenticated
  using ((select auth.uid()) is not null);

-- 6.3 holds here too: a notice is a record of something that happened, so nothing deletes one.
revoke delete on public.notices from public, anon, authenticated;

comment on table public.notices is
  'What the system would have said. Replaces the Telegram outbound channel; read by the MCP tools.';
comment on column public.notices.acted_on is
  'Tool names worth calling about this notice. Replaces the buttons that sat under the old message.';
