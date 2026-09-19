-- 0038 — THE BOT REMEMBERS THE CONVERSATION, AND EACH CHAT HAS ITS OWN
--
-- The assistant answered every message from a database snapshot and nothing else: not the message
-- before it, not what the bot itself had just said, not what it was waiting on. So it could not
-- follow "and another thing", could not tell an answer from a new story except by a three-hour
-- clock, and had to be told in a modal state what it should have been able to read.
--
-- WHY A TABLE AND NOT conversation_state.context
--
-- `context` is one jsonb column on one row that every state overwrites. It holds the thing being
-- waited on, which is exactly what a history must not be: a buffer that survives the mode changing.
--
-- WHY conversation_state STOPS BEING ONE ROW
--
-- It was declared `id boolean primary key default true check (id)` — literally one row for the whole
-- system. Two people in two chats shared one `awaiting` and one `moment_id`, so a second person
-- mid-interview overwrote the first, and an answer could be filed against a stranger's idea. Now
-- that any chat is admitted without approval, that stops being theoretical.

create table public.chat_messages (
  id                  bigint generated always as identity primary key,
  chat_id             bigint not null,
  direction           text not null check (direction in ('in', 'out')),
  body                text not null,
  telegram_message_id bigint,
  created_at          timestamptz not null default now()
);

create index chat_messages_recent_idx on public.chat_messages (chat_id, created_at desc);

comment on table public.chat_messages is
  'What was said in each Telegram chat, both directions, so the assistant can read the conversation '
  'it is in. Never a source for a draft: material lives in raw_inputs and interview_turns.';

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;
grant select, insert on public.chat_messages to service_role;
-- 6.3 — nothing the system writes can be removed by it.
revoke delete, truncate on public.chat_messages from service_role;

-- ---------------------------------------------------------------------------
-- One row per chat, not one row.
--
-- ORDER MATTERS: the existing row is given its chat id BEFORE the singleton constraint goes, so the
-- state a live interview is sitting in survives the migration.
-- ---------------------------------------------------------------------------
alter table public.conversation_state add column chat_id bigint;

update public.conversation_state
   set chat_id = coalesce(
     (select (regexp_split_to_array(decrypted_secret, '[,\s]+'))[1]::bigint
        from vault.decrypted_secrets where name = 'TELEGRAM_CHAT_ID'),
     0)
 where id = true;

alter table public.conversation_state
  drop constraint conversation_state_pkey,
  drop constraint conversation_state_id_check,
  alter column chat_id set not null,
  alter column id drop default,
  add primary key (chat_id);

alter table public.conversation_state drop column id;

comment on table public.conversation_state is
  'What the bot is waiting on, per chat. It was a single shared row until 0038: two people in two '
  'chats overwrote each other, and an answer could land on a stranger''s idea.';

-- ---------------------------------------------------------------------------
-- Which chat an idea came from, so its questions go back there rather than to the owner.
-- ---------------------------------------------------------------------------
alter table public.moments add column chat_id bigint;

comment on column public.moments.chat_id is
  'The Telegram chat this idea was captured in, when it was. Null for anything that arrived another '
  'way (a call transcript, a Claude session, the connector). Questions are delivered here.';
