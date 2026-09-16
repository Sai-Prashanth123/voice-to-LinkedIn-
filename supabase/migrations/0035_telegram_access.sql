-- 0035 — Telegram access requests
--
-- The first configured chat remains the owner. Other people can request access from the bot,
-- but they cannot reach the shared workspace until the owner approves them.

create table public.telegram_access (
  chat_id bigint primary key,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.telegram_access is
  'Telegram chats requesting access to the shared workspace; approval is owner-controlled.';

revoke all on public.telegram_access from anon, authenticated;
grant select, insert, update on public.telegram_access to service_role;
revoke delete, truncate on public.telegram_access from service_role;