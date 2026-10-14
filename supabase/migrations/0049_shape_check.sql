-- 0049 — a ninth check: shape
--
-- WHY THE EIGHT WERE NOT ENOUGH
--
-- Josh, on the call of 14 October 2026, describing every draft he had been shown:
--
--   "there is a lack of using line breaks... it's quite text-heavy... bullet points every now and
--    then, we don't need to overdo the bullet points, but break it up a little bit... header and
--    then underneath the A B C and then header... structure in a way that's a little easier to
--    consume rather than just a wall of text."
--
-- The rule for that already existed and could do nothing. `formatting` is a library section, the
-- drafter is shown it, and the gate is not: GATING_SECTIONS omits it. The voice guide is built
-- never to acquire shape taste of its own — VOICE_GUIDE_SYSTEM says "Do not describe how a
-- LinkedIn post should be structured". And every shape number the system computes is reported
-- rather than flagged. So a post that is specific, traceable, aimed, in-voice and clean of banned
-- phrases passed all eight as one unbroken block, which is exactly what he kept receiving.
--
-- WHY A CHECK AND NOT A THRESHOLD
--
-- A threshold would have been smaller. It would also have been an opinion: there is no number at
-- which a post becomes unreadable, and Aman Ghataura's median is four paragraphs with seventeen
-- words above the fold. The check is shown what this post does and what the eight writers Josh
-- chose measurably do, and it must quote a number when it fails — the same discipline the other
-- eight were given on 5 October, after the gate failed a post for phrases that were not in it.
--
-- WHAT THIS CHANGES ABOUT THE CONTRACT
--
-- Clause 9.6 names six checks; banned_phrases and identifiable were added by us, and this is the
-- ninth. A draft is no longer closed out at eight verdicts, so two places that counted to eight
-- now read GATE_CHECKS.length instead. Nothing about the first eight is altered, and a draft
-- judged before today keeps the verdicts it has.

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
  'shape'               -- added 14 Oct 2026: does it read as a post or as a wall of text
));
