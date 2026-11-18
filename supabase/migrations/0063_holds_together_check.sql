-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- A tenth check: does the post contradict itself, or drift off its one point.
--
-- Josh, 18 November 2026, having given the same note three times to drafts that passed every other
-- check:
--
--   "Flow. The reading-order question added on 26 October hasn't stopped it. I gave this note three
--    times after it shipped, once for two lines that contradicted each other. Could it become a
--    review check that catches contradictions and a post drifting off its one point?"
--
-- It could, and this is the half of it that has to be a migration. `gate_runs.check_key` is a
-- closed enum, so without this every verdict for the new key is refused at the write door AFTER the
-- judgement has been made and paid for — the model call happens, the answer is thrown away, and the
-- draft reports itself judged on nine of ten for ever. 0049 added the ninth the same way and its
-- note says the same thing.
--
-- Nothing about the existing nine is altered, and a draft judged before today keeps the verdicts it
-- has. Everything that counts the gate already reads GATE_CHECKS.length rather than a literal, so
-- the count moves on its own.
--
-- WHY A CHECK RATHER THAN A RUBRIC LINE SOMEWHERE
--
-- Because the other nine each judge the post as a set of properties, and the fault he is describing
-- is a property of the post as a SEQUENCE. Two lines can each be true, in his voice, well shaped,
-- sourced and aimed at the right reader, and still contradict one another. Nothing that reads a
-- post one attribute at a time will ever see that, which is why a note given three times after the
-- reading-order question shipped kept being needed.

alter table public.gate_runs drop constraint gate_runs_known_check;

alter table public.gate_runs add constraint gate_runs_known_check check (check_key in (
  'anyone_else',        -- 9.6a could anyone else have written this
  'claims_trace',       -- 9.6b does every claim trace to the source
  'hook_opens_loop',    -- 9.6c does the hook open a loop rather than close one
  'aimed_at_someone',   -- 9.6d is it aimed at someone in particular
  'voice_guide',        -- 9.6e does it obey the voice guide
  'names_cleared',      -- 9.6f does it use a name that has not been cleared
  'banned_phrases',     -- added by us: the AI-tells list
  'identifiable',       -- 9.13 identifiable by implication even when anonymised
  'shape',              -- added 14 Oct 2026: does it read as a post or as a wall of text
  'holds_together'      -- added 18 Nov 2026 at his request: contradictions, and drift off the point
));
