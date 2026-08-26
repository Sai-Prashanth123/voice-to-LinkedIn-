-- 0016 — RE-OPENING A MOMENT (6.4), AND THE SEEDING SESSION (clause 6, the cold start)
--
-- 6.4: "A moment must be re-openable. Josh adds to an old entry and it goes back into the queue."
--
-- This was not built, and the system was already telling him it was — two Telegram messages promise
-- "send me more about it and I will reopen this one". Nothing reopened anything, and there was no
-- linkage either: more material simply created a brand new moment while the old one stayed parked.
--
-- That mattered more than an ordinary gap, because 6.3 forbids deleting the parked moment. It would
-- have sat there indefinitely as evidence of a promise the system could not keep — and parking is
-- only safe BECAUSE there is a route back ("something that was not ready in August is often the
-- right post in November").

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
    'candidate_choice',  -- 4.3.4 which waiting candidate to dig into
    'disambiguate',      -- answering an old question, or starting something new
    'seeding'            -- the cold-start sitting: one moment straight into the next
  ));

-- The cold start (clause 6). "The build must include a seeding session: a long, deliberate interview
-- aimed at filling the bank with twenty to thirty mined moments before anything else runs."
--
-- A target rather than a hard stop: the point is a bank with enough real material to tune against,
-- and clause 1 still applies — if the moments are not there, fewer is the correct outcome.
insert into public.settings (key, value, note) values
  ('seed_target', '25'::jsonb,
   'Cold start (clause 6) — mined moments to aim for before the system is tuned against real material')
on conflict (key) do nothing;

comment on column public.moments.parked_reason is
  'Why it was parked, in plain language (9.8). Cleared when Josh reopens the moment (6.4) — the '
  'reason no longer applies once he has added to it.';
