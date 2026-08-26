-- 0017 — WHERE A RE-OPENED SESSION STARTS
--
-- 6.4 gives a parked moment a way back. But an interview carries two per-session budgets:
--
--   5.8  a question budget well under fifteen, because "a session that runs to fifteen questions
--        gets abandoned"
--   5.3  at most one pushback per session
--
-- Both were counted over every turn the moment had ever had. So a moment that was parked after
-- eight questions came back with its budget already spent: re-opening it would have gone straight
-- to extraction without asking anything, re-run the same extraction over the same material, and
-- parked it again — a loop that looks like the promise being kept and is not.
--
-- Re-opening is a NEW session on an old moment. This records where it starts. The earlier
-- conversation is still shown to the interviewer as context, because it is what he already said;
-- only the budgets reset.
--
-- Null for every moment that has never been re-opened, which is the common case and costs nothing.

alter table public.moments
  add column reopened_at timestamptz;

comment on column public.moments.reopened_at is
  'When Josh last re-opened this moment (6.4). The per-session budgets in 5.3 and 5.8 count only '
  'turns after this point: re-opening starts a new session, not a continuation of a spent one.';
