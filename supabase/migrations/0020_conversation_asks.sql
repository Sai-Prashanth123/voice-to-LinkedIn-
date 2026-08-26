-- 0020 — HOW MANY TIMES THE AWKWARD QUESTION GETS ASKED (12.8)
--
-- 12.5 puts one question inside the weekly pass: did any of these lead to a conversation. 12.8 adds
-- the rule that makes it survivable — "if he skips it for weeks, the system must not stall, nag or
-- degrade."
--
-- The skip button wrote `conversation_asked_at` and NOTHING READ IT. Both the web pass and the
-- Telegram pass filtered on `conversation_answered_at` alone, so a skipped post came back on every
-- pass for three weeks. That is the nagging the clause rules out, and a button that looks like it
-- worked is worse than no button: he stops trusting the controls.
--
-- A timestamp cannot express the rule anyway. The question is not "has this been asked" but "how
-- many times", because the honest answer is more than once and fewer than every week:
--
--   * a DM can arrive a fortnight after a post, so asking once at the first pass is genuinely early
--   * asking a third time is nagging, whatever the post did
--
-- Two asks, then it drops away whether or not he answered. Skipping counts as an ask, because from
-- his side it is the same event: he was asked and chose not to say.

alter table public.outcomes
  add column conversation_ask_count int not null default 0;

comment on column public.outcomes.conversation_ask_count is
  '12.8 — how many times Josh has been shown this post''s conversation question, whether he answered '
  'or skipped. At `conversation_max_asks` it stops being raised. Replaces reading '
  'conversation_asked_at, which nothing ever did.';

-- Anything already asked or answered starts at one, so existing posts are not asked two more times
-- for a question they have already seen.
update public.outcomes
   set conversation_ask_count = 1
 where conversation_asked_at is not null
    or conversation_answered_at is not null;

insert into public.settings (key, value, note) values
  ('conversation_max_asks', '2'::jsonb,
   '12.8 — how many passes a post''s conversation question is raised in before it drops away, '
   'answered or not. Two: one ask is early for a DM that arrives late, three is nagging.')
on conflict (key) do nothing;
