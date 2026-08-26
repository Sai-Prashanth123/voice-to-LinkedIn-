-- 0023 — AN ABANDONED INTERVIEW NEEDS AN ENDING (7.6, via 5.8)
--
-- M-000004 sat on an unanswered question for two days with nothing that would ever resolve it. It
-- arrived as a call-transcript candidate, was opened, was asked something, and was never returned
-- to. After that:
--
--   * `openCandidate` had moved it from `half_mined` to `captured`
--   * 7.6's ageing only ever looked at `half_mined`
--   * selection only reads `mined`
--   * no job existed for it, and none would be created
--
-- So the exact thing 7.6 exists to prevent — candidates "accumulating in front of Josh forever" —
-- was open, and OPENING a candidate is what opened it. Three more moments were on the same road.
--
-- The rule already exists; it just had no timer. 5.8: "Must know when to stop. Josh is busy and a
-- session that runs to fifteen questions gets abandoned. It takes what it has and moves on." That is
-- the policy at fifteen questions. It should equally be the policy at a fortnight of silence — the
-- session was abandoned either way, and extraction handles a thin one honestly by parking it.
--
-- TWO THRESHOLDS, BECAUSE THE TWO ARE NOT THE SAME THING
--
-- A voice note Josh stopped his day to record is worth more patience than something a model dug out
-- of a transcript. And the automatic inputs are what 7.6 is actually worried about: they run on
-- their own and produce candidates whether or not anyone is reading them.

insert into public.settings (key, value, note) values
  ('stale_own_days', '14'::jsonb,
   '7.6 / 5.8 — days of silence before an unanswered interview on a moment JOSH created is closed '
   'off by taking what it has. Longer than a machine-raised candidate: he stopped his day to '
   'record it.'),
  ('stale_candidate_days', '7'::jsonb,
   '7.6 / 5.8 — the same, for candidates raised by the automatic inputs. Shorter, because these are '
   'what 7.6 is worried about accumulating in front of him.')
on conflict (key) do nothing;
