-- 0039 — A QUESTION KNOWS WHICH SET IT CAME FROM
--
-- Josh's prompt set is four sets doing four different jobs, and his own header table says so:
-- set 1 mines a moment after every input, set 2 sweeps the week once a week, set 3 is a longer
-- sitting on request, set 4 is thirty specific doors, one at a time, and clause 6 says a seeding
-- session runs on them.
--
-- The parser threw that away. All 82 questions went into one bank and the interviewer was handed
-- the lot whatever it was doing — so mining one idea could offer "What happened this week that
-- surprised you?", and a seeding sitting drew from the same undifferentiated pile as everything
-- else. 63 of the 82 rows carry no tag at all.
--
-- `depth` already exists and is derived the same way, from the headings. This is the same idea one
-- level up.

alter table public.question_stats
  add column set_key  text check (set_key in ('mine', 'sweep', 'sitting', 'thirty')),
  add column category text;

comment on column public.question_stats.set_key is
  'Which of Josh''s four sets this question belongs to, parsed from the ## Set N heading above it. '
  'Null means it sits outside any set, and it is treated as ''mine''.';

comment on column public.question_stats.category is
  'The sub-heading it sits under, e.g. set 3''s "Recent moments". Kept for the longer sitting.';

-- The weekly sweep waits for its answers the same way an interview waits for one.
alter table public.conversation_state
  drop constraint conversation_state_awaiting_check;

alter table public.conversation_state
  add constraint conversation_state_awaiting_check
  check (awaiting in (
    'nothing',
    'answer',
    'idea_name',
    'sweep',               -- 0039: the weekly sweep, one of Josh's five questions at a time
    'visual_details',
    'visual_feedback',
    'name_clearance',
    'candidate_choice',
    'disambiguate',
    'seeding',
    'voice_guide_capture',
    'draft_verdict'
  ));

-- Off by default is wrong for a rebuild (14.3): the sweep is designed to run weekly, so a project
-- built from this repository sweeps. The row exists so it can be turned off without a deploy.
insert into public.settings (key, value)
values ('weekly_sweep_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The schedule the weekly sweep never had.
--
-- Monday morning, next to the daily ops note. Set 2 exists to refill the bank "when nothing obvious
-- has happened", and the bank being empty is exactly the state nobody notices in time.
-- ---------------------------------------------------------------------------
select cron.schedule('weekly-sweep', '0 8 * * 1', $$select public.invoke_worker('worker-sweep')$$);
