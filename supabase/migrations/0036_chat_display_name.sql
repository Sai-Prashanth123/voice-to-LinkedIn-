-- 0036 — who a Telegram chat belongs to
--
-- WHY A COLUMN AND NOT A TABLE
--
-- telegram_access already answers "may this chat write". "Who is it" is the same question's other
-- half, and splitting them across two tables is how they come to disagree — a row approved in one
-- and unnamed in the other, with no constraint saying that is impossible.
--
-- WHY IT MATTERS AT ALL
--
-- The bot has never known who it was talking to. isAuthorised() takes a chat id and returns a
-- boolean; the send target is a function literally called joshChatId(). With a second approved chat
-- now in the table, "Got it. Saved as M-000033." is sent to whoever wrote, addressed to nobody.
--
-- HOW IT IS FILLED
--
-- No onboarding flow and no awaiting state. A chat with a null display_name has its next text
-- message read as the answer to "what should I call you?" — deliberately, because conversation_state
-- is still a single row shared by every chat, and adding a state to it would be adding to the bug
-- rather than around it. That refactor is its own migration.

alter table public.telegram_access
  add column if not exists display_name text;

comment on column public.telegram_access.display_name is
  'What to call this chat. Null means the bot has not asked yet; the next message it sends is the question.';
