-- 0009 — TELEGRAM CONVERSATION STATE
--
-- The webhook has to know what a given message MEANS: is it a new thought, an answer to a question
-- it asked, details about an image, or push-back on a draft? Getting that wrong is expensive in both
-- directions — a new moment swallowed as push-back is lost material, and push-back treated as a new
-- moment produces a hollow entry.
--
-- Two mechanisms, deliberately:
--   1. `sent_messages` maps a Telegram message id back to what the system sent, so a REPLY is
--      unambiguous. Telegram's native reply affordance means Josh does not have to remember a
--      convention (clause 16: nothing he cannot maintain, no friction).
--   2. `conversation_state` holds the one thing the bot is waiting on, for the case where he just
--      types without replying.

create table public.sent_messages (
  telegram_message_id bigint primary key,
  kind                text not null check (kind in ('question', 'draft', 'visual_prompt', 'other')),
  moment_id           bigint references public.moments(id) on delete restrict,
  draft_id            bigint references public.drafts(id) on delete restrict,
  created_at          timestamptz not null default now()
);

create index sent_messages_recent_idx on public.sent_messages (created_at desc);

-- Single row. `awaiting` is what the next unprompted message will be interpreted as.
create table public.conversation_state (
  id         boolean primary key default true check (id),
  awaiting   text not null default 'nothing'
               check (awaiting in ('nothing', 'answer', 'visual_details')),
  moment_id  bigint references public.moments(id) on delete restrict,
  context    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.conversation_state (id) values (true);

alter table public.sent_messages      enable row level security;
alter table public.conversation_state enable row level security;

create policy sent_messages_select on public.sent_messages
  for select to authenticated using ((select auth.uid()) is not null);
create policy conversation_state_select on public.conversation_state
  for select to authenticated using ((select auth.uid()) is not null);

revoke delete on public.sent_messages, public.conversation_state
  from anon, authenticated, service_role;
revoke all on public.sent_messages, public.conversation_state from anon;
