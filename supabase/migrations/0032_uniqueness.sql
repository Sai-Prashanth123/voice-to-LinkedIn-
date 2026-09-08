-- 0032 — THE CONSTRAINTS THAT SHOULD HAVE CAUGHT TODAY'S BUG
--
-- On 8 September, gating drafts through Claude Code turned up a draft reporting itself fully judged
-- with two of the eight checks never run. handlers/draft.ts had written one gate_runs row per FAILED
-- CLAIM rather than one per check, three rows arrived 65 milliseconds apart, and every reader that
-- counted rows believed the draft was further through the gate than it was.
--
-- The code is fixed. This is the layer that would have made the code unable to be wrong, which is
-- the standard the rest of this schema already holds itself to: R3 is four check constraints rather
-- than a caller remembering to check a flag, and 6.3 is a revoked grant rather than a policy.
--
-- ── gate_runs: one verdict per check ──────────────────────────────────────────────────────────
--
-- PARTIAL, on `model <> 'deterministic'`, and that qualifier is doing real work rather than dodging
-- the problem. Six duplicate rows exist and every one of them is deterministic — verified, not
-- assumed. 6.3 forbids deleting them to make room for a plain unique constraint, so the index
-- covers everything the deterministic path does not, and the deterministic path is now incapable of
-- producing more than one row because it no longer loops.
--
-- If a duplicate ever appears from any judged source, the insert fails loudly instead of quietly
-- inflating a count.

create unique index if not exists gate_runs_one_verdict_per_check
  on public.gate_runs (draft_id, check_key)
  where model <> 'deterministic';

comment on index public.gate_runs_one_verdict_per_check is
  'The gate is eight independent judgements, so one row each. Partial on model <> deterministic '
  'because six historical rows from the old per-claim loop cannot be deleted (6.3), and that path '
  'now writes a single row carrying every reason.';

-- ── raw_inputs: a Telegram retry must not capture twice ───────────────────────────────────────
--
-- Telegram retries a webhook that answers slowly, which is why _shared/jobs.ts fires its dispatcher
-- nudge with waitUntil rather than awaiting it. That comment names double-capture as the thing to
-- avoid and nothing enforced it.
--
-- It has not happened: 10 rows carrying a message id, 10 distinct. So the constraint goes on while
-- the table is clean, which is the only moment it can.

create unique index if not exists raw_inputs_one_per_telegram_message
  on public.raw_inputs (telegram_message_id)
  where telegram_message_id is not null;

comment on index public.raw_inputs_one_per_telegram_message is
  'One capture per Telegram message. Telegram retries a slow webhook, and a retry that stored the '
  'same voice note twice would put a duplicate moment in the bank that 6.3 forbids removing.';
