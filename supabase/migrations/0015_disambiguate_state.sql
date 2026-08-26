-- 0015 — "IS THIS AN ANSWER, OR SOMETHING NEW?"
--
-- 4.1.3 lets Josh "talk for two minutes and be done, with the follow-up happening later if he is
-- busy". So an unanswered question is normal, and the next message he sends may be a belated reply
-- OR a completely new thought.
--
-- The webhook previously assumed "answer" whenever a question was outstanding, with no time bound.
-- That silently lost material: a new thought sent the following day was filed as a reply to
-- yesterday's question, the new moment was never created, and nothing anywhere recorded a problem.
--
-- When the question is old enough for this to be genuinely ambiguous, the bot now asks. The message
-- that prompted it is held in `context.pending` until he taps, so nothing is lost while waiting —
-- including a voice note, whose Telegram file_id is kept so the audio can still be fetched.

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
    'disambiguate'       -- answering an old question, or starting something new
  ));

comment on column public.conversation_state.context is
  'Holds whatever the pending state needs: candidate ids, the image being rebuilt, or the message '
  'awaiting disambiguation. Never a place for credentials.';
