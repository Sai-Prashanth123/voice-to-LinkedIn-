-- 0047 — one-step writing mode, and letting a draft be handed over despite a failing gate.
--
-- WHY
--
-- Josh, 13 October: "It's still asking me interview questions. And referencing the idea bank. As
-- I've mentioned multiple times now, I want to scrap all that for the time being."
--
-- What his session actually did, from these tables: he captured moment 89 at 04:27, 21 interview
-- turns were recorded, and at 05:02 a draft was written from moment 68 — a different idea, selected
-- four hours earlier by the cron that fills the draft queue. Moment 89 never left `captured`.
--
-- This migration adds the switch. It does not remove anything: every interview tool still works and
-- turning the mode off restores the old behaviour exactly. He said "for the time being".

-- ── The switch ────────────────────────────────────────────────────────────────────────────────

insert into public.settings (key, value, note) values
  ('one_step_mode', 'false'::jsonb,
   'When true: capture asks no questions, selection enqueues nothing, next_work offers nothing from '
   'the queue, and the eight checks are advisory. Added 13 Oct 2026 at Josh''s request. Off by '
   'default so a fresh project behaves as the spec describes.')
on conflict (key) do nothing;

-- ── Handing over a draft that failed ──────────────────────────────────────────────────────────
--
-- `gate_passed` keeps meaning exactly what it meant: did the eight checks pass. It is never set
-- true for a draft that failed, because every clause 17 number and the whole learning loop are
-- computed from it, and a system that lies about its own quality bar to make a post reachable has
-- destroyed the only evidence it was ever working.
--
-- So the permission is a second, separate fact. `gate_advisory` means: this draft was handed to
-- Josh despite failing, and he was told which checks flagged it.
--
-- Per-draft rather than read from the setting at approval time, deliberately. Switching the mode
-- back off must not strand a post he has already read and approved, and a draft judged before this
-- column existed must never become approvable over a failure by a later flip of a flag.

alter table public.drafts
  add column if not exists gate_advisory boolean not null default false;

comment on column public.drafts.gate_advisory is
  'True when this draft was handed over despite gate_passed = false, in one-step mode, with the '
  'failed checks read out to Josh. Never set on a passing draft. mark_ready consults THIS, not the '
  'live setting, so turning the mode off cannot strand a post he already approved.';

-- ── The connector has to be able to read the flag ─────────────────────────────────────────────
--
-- 0028 deliberately withheld `settings` from content_mcp: "none of them informs a draft, and each
-- is a way to learn something about Josh that writing a post does not require." That reasoning is
-- still right about the table and wrong about four rows of it, which are operating modes rather
-- than anything about him.
--
-- A whitelisted policy rather than a wider grant, so the sentence above stays true of every row it
-- was written about. This also closes a latent fault: brief.mjs already reads
-- cc_candidates_per_day, and it has only ever worked because the hosted connector falls back to the
-- service key when no scoped key is set. The day that key is minted, that read would have started
-- returning the fallback silently.

grant select on public.settings to content_mcp;

drop policy if exists mcp_read_flags on public.settings;
create policy mcp_read_flags on public.settings
  for select to content_mcp
  using (key in (
    'one_step_mode',
    'gate_runs_in_claude',
    'interview_max_questions',
    'cc_candidates_per_day'
  ));
